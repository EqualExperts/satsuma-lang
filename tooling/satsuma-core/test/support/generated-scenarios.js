/**
 * generated-scenarios.js — Semantic-first generated Satsuma test inputs.
 *
 * Property tests build bounded declarations, mappings, arrows, nesting, and
 * fragment spreads as plain semantic data, then render that data to Satsuma.
 * This module owns test generation and rendering only: expected coverage rules
 * stay in the property tests, and R4's independent oracle remains separate.
 */

import assert from "node:assert/strict";
import fc from "fast-check";
import {
  collectParseErrors,
  computeMappingCoverage,
  declaresRecordBody,
  expandDeclaredFields,
  extractFragments,
  extractSchemas,
  getParser,
  makeEntityRefResolver,
} from "@satsuma/core";

/** Enough runs to explore combinations while keeping the full repository suite quick. */
const GENERATED_PROPERTY_RUNS = 100;

/** Maximum generated leaves; small bounds make shrunk counterexamples reviewable. */
const MAX_GENERATED_LEAVES = 5;

/** Shared fast-check settings; fast-check adds the replay seed and path on failure. */
export const GENERATED_PROPERTY_PARAMETERS = Object.freeze({
  numRuns: GENERATED_PROPERTY_RUNS,
  verbose: true,
  // fast-check 4 omits the thrown assertion by default. Keeping it in the
  // report is what places the final shrunk Satsuma beside the seed and path.
  includeErrorInReport: true,
});

// ── Semantic model ─────────────────────────────────────────────────────────

/** @typedef {{ name: string, kind: "scalar" }} ScalarField */
/**
 * @typedef {{
 *   name: string,
 *   kind: "record",
 *   fields: SemanticField[],
 *   spreads?: string[],
 * }} RecordField
 */
/** @typedef {ScalarField | RecordField} SemanticField */
/**
 * @typedef {{
 *   name: string,
 *   fields: SemanticField[],
 *   spreads?: string[],
 * }} SemanticEntity
 */
/** @typedef {{ sources: string[], target: string }} SemanticArrow */
/**
 * @typedef {{
 *   name: string,
 *   sources: string[],
 *   targets: string[],
 *   arrows: SemanticArrow[],
 * }} SemanticMapping
 */
/**
 * @typedef {{
 *   fragments: SemanticEntity[],
 *   schemas: SemanticEntity[],
 *   mapping: SemanticMapping,
 * }} SemanticScenario
 */

/** Construct one scalar declaration in the generated semantic model. */
function scalarField(name) {
  return { name, kind: "scalar" };
}

/** Construct one record declaration in the generated semantic model. */
function recordField(name, fields, spreads = []) {
  return { name, kind: "record", fields, ...(spreads.length > 0 ? { spreads } : {}) };
}

/** Stable leaf names derived from a generated count rather than arbitrary text. */
function leafNames(count) {
  return Array.from({ length: count }, (_, index) => `field_${index}`);
}

/** A minimal two-schema mapping scenario used by most generated properties. */
function mappingScenario({ sourceFields, targetFields, arrows, fragments = [] }) {
  return {
    fragments,
    schemas: [
      { name: "src", fields: sourceFields },
      { name: "tgt", fields: targetFields },
    ],
    mapping: { name: "load", sources: ["src"], targets: ["tgt"], arrows },
  };
}

/** Prefix every field path with the same generated record chain. */
function nestFields(fields, depth) {
  let nested = fields;
  for (let level = depth - 1; level >= 0; level -= 1) {
    nested = [recordField(`group_${level}`, nested)];
  }
  return nested;
}

/** Prefix one leaf path with the record chain produced by {@link nestFields}. */
function nestedPath(path, depth) {
  const prefixes = Array.from({ length: depth }, (_, level) => `group_${level}`);
  return [...prefixes, path].join(".");
}

/** Turn one dotted path into the smallest semantic field tree declaring it. */
function fieldTreeForPath(path) {
  const [head, ...tail] = path.split(".");
  return tail.length === 0
    ? [scalarField(head)]
    : [recordField(head, fieldTreeForPath(tail.join(".")))];
}

/** Every semantic leaf path, qualified from the schema root. */
export function semanticLeafPaths(fields, prefix = "") {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    return field.kind === "record" ? semanticLeafPaths(field.fields, path) : [path];
  });
}

// ── Rendering and strict parsing ───────────────────────────────────────────

/** Render fields and spreads at one declaration level. */
function renderMembers(fields, spreads, indent) {
  const members = fields.map((field) => renderField(field, indent));
  members.push(...(spreads ?? []).map((spread) => `${indent}...${spread}`));
  return members.join("\n");
}

/** Render one scalar or record field declaration. */
function renderField(field, indent) {
  if (field.kind === "scalar") return `${indent}${field.name} STRING`;

  const body = renderMembers(field.fields, field.spreads, `${indent}  `);
  return body.length > 0
    ? `${indent}${field.name} record {\n${body}\n${indent}}`
    : `${indent}${field.name} record {}`;
}

/** Render a schema-shaped fragment or schema declaration. */
function renderEntity(keyword, entity) {
  const body = renderMembers(entity.fields, entity.spreads, "  ");
  return body.length > 0
    ? `${keyword} ${entity.name} {\n${body}\n}`
    : `${keyword} ${entity.name} {}`;
}

/** Render the generated mapping, preserving the semantic arrow order. */
function renderMapping(mapping) {
  const lines = [
    `mapping ${mapping.name} {`,
    `  source { ${mapping.sources.join(", ")} }`,
    `  target { ${mapping.targets.join(", ")} }`,
    ...mapping.arrows.map((arrow) => `  ${arrow.sources.join(", ")} -> ${arrow.target}`),
    "}",
  ];
  return lines.join("\n");
}

/** Render one semantic scenario into a complete Satsuma source file. */
export function renderScenario(scenario) {
  return [
    ...scenario.fragments.map((fragment) => renderEntity("fragment", fragment)),
    ...scenario.schemas.map((schema) => renderEntity("schema", schema)),
    renderMapping(scenario.mapping),
  ].join("\n\n");
}

/**
 * Parse generated source and reject every ERROR or MISSING recovery node.
 *
 * The source is included in the assertion message. When fast-check shrinks a
 * failure, its seed/path report therefore sits beside the final shrunk Satsuma
 * input instead of an opaque semantic object.
 */
export function parseGeneratedScenario(scenario) {
  const source = renderScenario(scenario);
  const tree = getParser().parse(source);
  assert.ok(tree, `generated Satsuma returned no parse tree:\n${source}`);
  const errors = collectParseErrors(tree);
  assert.deepEqual(errors, [], `generated Satsuma must be recovery-free:\n${source}`);
  return { source, tree };
}

/** Project extracted fields onto the deliberately narrow coverage input shape. */
function toCoverageFields(fields) {
  return fields.map((field) => ({
    name: field.name,
    line: field.startRow,
    ...(declaresRecordBody(field.type) ? { container: true } : {}),
    children: field.children ? toCoverageFields(field.children) : undefined,
  }));
}

/** Canonical key for a generated schema or fragment extracted from the CST. */
function entityKey(entity) {
  assert.ok(entity.name, "generated entities always carry a name");
  return entity.namespace ? `${entity.namespace}::${entity.name}` : entity.name;
}

/**
 * Run the production parser, extraction, spread expansion, and coverage path.
 *
 * Expected values are intentionally not built here. Each property states its
 * invariant directly, while R4 will supply the independent semantic oracle.
 */
export function coverageForScenario(scenario) {
  const { source, tree } = parseGeneratedScenario(scenario);
  const fragments = new Map(
    extractFragments(tree.rootNode).map((fragment) => [entityKey(fragment), fragment]),
  );
  const resolveFragment = makeEntityRefResolver(fragments);
  const lookupFragment = (key) => fragments.get(key) ?? null;
  const schemas = new Map(
    extractSchemas(tree.rootNode).map((schema) => {
      const fields = expandDeclaredFields(
        schema,
        schema.namespace,
        resolveFragment,
        lookupFragment,
      );
      return [
        entityKey(schema),
        { uri: "file:///generated.stm", fields: toCoverageFields(fields) },
      ];
    }),
  );
  const result = computeMappingCoverage(
    tree,
    scenario.mapping.name,
    (schemaId) => schemas.get(schemaId) ?? null,
  );
  return { source, tree, result };
}

// ── Scenario arbitraries ───────────────────────────────────────────────────

/** Non-empty generated leaf count shared by coverage domains. */
const leafCountArbitrary = fc.integer({ min: 1, max: MAX_GENERATED_LEAVES });

/**
 * Non-empty schemas at an exact coverage endpoint: either no arrow or one for
 * every leaf. Used to enforce ADR-040's exact 0% and 100% meanings.
 */
export const coverageEndpointScenarioArbitrary = leafCountArbitrary.chain((leafCount) =>
  fc.boolean().map((complete) => {
    const names = leafNames(leafCount);
    const fields = names.map(scalarField);
    return {
      scenario: mappingScenario({
        sourceFields: fields,
        targetFields: fields,
        arrows: complete ? names.map((name) => ({ sources: [name], target: name })) : [],
      }),
      complete,
      leafCount,
    };
  }),
);

/**
 * A fragment spread whose generated fields may also be declared explicitly in
 * the target body. The body declaration must shadow, never duplicate, a spread.
 */
export const spreadRedeclarationScenarioArbitrary = leafCountArbitrary.chain((leafCount) => {
  const names = leafNames(leafCount);
  return fc.subarray(names).map((redeclared) => ({
    scenario: {
      fragments: [{ name: "shared_fields", fields: names.map(scalarField) }],
      schemas: [
        { name: "src", fields: [scalarField("source_value")] },
        {
          name: "tgt",
          fields: [scalarField("body_only"), ...redeclared.map(scalarField)],
          spreads: ["shared_fields"],
        },
      ],
      mapping: { name: "load", sources: ["src"], targets: ["tgt"], arrows: [] },
    },
    expectedPaths: ["body_only", ...names],
  }));
});

/** A record-to-record correspondence with a bounded nested leaf subtree. */
export const wholeStructureScenarioArbitrary = leafCountArbitrary
  .chain((leafCount) =>
    fc.integer({ min: 0, max: 2 }).map((extraDepth) => ({ leafCount, extraDepth })),
  )
  .map(({ leafCount, extraDepth }) => {
    const leaves = leafNames(leafCount).map(scalarField);
    const sourceChildren = extraDepth > 0 ? nestFields(leaves, extraDepth) : leaves;
    const targetChildren = extraDepth > 0 ? nestFields(leaves, extraDepth) : leaves;
    const sourceFields = [recordField("source_record", sourceChildren)];
    const targetFields = [recordField("target_record", targetChildren)];
    return {
      scenario: mappingScenario({
        sourceFields,
        targetFields,
        arrows: [{ sources: ["source_record"], target: "target_record" }],
      }),
      expectedTargetLeaves: semanticLeafPaths(targetFields),
    };
  });

/** Scalar and unresolved sources are the two fail-closed branches of ADR-038. */
export const nonContainerSourceScenarioArbitrary = leafCountArbitrary.chain((leafCount) =>
  fc.constantFrom("scalar", "unresolved").map((sourceKind) => {
    const targetFields = [recordField("target_record", leafNames(leafCount).map(scalarField))];
    const scalarSource = sourceKind === "scalar";
    return {
      scenario: {
        fragments: [],
        schemas: [
          ...(scalarSource ? [{ name: "src", fields: [scalarField("source_value")] }] : []),
          { name: "tgt", fields: targetFields },
        ],
        mapping: {
          name: "load",
          sources: [scalarSource ? "src" : "missing_src"],
          targets: ["tgt"],
          arrows: [
            {
              sources: [scalarSource ? "source_value" : "unresolved_value"],
              target: "target_record",
            },
          ],
        },
      },
      sourceKind,
      expectedTargetLeaves: semanticLeafPaths(targetFields),
    };
  }),
);

/** One valid dotted path with identifiers that cannot collide with schema names. */
export const dottedPathArbitrary = fc
  .array(fc.integer({ min: 0, max: 20 }), { minLength: 1, maxLength: 5 })
  .map((parts) => parts.map((part, index) => `segment_${index}_${part}`).join("."));

/** Several direct paths for checking the union of all derived proper prefixes. */
export const dottedPathsArbitrary = fc
  .array(dottedPathArbitrary, {
    minLength: 1,
    maxLength: MAX_GENERATED_LEAVES,
  })
  .map((localPaths) => {
    const paths = localPaths.map((path, index) => `root_${index}.${path}`);
    const fields = localPaths.map((path, index) =>
      recordField(`root_${index}`, fieldTreeForPath(path)),
    );
    return {
      paths,
      scenario: mappingScenario({ sourceFields: fields, targetFields: fields, arrows: [] }),
    };
  });

/** Authored refs covering schema-local, own-schema, and other-schema spellings. */
export const schemaLocalRefScenarioArbitrary = fc
  .record({
    schemaId: fc.integer({ min: 0, max: 20 }),
    otherId: fc.integer({ min: 0, max: 20 }),
    localPath: dottedPathArbitrary,
  })
  .map(({ schemaId, otherId, localPath }) => {
    const ownSchema = `schema_${schemaId}`;
    const otherSchema = `other_${schemaId}_${otherId}`;
    const fields = fieldTreeForPath(localPath);
    return {
      ownSchema,
      otherSchema,
      localPath,
      scenario: {
        fragments: [],
        schemas: [
          { name: ownSchema, fields },
          { name: otherSchema, fields },
          { name: "tgt", fields: [scalarField("result")] },
        ],
        mapping: {
          name: "load",
          sources: [ownSchema, otherSchema],
          targets: ["tgt"],
          arrows: [],
        },
      },
    };
  });

/**
 * Two isomorphic scenarios: one flat and one under a generated record chain,
 * with every arrow rewritten through the same path bijection.
 */
export const renestingScenarioArbitrary = leafCountArbitrary.chain((leafCount) => {
  const names = leafNames(leafCount);
  return fc.tuple(fc.subarray(names), fc.integer({ min: 1, max: 3 })).map(([covered, depth]) => {
    const flatFields = names.map(scalarField);
    const nestedFields = nestFields(flatFields, depth);
    return {
      flat: mappingScenario({
        sourceFields: flatFields,
        targetFields: flatFields,
        arrows: covered.map((path) => ({ sources: [path], target: path })),
      }),
      nested: mappingScenario({
        sourceFields: nestedFields,
        targetFields: nestedFields,
        arrows: covered.map((path) => ({
          sources: [nestedPath(path, depth)],
          target: nestedPath(path, depth),
        })),
      }),
    };
  });
});

/** A valid mapping before and after adding one previously absent leaf arrow. */
export const monotonicScenarioArbitrary = leafCountArbitrary.chain((leafCount) =>
  fc.integer({ min: 0, max: leafCount - 1 }).chain((addedIndex) => {
    const names = leafNames(leafCount);
    const addedPath = names[addedIndex];
    const candidates = names.filter((name) => name !== addedPath);
    return fc.subarray(candidates).map((initiallyCovered) => {
      const fields = names.map(scalarField);
      const arrows = initiallyCovered.map((path) => ({ sources: [path], target: path }));
      return {
        before: mappingScenario({ sourceFields: fields, targetFields: fields, arrows }),
        after: mappingScenario({
          sourceFields: fields,
          targetFields: fields,
          arrows: [...arrows, { sources: [addedPath], target: addedPath }],
        }),
        addedPath,
      };
    });
  }),
);

/**
 * General recovery-free semantic inputs reused by generated formatter tests.
 * The union deliberately includes flat, nested, whole-structure, unresolved,
 * and spread/redeclaration forms instead of generating grammar text directly.
 */
export const semanticScenarioArbitrary = fc.oneof(
  coverageEndpointScenarioArbitrary.map(({ scenario }) => scenario),
  spreadRedeclarationScenarioArbitrary.map(({ scenario }) => scenario),
  wholeStructureScenarioArbitrary.map(({ scenario }) => scenario),
  nonContainerSourceScenarioArbitrary.map(({ scenario }) => scenario),
  renestingScenarioArbitrary.map(({ nested }) => nested),
  monotonicScenarioArbitrary.map(({ after }) => after),
);

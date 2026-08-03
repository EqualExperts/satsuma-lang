/**
 * arbitraries.js — fast-check generators over the scenario model.
 *
 * Each arbitrary is a *named semantic family*, not an arbitrary text generator:
 * it produces the smallest scenario shape that exercises one rule, together with
 * whatever ground truth follows from the shape by construction (an expected path
 * set, a leaf count, a bijection between two scenarios). Properties assert
 * against that, never against a second implementation of the rule.
 *
 * Owns: the generated input domains and their by-construction expectations.
 * Does not own: rendering (render.js) or any production pipeline call — those
 * belong to the consuming package's adapter.
 */

import fc from "fast-check";
import {
  fieldTreeForPath,
  leafNames,
  mappingScenario,
  MAX_GENERATED_LEAVES,
  nestedPath,
  nestFields,
  recordField,
  scalarField,
  semanticLeafPaths,
} from "./model.js";

/** Enough runs to explore combinations while keeping the full repository suite quick. */
const GENERATED_PROPERTY_RUNS = 100;

/** Shared fast-check settings; fast-check adds the replay seed and path on failure. */
export const GENERATED_PROPERTY_PARAMETERS = Object.freeze({
  numRuns: GENERATED_PROPERTY_RUNS,
  verbose: true,
  // fast-check 4 omits the thrown assertion by default. Keeping it in the
  // report is what places the final shrunk Satsuma beside the seed and path.
  includeErrorInReport: true,
});

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
 * A nested leaf and a top-level leaf sharing one name, with only the nested
 * path referenced. This is the smallest family that distinguishes path
 * identity from the bare-segment registration defect behind sl-joeq.
 */
export const repeatedNameScenarioArbitrary = leafCountArbitrary.map((leafCount) => {
  const repeatedName = "shared_value";
  const siblingLeaves = leafNames(leafCount).map(scalarField);
  const fields = [
    scalarField(repeatedName),
    recordField("group", [scalarField(repeatedName), ...siblingLeaves]),
  ];
  return mappingScenario({
    sourceFields: fields,
    targetFields: fields,
    arrows: [{ sources: [`group.${repeatedName}`], target: `group.${repeatedName}` }],
  });
});

/**
 * Scenarios broad enough for an independent oracle to cross-check the full
 * production parser/extraction boundary, including every R3 semantic family.
 */
export const differentialCoverageScenarioArbitrary = fc.oneof(
  coverageEndpointScenarioArbitrary.map(({ scenario }) => scenario),
  spreadRedeclarationScenarioArbitrary.map(({ scenario }) => scenario),
  wholeStructureScenarioArbitrary.map(({ scenario }) => scenario),
  nonContainerSourceScenarioArbitrary.map(({ scenario }) => scenario),
  renestingScenarioArbitrary.map(({ nested }) => nested),
  monotonicScenarioArbitrary.map(({ after }) => after),
  repeatedNameScenarioArbitrary,
);

/**
 * General recovery-free semantic inputs reused by generated formatter tests.
 * The union deliberately includes flat, nested, whole-structure, unresolved,
 * and spread/redeclaration forms instead of generating grammar text directly.
 */
export const semanticScenarioArbitrary = differentialCoverageScenarioArbitrary;

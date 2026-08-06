/**
 * scenario-pipeline.js — drive core's production pipeline with a generated scenario.
 *
 * The generator itself lives in `@satsuma/scenario-gen`, which deliberately
 * knows nothing about `@satsuma/core` (see that package's index.js for why the
 * dependency may not go the other way). This module is core's half of the
 * arrangement: the thin adapter that renders a scenario, parses it strictly, and
 * runs it through core's real extraction and coverage path.
 *
 * Every consuming package owns an equivalent adapter beside the pipeline it
 * drives. Keeping the adapters out of the generator package is what stops the
 * generator becoming a second production implementation of Satsuma's semantics.
 *
 * Owns: parse-and-assert, and the core coverage pipeline call. Does not own:
 * expected coverage values — each property states its own invariant.
 */

import assert from "node:assert/strict";
import {
  collectParseErrors,
  computeMappingCoverage,
  createCanonicalEntityRef,
  declaresRecordBody,
  expandDeclaredFields,
  extractFragments,
  extractSchemas,
  getParser,
  makeEntityRefResolver,
} from "@satsuma/core";
import { renderScenario, renderWorkspace } from "@satsuma/scenario-gen";

/**
 * Parse generated source and reject every ERROR or MISSING recovery node.
 *
 * The source is included in the assertion message. When fast-check shrinks a
 * failure, its seed/path report therefore sits beside the final shrunk Satsuma
 * input instead of an opaque semantic object.
 */
export function parseGeneratedScenario(scenario) {
  const source = renderScenario(scenario);
  return { source, tree: parseStrictly(source) };
}

/** Parse one already-rendered source string, rejecting every recovery node. */
function parseStrictly(source) {
  const tree = getParser().parse(source);
  assert.ok(tree, `generated Satsuma returned no parse tree:\n${source}`);
  const errors = collectParseErrors(tree);
  assert.deepEqual(errors, [], `generated Satsuma must be recovery-free:\n${source}`);
  return tree;
}

/**
 * Every file of a generated *workspace*, rendered and parsed one file at a time.
 *
 * Core is a single-file library — it has no workspace loader, and resolving the
 * `import` graph is a consumer concern (the CLI's and the LSP's adapters each own
 * their own). A core-level property that holds per file therefore needs no loader:
 * the formatter, and the extraction it must not disturb, both operate on one file.
 *
 * The workspace domain is worth reaching from core because it is the only place
 * multi-source arrows, `each`/`flatten` containers, NL `@ref`s, namespaces,
 * computed arrows and metric metadata are generated — none of which
 * `semanticScenarioArbitrary`'s single-mapping shapes produce.
 *
 * @param {import("@satsuma/scenario-gen").ScenarioWorkspace} workspace
 * @returns {Array<{ path: string, source: string, tree: import("@satsuma/core").Tree }>}
 */
export function parseGeneratedWorkspaceFiles(workspace) {
  return renderWorkspace(workspace).map(({ path, source }) => ({
    path,
    source,
    tree: parseStrictly(source),
  }));
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
 * invariant directly, because for coverage a restated expectation would be a
 * second implementation of the same ADRs.
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
      const key = entityKey(schema);
      const fields = expandDeclaredFields(
        schema,
        schema.namespace,
        resolveFragment,
        lookupFragment,
      );
      return [
        key,
        {
          canonicalRef: createCanonicalEntityRef(key.includes("::") ? key : `::${key}`),
          uri: "file:///generated.stm",
          fields: toCoverageFields(fields),
        },
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

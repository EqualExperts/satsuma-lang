/**
 * generated-coverage-properties.test.js — Generated checks for settled coverage rules.
 *
 * Hand-authored regressions remain the clearest examples of known defects.
 * These bounded fast-check properties explore combinations their authors did
 * not select, while rendering every semantic input through the real parser and
 * extraction boundary before asserting coverage behaviour.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import {
  buildCoveredFieldPaths,
  createAuthoredEntityRef,
  createCanonicalEntityRef,
  createContainerQualifiedFieldRef,
  initParser,
  leafFieldEntries,
  schemaLocalFieldPath,
  summarizeFieldCoverage,
} from "@satsuma/core";
import {
  coverageEndpointScenarioArbitrary,
  dottedPathsArbitrary,
  GENERATED_PROPERTY_PARAMETERS,
  monotonicScenarioArbitrary,
  nonContainerSourceScenarioArbitrary,
  renestingScenarioArbitrary,
  schemaLocalRefScenarioArbitrary,
  spreadRedeclarationScenarioArbitrary,
  wholeStructureScenarioArbitrary,
} from "@satsuma/scenario-gen";
import { coverageForScenario, parseGeneratedScenario } from "./support/scenario-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

/** Return the one schema coverage entry for a generated mapping role. */
function forRole(result, role, source) {
  const schema = result.schemas.find((entry) => entry.role === role);
  assert.ok(schema, `expected generated ${role} coverage:\n${source}`);
  return schema;
}

/** Sorted array form keeps set equality failures concise and deterministic. */
function sorted(values) {
  return [...values].sort();
}

/** All proper dotted prefixes of one path, shortest first. */
function properPrefixes(path) {
  const parts = path.split(".");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("."));
}

/** Covered leaf paths from one generated schema result. */
function coveredLeaves(schema) {
  return new Set(
    leafFieldEntries(schema.fields)
      .filter((field) => field.mapped)
      .map((f) => f.path),
  );
}

/** Run a generated reference through the explicit R5 localization stages. */
function localizeGenerated(fieldRef, ownSchema, otherSchema) {
  return schemaLocalFieldPath(
    createContainerQualifiedFieldRef(fieldRef),
    createAuthoredEntityRef(ownSchema),
    createCanonicalEntityRef(`::${ownSchema}`),
    [createAuthoredEntityRef(otherSchema)],
  );
}

describe("generated coverage invariants", () => {
  it("reserves 0% and 100% for the exact uncovered and complete endpoints", () => {
    // ADR-040: on every non-empty generated schema, an endpoint percentage is
    // an exact claim about every leaf rather than a rounding bucket.
    fc.assert(
      fc.property(coverageEndpointScenarioArbitrary, ({ scenario, complete, leafCount }) => {
        const { source, result } = coverageForScenario(scenario);
        const target = forRole(result, "target", source);
        const totals = summarizeFieldCoverage(target.fields);
        assert.equal(totals.total, leafCount, `generated denominator changed:\n${source}`);
        assert.equal(
          totals.covered,
          complete ? leafCount : 0,
          `generated endpoint count is not exact:\n${source}`,
        );
        assert.equal(
          totals.pct,
          complete ? 100 : 0,
          `generated endpoint percentage is not exact:\n${source}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("emits one coverage entry per qualified path after spread expansion", () => {
    // ADR-041: a body declaration shadows a spread field, so writing the same
    // name through both routes cannot duplicate a coverage row or denominator.
    fc.assert(
      fc.property(spreadRedeclarationScenarioArbitrary, ({ scenario, expectedPaths }) => {
        const { source, result } = coverageForScenario(scenario);
        const paths = forRole(result, "target", source).fields.map((field) => field.path);
        assert.equal(
          paths.length,
          new Set(paths).size,
          `generated spread produced duplicate coverage paths:\n${source}`,
        );
        assert.deepEqual(
          sorted(paths),
          sorted(expectedPaths),
          `generated spread changed the declared path set:\n${source}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("covers every target leaf under a record-to-record whole-structure arrow", () => {
    // ADR-037 constrained by ADR-038: a correspondence carrying a declared
    // record populates the target record's entire declared leaf subtree.
    fc.assert(
      fc.property(wholeStructureScenarioArbitrary, ({ scenario, expectedTargetLeaves }) => {
        const { source, result } = coverageForScenario(scenario);
        const target = forRole(result, "target", source);
        const covered = coveredLeaves(target);
        assert.deepEqual(
          sorted(covered),
          sorted(expectedTargetLeaves),
          `generated whole-structure arrow missed a target leaf:\n${source}`,
        );
        assert.equal(
          summarizeFieldCoverage(target.fields).pct,
          100,
          `generated record correspondence must be complete:\n${source}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("never expands a target record from a scalar or unresolved source", () => {
    // ADR-038's fail-closed rule: neither a declared scalar nor an unresolved
    // path is evidence that every target-record leaf has been populated.
    fc.assert(
      fc.property(
        nonContainerSourceScenarioArbitrary,
        ({ scenario, sourceKind, expectedTargetLeaves }) => {
          const { source, result } = coverageForScenario(scenario);
          const target = forRole(result, "target", source);
          const leafByPath = new Map(leafFieldEntries(target.fields).map((f) => [f.path, f]));
          for (const path of expectedTargetLeaves) {
            assert.equal(
              leafByPath.get(path)?.mapped,
              false,
              `${sourceKind} source expanded generated target leaf ${path}:\n${source}`,
            );
          }
          assert.equal(
            summarizeFieldCoverage(target.fields).pct,
            0,
            `${sourceKind} source manufactured generated target coverage:\n${source}`,
          );
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("derives exactly the proper dotted prefixes of every direct path", () => {
    // coverage-paths.ts contract: `ancestors` is a derived prefix set, never a
    // bag of bare segments or a place for unrelated paths.
    fc.assert(
      fc.property(dottedPathsArbitrary, ({ paths, scenario }) => {
        const { source } = parseGeneratedScenario(scenario);
        const covered = buildCoveredFieldPaths(paths);
        const expectedAncestors = new Set(paths.flatMap(properPrefixes));
        assert.deepEqual(
          sorted(covered.direct),
          sorted(new Set(paths)),
          `generated direct paths changed:\n${source}`,
        );
        assert.deepEqual(
          sorted(covered.ancestors),
          sorted(expectedAncestors),
          `generated ancestor paths changed:\n${source}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("leaves a ref already known to be schema-local unchanged", () => {
    // schemaLocalFieldPath contract: normalization must not edit an authored
    // local path merely because it contains several dotted segments.
    fc.assert(
      fc.property(
        schemaLocalRefScenarioArbitrary,
        ({ ownSchema, otherSchema, localPath, scenario }) => {
          const { source } = parseGeneratedScenario(scenario);
          assert.equal(
            localizeGenerated(localPath, ownSchema, otherSchema),
            localPath,
            `generated schema-local ref changed:\n${source}`,
          );
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("rejects a ref belonging to another participating schema", () => {
    // schemaLocalFieldPath contract: a multi-source sibling claims its own
    // qualified ref; the schema currently being reported must return null.
    fc.assert(
      fc.property(
        schemaLocalRefScenarioArbitrary,
        ({ ownSchema, otherSchema, localPath, scenario }) => {
          const { source } = parseGeneratedScenario(scenario);
          assert.equal(
            localizeGenerated(`${otherSchema}.${localPath}`, ownSchema, otherSchema),
            null,
            `generated other-schema ref was claimed locally:\n${source}`,
          );
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("removes an unshadowed own-schema prefix exactly once", () => {
    // schemaLocalFieldPath contract: the schema prefix is one normalization
    // stage, so stripping it must yield the untouched schema-local remainder.
    fc.assert(
      fc.property(
        schemaLocalRefScenarioArbitrary,
        ({ ownSchema, otherSchema, localPath, scenario }) => {
          const { source } = parseGeneratedScenario(scenario);
          assert.equal(
            localizeGenerated(`${ownSchema}.${localPath}`, ownSchema, otherSchema),
            localPath,
            `generated own-schema prefix did not normalize once:\n${source}`,
          );
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("preserves the leaf coverage ratio under structure-preserving re-nesting", () => {
    // Feature 38 depth-invariance goal: adding record structure and rewriting
    // every arrow through the same path bijection cannot move a leaf ratio.
    fc.assert(
      fc.property(renestingScenarioArbitrary, ({ flat, nested }) => {
        const flatCoverage = coverageForScenario(flat);
        const nestedCoverage = coverageForScenario(nested);
        const flatTotals = summarizeFieldCoverage(
          forRole(flatCoverage.result, "target", flatCoverage.source).fields,
        );
        const nestedTotals = summarizeFieldCoverage(
          forRole(nestedCoverage.result, "target", nestedCoverage.source).fields,
        );
        assert.deepEqual(
          nestedTotals,
          flatTotals,
          `re-nesting changed generated leaf coverage:\nFLAT\n${flatCoverage.source}\nNESTED\n${nestedCoverage.source}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("cannot remove a covered leaf when one valid arrow is added", () => {
    // Coverage monotonicity: adding a valid declaration may cover another leaf
    // but must never invalidate a leaf that `--fail-under` already counted.
    fc.assert(
      fc.property(monotonicScenarioArbitrary, ({ before, after, addedPath }) => {
        const beforeCoverage = coverageForScenario(before);
        const afterCoverage = coverageForScenario(after);
        const beforeCovered = coveredLeaves(
          forRole(beforeCoverage.result, "target", beforeCoverage.source),
        );
        const afterCovered = coveredLeaves(
          forRole(afterCoverage.result, "target", afterCoverage.source),
        );
        for (const path of beforeCovered) {
          assert.equal(
            afterCovered.has(path),
            true,
            `adding ${addedPath} removed generated coverage for ${path}:\n${afterCoverage.source}`,
          );
        }
        assert.equal(
          afterCovered.has(addedPath),
          true,
          `added generated arrow did not cover ${addedPath}:\n${afterCoverage.source}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

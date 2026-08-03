/**
 * generated-coverage-oracle.test.js — Differential coverage verification.
 *
 * The expected result comes from a semantic, test-only oracle. The actual
 * result crosses the real renderer, parser, extractor, spread expander, and
 * coverage implementation so drift at any production boundary is observable.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { initParser, summarizeFieldCoverage } from "@satsuma/core";
import { coverageOracleForScenario } from "./support/coverage-oracle.js";
import {
  differentialCoverageScenarioArbitrary,
  GENERATED_PROPERTY_PARAMETERS,
} from "@satsuma/scenario-gen";
import { coverageForScenario } from "./support/scenario-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

/** Keep only the production facts the semantic oracle is responsible for. */
function comparableProductionResult(result) {
  return result.schemas.map((schema) => ({
    schemaId: schema.schemaId,
    role: schema.role,
    fields: schema.fields.map((field) => ({
      path: field.path,
      mapped: field.mapped,
      state: field.state,
    })),
    totals: summarizeFieldCoverage(schema.fields),
  }));
}

describe("generated coverage oracle", () => {
  it("agrees with production after parsing and extracting every semantic scenario", () => {
    // Feature 39 R4: an independent statement of ADR-034–041 must agree field
    // by field and rollup by rollup with the complete production path.
    fc.assert(
      fc.property(differentialCoverageScenarioArbitrary, (scenario) => {
        const production = coverageForScenario(scenario);
        const oracle = coverageOracleForScenario(scenario);
        assert.deepEqual(
          comparableProductionResult(production.result),
          oracle,
          `production coverage diverged from the semantic oracle:\n${production.source}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

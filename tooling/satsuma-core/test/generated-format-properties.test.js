/**
 * generated-format-properties.test.js — Formatter properties over generated Satsuma.
 *
 * These checks extend the canonical examples corpus with bounded semantic
 * scenarios from `@satsuma/scenario-gen`. Inputs are rendered from declarations
 * and mappings, not arbitrary grammar text, and must parse without recovery
 * before the formatter is allowed to run.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { collectParseErrors, format, getParser, initParser } from "@satsuma/core";
import { cstStructure } from "./support/cst-structure.js";
import { GENERATED_PROPERTY_PARAMETERS, semanticScenarioArbitrary } from "@satsuma/scenario-gen";
import { parseGeneratedScenario } from "./support/scenario-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

/** Format one strictly parsed scenario and reparse the formatter output. */
function formatScenario(scenario) {
  const { source, tree } = parseGeneratedScenario(scenario);
  const formatted = format(tree, source);
  const formattedTree = getParser().parse(formatted);
  assert.ok(
    formattedTree,
    `formatter output returned no parse tree:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
  );
  return {
    source,
    sourceTree: tree,
    formatted,
    formattedTree,
    formattedErrors: collectParseErrors(formattedTree),
  };
}

describe("generated formatter properties", () => {
  it("is idempotent over generated recovery-free Satsuma", () => {
    // Formatter idempotence: once canonical layout is produced, a second pass
    // must be byte-identical for every generated semantic scenario.
    fc.assert(
      fc.property(semanticScenarioArbitrary, (scenario) => {
        const { source, formatted, formattedTree, formattedErrors } = formatScenario(scenario);
        assert.deepEqual(
          formattedErrors,
          [],
          `first formatter pass introduced recovery:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
        );
        const formattedTwice = format(formattedTree, formatted);
        assert.equal(
          formattedTwice,
          formatted,
          `formatter is not idempotent:\nSOURCE\n${source}\nFIRST\n${formatted}\nSECOND\n${formattedTwice}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("preserves generated CST structure", () => {
    // Structural equivalence: formatting may change layout and anonymous
    // punctuation placement, never named grammar structure or semantic leaves.
    fc.assert(
      fc.property(semanticScenarioArbitrary, (scenario) => {
        const { source, sourceTree, formatted, formattedTree, formattedErrors } =
          formatScenario(scenario);
        assert.deepEqual(
          formattedErrors,
          [],
          `structural comparison requires a clean reparse:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
        );
        assert.equal(
          cstStructure(formattedTree.rootNode),
          cstStructure(sourceTree.rootNode),
          `formatter changed generated CST structure:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("reparses generated formatter output without recovery nodes", () => {
    // Error-free reparse: a formatter must never turn a valid generated file
    // into one that tree-sitter repairs with ERROR or MISSING nodes.
    fc.assert(
      fc.property(semanticScenarioArbitrary, (scenario) => {
        const { source, formatted, formattedErrors } = formatScenario(scenario);
        assert.deepEqual(
          formattedErrors,
          [],
          `formatter introduced recovery nodes:\nSOURCE\n${source}\nFORMATTED\n${formatted}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

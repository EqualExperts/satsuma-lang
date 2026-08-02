/**
 * parse-errors.test.js — Authoritative tests for CST error-node collection.
 *
 * Validates the behaviour of collectParseErrors() against real parsed Satsuma
 * source snippets so the tests cover end-to-end fidelity (grammar → CST → entry).
 * These tests are the canonical suite; any CLI or LSP tests that re-tested the
 * same walk logic are retired in favour of these.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser, getParser, collectParseErrors } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

function parse(src) {
  return getParser().parse(src);
}

describe("collectParseErrors", () => {
  it("returns an empty array for a clean parse tree", () => {
    // A valid schema must produce zero entries — confirms the function does not
    // generate false positives on well-formed Satsuma source.
    const tree = parse("schema Customers {}");
    const errors = collectParseErrors(tree);
    assert.deepEqual(errors, []);
  });

  it("returns an empty array for a schema with fields", () => {
    // Multi-field schema — ensures the walk doesn't mis-classify valid field nodes.
    const tree = parse("schema Customers {\n  name VARCHAR\n  age INT\n}");
    const errors = collectParseErrors(tree);
    assert.deepEqual(errors, []);
  });

  it("reports an ERROR node for unexpected tokens", () => {
    // ERROR nodes are inserted when the parser cannot match a token sequence.
    // The entry must not be a MISSING node and must carry a descriptive message.
    const tree = parse("schema Customers { %%% }");
    const errors = collectParseErrors(tree);
    assert.ok(errors.length > 0, "must report at least one error for '%%%'");
    const errEntry = errors.find((e) => !e.isMissing);
    assert.ok(errEntry, "must include a non-missing (ERROR) entry");
    assert.match(errEntry.message, /Syntax error/);
    assert.equal(errEntry.isMissing, false);
  });

  it("reports a MISSING node separately from ERROR nodes", () => {
    // MISSING nodes are inserted by the error-recovery parser and carry no source
    // text — they must be reported as distinct entries from ERROR nodes, and the
    // isMissing flag must be set so consumers can apply different formatting.
    // "schema Customers {" is missing its closing brace — the grammar inserts a MISSING node.
    const tree = parse("schema Customers {");
    const errors = collectParseErrors(tree);
    assert.ok(errors.length > 0, "incomplete source must produce at least one entry");
    const missingEntry = errors.find((e) => e.isMissing);
    assert.ok(missingEntry, "must include at least one MISSING entry");
    assert.equal(missingEntry.isMissing, true);
    assert.match(missingEntry.message, /Missing expected/);
  });

  it("positions are 0-indexed (matching tree-sitter native format)", () => {
    // The CLI converts to 1-indexed by adding 1; the LSP uses 0-indexed directly.
    // This test pins the native format so consumers know the contract.
    const tree = parse("%%% bad tokens"); // error at start of file
    const errors = collectParseErrors(tree);
    assert.ok(errors.length > 0);
    // Source starts at line 0, column 0
    const first = errors[0];
    assert.ok(first, "errors array must have at least one entry");
    assert.equal(first.startRow, 0);
    assert.equal(first.startColumn, 0);
  });

  it("message for ERROR nodes includes a preview of the unexpected text", () => {
    // The message preview helps users identify the offending token without reading
    // the full CST — important for long lines where the error spans many tokens.
    const tree = parse("schema Customers { %%% }");
    const errors = collectParseErrors(tree);
    const errEntry = errors.find((e) => !e.isMissing);
    assert.ok(errEntry, "must have at least one ERROR entry");
    assert.match(errEntry.message, /unexpected/i);
  });
});

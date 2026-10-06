/**
 * qualified-name.test.js — namespace-qualified names whose schema side is
 * backtick-quoted (`` raw::`crm-contacts` ``), read from real parses.
 *
 * The grammar accepts a backtick name after `::` in every structural position
 * a qualified_name appears: imports, source/target refs, spreads and metadata
 * values (bsw-iuzs). Each extractor must hand downstream resolution the
 * unquoted `ns::name`, the same key the declared schema is indexed under; a
 * name that kept its backticks would resolve to nothing. The mock-node unit
 * tests for the helpers live in cst-utils.test.js; this suite proves the
 * parsed CST and the helpers agree.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initParser,
  getParser,
  extractImports,
  extractMappings,
  extractSchemas,
  extractMetrics,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

/** Root node of a parse that must be free of syntax errors. */
function parseClean(source) {
  const root = getParser().parse(source).rootNode;
  assert.equal(root.hasError, false, `expected a clean parse of:\n${source}`);
  return root;
}

describe("backtick name after :: (bsw-iuzs)", () => {
  it("extracts an imported ns::`name` unquoted", () => {
    // The import's name is what import reachability matches against the
    // declared schema's key, which has no backticks.
    const root = parseClean('import { raw::`crm-contacts` } from "raw.stm"\n');
    assert.deepEqual(extractImports(root)[0].names, ["raw::crm-contacts"]);
  });

  it("extracts a mapping's ns::`name` source unquoted", () => {
    // The ticket's repro: with backticks kept, the source resolved to no
    // schema and validate reported undefined-ref.
    const root = parseClean(
      "mapping m {\n  source { raw::`crm-contacts` }\n  target { t }\n  id -> id\n}\n",
    );
    assert.deepEqual(extractMappings(root)[0].sources, ["raw::crm-contacts"]);
  });

  it("extracts a spread of ns::`name` unquoted", () => {
    // Spread expansion looks the fragment up by this name.
    const root = parseClean("schema s {\n  ...raw::`audit fields`\n}\n");
    assert.deepEqual(extractSchemas(root)[0].spreads, ["raw::audit fields"]);
  });

  it("extracts a metric's ns::`name` source unquoted", () => {
    // A metric's `source` metadata names schemas the same way a mapping does.
    const root = parseClean(
      "schema revenue (metric, source raw::`order-lines`) {\n  value DECIMAL\n}\n",
    );
    assert.deepEqual(extractMetrics(root)[0].sources, ["raw::order-lines"]);
  });
});

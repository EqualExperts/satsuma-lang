/**
 * Contract tests for the generated TypeScript view of tree-sitter symbols.
 *
 * The generator is tested independently of tree-sitter so drift detection stays
 * deterministic and failures identify the contract boundary directly.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkGeneratedContract,
  classifyNodeTypes,
  renderCstSymbolContract,
} from "./generate-cst-symbols.mjs";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const NODE_TYPES_PATH = path.join(PACKAGE_ROOT, "src", "node-types.json");

test("the real grammar exposes the measured 62 named and 41 anonymous symbols", () => {
  // Feature 39's contract is useful only if it includes anonymous tokens as
  // well as named nodes; these counts pin the reviewed grammar surface. The
  // two named nodes (parent_path, root_path) and two anonymous tokens ("^.",
  // "$.") joined with ADR-053's ancestor escape paths.
  const nodeTypes = JSON.parse(fs.readFileSync(NODE_TYPES_PATH, "utf8"));

  const symbols = classifyNodeTypes(nodeTypes);

  assert.equal(symbols.namedKinds.length, 62);
  assert.equal(symbols.anonymousTokens.length, 41);
  assert.deepEqual(
    symbols.anonymousTokens.filter((symbol) =>
      ["record", "list_of", "enum", "slice"].includes(symbol),
    ),
    ["enum", "list_of", "record", "slice"],
  );
});

test("classification sorts each symbol family independently of JSON input order", () => {
  // tree-sitter may reorder node-types.json without changing the grammar; a
  // stable sort prevents that incidental order from churning the public file.
  const symbols = classifyNodeTypes([
    { type: "z_named", named: true },
    { type: "z-token", named: false },
    { type: "a_named", named: true },
    { type: "a-token", named: false },
  ]);

  assert.deepEqual(symbols, {
    namedKinds: ["a_named", "z_named"],
    anonymousTokens: ["a-token", "z-token"],
  });
});

test("the rendered contract includes readonly families and the recovery exception", () => {
  // ERROR is a runtime recovery node rather than a grammar symbol. MISSING
  // nodes retain their expected grammar type and are detected through
  // SyntaxNode.isMissing, so no synthetic MISSING string belongs in the union.
  const output = renderCstSymbolContract({
    namedKinds: ["schema_block"],
    anonymousTokens: ["record"],
  });

  assert.match(output, /SATSUMA_NAMED_KINDS = \["schema_block"\] as const/);
  assert.match(output, /SATSUMA_ANONYMOUS_TOKENS = \["record"\] as const/);
  assert.match(output, /SatsumaGrammarSymbol = SatsumaNamedKind \| SatsumaAnonymousToken/);
  assert.match(output, /SatsumaCstType = SatsumaGrammarSymbol \| "ERROR"/);
  assert.doesNotMatch(output, /"MISSING"/);
});

test("the check-only path rejects a stale committed artifact without rewriting it", (t) => {
  // The gate must be observational: CI should report drift while leaving the
  // developer's tracked artifact untouched for an intelligible git diff.
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "satsuma-cst-contract-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const nodeTypesPath = path.join(fixtureRoot, "node-types.json");
  const outputPath = path.join(fixtureRoot, "cst-types.ts");
  fs.writeFileSync(nodeTypesPath, `${JSON.stringify([{ type: "source_file", named: true }])}\n`);
  fs.writeFileSync(outputPath, "stale output\n");

  assert.throws(
    () => checkGeneratedContract({ nodeTypesPath, outputPath }),
    /Generated CST symbol contract is stale/,
  );
  assert.equal(fs.readFileSync(outputPath, "utf8"), "stale output\n");
});

test("the check-only path accepts the exact deterministic artifact", (t) => {
  // A matching file proves the comparison uses generator output rather than
  // timestamps or other environment-dependent state.
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "satsuma-cst-contract-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const nodeTypesPath = path.join(fixtureRoot, "node-types.json");
  const outputPath = path.join(fixtureRoot, "cst-types.ts");
  const symbols = {
    namedKinds: ["source_file"],
    anonymousTokens: ["schema"],
  };
  fs.writeFileSync(
    nodeTypesPath,
    `${JSON.stringify([
      { type: "schema", named: false },
      { type: "source_file", named: true },
    ])}\n`,
  );
  fs.writeFileSync(outputPath, renderCstSymbolContract(symbols));

  assert.doesNotThrow(() => checkGeneratedContract({ nodeTypesPath, outputPath }));
});

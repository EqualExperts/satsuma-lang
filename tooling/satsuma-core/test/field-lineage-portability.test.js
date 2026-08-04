/**
 * field-lineage-portability.test.js — browser-safety of the shared lineage path.
 *
 * The traversal is moving into core specifically so browser hosts can import it.
 * This test walks TypeScript import declarations from that entry module and fails
 * if any production dependency introduces a Node built-in.
 */

import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import ts from "typescript";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ENTRY_MODULE = resolve(TEST_DIR, "../src/field-lineage.ts");
const NODE_BUILT_INS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** Return the static module specifiers declared by one TypeScript source file. */
function importSpecifiers(file) {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const specifiers = [];

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

/** Follow relative production imports, returning every reachable module specifier. */
function productionModuleGraph(entry) {
  const pending = [entry];
  const visited = new Set();
  const imports = [];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    for (const specifier of importSpecifiers(file)) {
      imports.push({ file, specifier });
      if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      }
    }
  }

  return imports;
}

it("keeps every module reachable from field lineage free of Node built-ins", () => {
  // A browser bundle fails transitively: checking only the entry file would miss
  // an fs/path/url import introduced one helper away from the public API.
  const forbidden = productionModuleGraph(ENTRY_MODULE).filter(({ specifier }) =>
    NODE_BUILT_INS.has(specifier),
  );

  assert.deepEqual(forbidden, []);
});

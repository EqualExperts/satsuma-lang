/**
 * prebuild-wiring.test.ts — every `@satsuma/*` package a test file imports
 * must be built by `prebuild`.
 *
 * Regression for cbdr-xgy5 (Feature 39 R6): `test/coverage-viz-parity.test.ts`
 * imports `@satsuma/viz-backend`, a devDependency used only by tests, but
 * `prebuild` built only `@satsuma/core`. `npm test` still passed because a
 * prior monorepo-wide install (or CI's shared `install` job) happened to have
 * already built `viz-backend`'s `dist/` — the gap was invisible until the CLI
 * package was built and tested in isolation, when `test:typecheck` failed
 * with "Cannot find module '@satsuma/viz-backend/workspace-index'". This test
 * statically re-derives the same gap: it scans test sources for `@satsuma/*`
 * imports and checks `prebuild` names a `build:<package>` step for each one,
 * so a future cross-package test import can't silently reintroduce it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, "..");

/** `@satsuma/<name>` package names referenced by any `import` in test/*.test.ts. */
function satsumaPackagesImportedByTests(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(join(CLI_ROOT, "test"))) {
    if (!file.endsWith(".test.ts")) continue;
    const source = readFileSync(join(CLI_ROOT, "test", file), "utf8");
    for (const match of source.matchAll(/@satsuma\/([a-z-]+)/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

describe("prebuild builds every @satsuma package the test suite imports", () => {
  it("names a build:<package> step in prebuild for each test-imported package (cbdr-xgy5)", () => {
    const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));
    const prebuildScript: string = pkg.scripts.prebuild;

    for (const name of satsumaPackagesImportedByTests()) {
      const buildScriptName = `build:${name}`;
      assert.match(
        prebuildScript,
        new RegExp(`npm run ${buildScriptName}\\b`),
        `test files import @satsuma/${name}, but prebuild does not run "${buildScriptName}"`,
      );
      assert.match(
        pkg.scripts[buildScriptName] ?? "",
        new RegExp(`--prefix \\.\\./satsuma-${name}\\b`),
        `"${buildScriptName}" does not build the sibling satsuma-${name} package`,
      );
    }
  });
});

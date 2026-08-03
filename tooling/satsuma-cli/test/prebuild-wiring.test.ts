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
 *
 * The rule is about *built output*, not about being a sibling package. A package
 * with no `build` script has no `dist/` to be stale, so requiring a build step for
 * it would be cargo cult — and `@satsuma/scenario-gen` is deliberately such a
 * package (sl-puky: plain ESM with JSDoc types, no build step). For those the test
 * asserts the premise instead: that nothing in the package's `exports` points into
 * `dist/`. A package that grows a built export without a build script is then still
 * caught, which is the failure the original rule was protecting against.
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

/** The sibling package's own manifest, read from `../satsuma-<name>`. */
function siblingManifest(name: string): { scripts?: Record<string, string>; exports?: unknown } {
  return JSON.parse(
    readFileSync(join(CLI_ROOT, "..", `satsuma-${name}`, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string>; exports?: unknown };
}

describe("prebuild builds every @satsuma package the test suite imports", () => {
  it("names a build:<package> step in prebuild for each test-imported package that has built output (cbdr-xgy5)", () => {
    const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));
    const prebuildScript: string = pkg.scripts.prebuild;

    for (const name of satsumaPackagesImportedByTests()) {
      const sibling = siblingManifest(name);

      // A package with no build script has no output to keep current. Assert the
      // premise rather than skipping: if it ever exports from `dist/`, the missing
      // build step is exactly the cbdr-xgy5 failure again.
      if (sibling.scripts?.build === undefined) {
        assert.doesNotMatch(
          JSON.stringify(sibling.exports ?? {}),
          /dist\//,
          `@satsuma/${name} has no build script but exports built output; it needs one, and a build:${name} step here`,
        );
        continue;
      }

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

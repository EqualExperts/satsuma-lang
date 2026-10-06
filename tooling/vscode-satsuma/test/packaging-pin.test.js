/**
 * Guards the supply chain of the .vsix build (bsw-n4mm).
 *
 * `scripts/package.js` used to run `npx --yes @vscode/vsce`, which fetched
 * whatever vsce was newest on the day of the release. That version was in no
 * lockfile, so `npm audit` and Dependabot never saw it, and two releases of the
 * same commit could be packaged by different tools. vsce is now an exactly
 * pinned devDependency and the script runs the installed copy. Only the
 * Release workflow packages the extension, so these checks keep a regression
 * from hiding behind green CI.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const manifest = require("../package.json");

/** An exact semver version: no range operator, no wildcard. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

describe("vsce packaging pin", () => {
  it("declares @vscode/vsce as an exactly pinned devDependency, so the lockfile fixes the packager", () => {
    const declared = manifest.devDependencies["@vscode/vsce"];
    assert.ok(declared, "@vscode/vsce is missing from devDependencies");
    assert.match(
      declared,
      EXACT_VERSION,
      `@vscode/vsce should be pinned exactly, not "${declared}"`,
    );
  });

  it("packages with the installed vsce rather than fetching one through npx", () => {
    const script = readFileSync(path.join(__dirname, "..", "scripts", "package.js"), "utf8");
    assert.doesNotMatch(script, /["']npx["']/, "package.js must not shell out to npx");
  });
});

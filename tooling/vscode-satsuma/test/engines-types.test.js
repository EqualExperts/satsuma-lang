/**
 * engines-types.test.js — the VS Code API types must not run ahead of the
 * oldest VS Code the extension claims to support.
 *
 * `@types/vscode` describes the API the code compiles against;
 * `engines.vscode` is the oldest editor the extension installs on. If the
 * types are newer, the code can call APIs that editor lacks, so
 * `vsce package` refuses to build the .vsix. Only the Release workflow runs
 * `vsce package`, so a Dependabot bump of the types (#553) broke every
 * release for a week behind green CI. This test moves the check into CI.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../package.json");

/**
 * The major.minor floor of a `^x.y.z` or `~x.y.z` range — the oldest
 * version it admits, which is what vsce compares.
 */
function floorOf(range) {
  const match = /^[~^]?(\d+)\.(\d+)\.\d+$/.exec(range);
  assert.ok(match, `unexpected version range "${range}"`);
  return { major: Number(match[1]), minor: Number(match[2]) };
}

describe("VS Code engine and API types", () => {
  it("@types/vscode is no newer than engines.vscode, or vsce package refuses to build", () => {
    const engine = floorOf(manifest.engines.vscode);
    const types = floorOf(manifest.devDependencies["@types/vscode"]);
    assert.ok(
      types.major < engine.major || (types.major === engine.major && types.minor <= engine.minor),
      `@types/vscode ${manifest.devDependencies["@types/vscode"]} is newer than ` +
        `engines.vscode ${manifest.engines.vscode}: raise engines.vscode or pin the types back`,
    );
  });
});

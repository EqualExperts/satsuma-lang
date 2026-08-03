/**
 * Contract tests for release preparation and workflow validation.
 *
 * Fixtures are temporary miniature repositories so failures cannot partially
 * bump the developer's working tree.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RELEASE_PACKAGE_PATHS,
  applyVersionBump,
  extractReleaseNotes,
  promoteUnreleased,
  validateReleaseMetadata,
} from "./release-metadata.mjs";

test("a bump synchronizes every releasable package, including the standalone LSP", (t) => {
  const repoRoot = createFixtureRepo(t);

  applyVersionBump(repoRoot, "0.12.0", "2026-08-03");

  assert.equal(fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8"), "0.12.0\n");
  for (const packagePath of RELEASE_PACKAGE_PATHS) {
    const manifest = readJson(path.join(repoRoot, packagePath));
    const lock = readJson(path.join(repoRoot, path.dirname(packagePath), "package-lock.json"));
    assert.equal(manifest.version, "0.12.0", packagePath);
    assert.equal(lock.version, "0.12.0", `${packagePath} lock root`);
    assert.equal(lock.packages[""].version, "0.12.0", `${packagePath} lock package`);
  }
});

test("promotion preserves accumulated notes under the release and opens a fresh Unreleased section", () => {
  const changelog =
    "# Changelog\n\n## Unreleased\n\n### A real change\n\nDetails.\n\n## v0.11.0 — 2026-07-22\n\nOld notes.\n";

  const promoted = promoteUnreleased(changelog, "0.12.0", "2026-08-03");

  assert.match(promoted, /^# Changelog\n\n## Unreleased\n\n## v0\.12\.0 — 2026-08-03/m);
  assert.match(promoted, /## v0\.12\.0 — 2026-08-03\n\n### A real change\n\nDetails\./);
  assert.equal(promoted.match(/### A real change/g)?.length, 1);
});

test("an empty Unreleased section aborts before any version file is changed", (t) => {
  const repoRoot = createFixtureRepo(t);
  fs.writeFileSync(
    path.join(repoRoot, "CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n<!-- Add release notes here -->\n\n## v0.11.0 — 2026-07-22\n\nOld notes.\n",
  );

  assert.throws(
    () => applyVersionBump(repoRoot, "0.12.0", "2026-08-03"),
    /Unreleased section has no release notes/,
  );
  assert.equal(fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8"), "0.11.0\n");
  assert.equal(readJson(path.join(repoRoot, "tooling/satsuma-lsp/package.json")).version, "0.11.0");
});

test("workflow validation rejects a requested tag that disagrees with VERSION", (t) => {
  const repoRoot = createFixtureRepo(t);

  assert.throws(
    () => validateReleaseMetadata(repoRoot, "v0.12.0"),
    /does not match VERSION \(0\.11\.0\)/,
  );
});

test("workflow validation identifies the exact releasable package left at an old version", (t) => {
  const repoRoot = createFixtureRepo(t);
  applyVersionBump(repoRoot, "0.12.0", "2026-08-03");
  const lspManifestPath = path.join(repoRoot, "tooling/satsuma-lsp/package.json");
  const lspManifest = readJson(lspManifestPath);
  lspManifest.version = "0.11.0";
  fs.writeFileSync(lspManifestPath, `${JSON.stringify(lspManifest, null, 2)}\n`);

  assert.throws(
    () => validateReleaseMetadata(repoRoot, "v0.12.0"),
    /tooling\/satsuma-lsp\/package\.json is 0\.11\.0, expected 0\.12\.0/,
  );
});

test("placeholder comments cannot satisfy the release-note gate", () => {
  const changelog = "# Changelog\n\n## v0.12.0 — 2026-08-03\n\n<!-- Add release notes here -->\n";

  assert.throws(() => extractReleaseNotes(changelog, "v0.12.0"), /has no release notes/);
});

function createFixtureRepo(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "satsuma-release-test-"));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(repoRoot, "VERSION"), "0.11.0\n");
  fs.writeFileSync(
    path.join(repoRoot, "CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n### Covered paths are correct\n\nDetails.\n\n## v0.11.0 — 2026-07-22\n\nOld notes.\n",
  );

  for (const packagePath of RELEASE_PACKAGE_PATHS) {
    const directory = path.join(repoRoot, path.dirname(packagePath));
    fs.mkdirSync(directory, { recursive: true });
    const packageName = path.basename(directory);
    fs.writeFileSync(
      path.join(repoRoot, packagePath),
      `${JSON.stringify({ name: packageName, version: "0.11.0" }, null, 2)}\n`,
    );
    fs.writeFileSync(
      path.join(directory, "package-lock.json"),
      `${JSON.stringify({ name: packageName, version: "0.11.0", packages: { "": { version: "0.11.0" } } }, null, 2)}\n`,
    );
  }
  return repoRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

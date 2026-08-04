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
  ROOT_LOCKFILE_PATH,
  SITE_DATA_PATH,
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
    assert.equal(readJson(path.join(repoRoot, packagePath)).version, "0.12.0", packagePath);
  }
});

test("a bump advances each releasable package's entry in the single root lockfile", (t) => {
  // Since ADR-049 the tooling packages are npm workspaces sharing one lockfile,
  // so the version a `npm ci` reifies lives under packages["tooling/<name>"] —
  // not in a per-package lockfile. A bump that misses it publishes a tarball
  // whose version disagrees with its own manifest.
  const repoRoot = createFixtureRepo(t);

  applyVersionBump(repoRoot, "0.12.0", "2026-08-03");

  const lock = readJson(path.join(repoRoot, ROOT_LOCKFILE_PATH));
  for (const workspaceDir of RELEASE_PACKAGE_PATHS.map(path.dirname)) {
    assert.equal(lock.packages[workspaceDir].version, "0.12.0", workspaceDir);
  }
  // Untouched: a non-releasable member must not be dragged to the release version.
  assert.equal(lock.packages["tooling/satsuma-core"].version, "0.1.0");
});

test("workflow validation names the workspace whose root-lockfile version is stale", (t) => {
  // The lockfile and the manifest are two separate writes, so they can disagree —
  // e.g. after a hand-edited manifest, or a bump interrupted midway. This is the
  // guard that stops such a release reaching the tag.
  const repoRoot = createFixtureRepo(t);
  applyVersionBump(repoRoot, "0.12.0", "2026-08-03");
  const lockPath = path.join(repoRoot, ROOT_LOCKFILE_PATH);
  const lock = readJson(lockPath);
  lock.packages["tooling/satsuma-lsp"].version = "0.11.0";
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  assert.throws(
    () => validateReleaseMetadata(repoRoot, "v0.12.0"),
    /package-lock\.json reports tooling\/satsuma-lsp as 0\.11\.0, expected 0\.12\.0/,
  );
});

test("a bump advances the version the public site advertises", (t) => {
  // Every download link on the site addresses the release assets by tag, so a
  // bump that leaves site.json behind publishes a current site serving the
  // previous release's artifacts. The rendered pages are build output and are
  // deliberately not touched — Eleventy regenerates them from this file.
  const repoRoot = createFixtureRepo(t);

  applyVersionBump(repoRoot, "0.12.0", "2026-08-03");

  assert.deepEqual(readJson(path.join(repoRoot, SITE_DATA_PATH)), {
    version: "v0.12.0",
    version_tag: "v0.12.0",
  });
});

test("workflow validation rejects a release whose site still advertises the previous tag", (t) => {
  // The guard that would have caught v0.12.0 shipping with a v0.11.0 site: a
  // stale value here is invisible in the artifacts and only shows up as users
  // downloading the wrong release.
  const repoRoot = createFixtureRepo(t);
  applyVersionBump(repoRoot, "0.12.0", "2026-08-03");
  const siteDataPath = path.join(repoRoot, SITE_DATA_PATH);
  fs.writeFileSync(
    siteDataPath,
    `${JSON.stringify({ version: "v0.12.0", version_tag: "v0.11.0" }, null, 2)}\n`,
  );

  assert.throws(
    () => validateReleaseMetadata(repoRoot, "v0.12.0"),
    /site\/_data\/site\.json version_tag is v0\.11\.0, expected v0\.12\.0/,
  );
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

  const siteDataPath = path.join(repoRoot, SITE_DATA_PATH);
  fs.mkdirSync(path.dirname(siteDataPath), { recursive: true });
  fs.writeFileSync(
    siteDataPath,
    `${JSON.stringify({ version: "v0.11.0", version_tag: "v0.11.0" }, null, 2)}\n`,
  );

  // The workspace members and the single root lockfile that indexes them, shaped
  // the way `npm install` writes it: one `packages` entry per workspace
  // directory. satsuma-core stands in for a member that is not released, so a
  // bump can be shown not to touch it.
  const lockPackages = {
    "": { name: "satsuma-lang" },
    "tooling/satsuma-core": { version: "0.1.0" },
  };
  for (const packagePath of RELEASE_PACKAGE_PATHS) {
    const workspaceDir = path.dirname(packagePath);
    fs.mkdirSync(path.join(repoRoot, workspaceDir), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, packagePath),
      `${JSON.stringify({ name: path.basename(workspaceDir), version: "0.11.0" }, null, 2)}\n`,
    );
    lockPackages[workspaceDir] = { version: "0.11.0" };
  }
  fs.writeFileSync(
    path.join(repoRoot, ROOT_LOCKFILE_PATH),
    `${JSON.stringify({ name: "satsuma-lang", lockfileVersion: 3, packages: lockPackages }, null, 2)}\n`,
  );
  return repoRoot;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

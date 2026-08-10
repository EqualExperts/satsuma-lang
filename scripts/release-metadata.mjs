/**
 * Owns release-version synchronization, build identity, and changelog promotion.
 *
 * Package prebuilds and the GitHub release workflow delegate here so tagged
 * releases and development artifacts cannot disagree about the version they
 * report. Site-version metadata remains part of release bumps only; development
 * build injection deliberately touches just the three distributable packages.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Package manifests whose versions form the public Satsuma release. */
export const RELEASE_PACKAGE_PATHS = [
  "tooling/satsuma-cli/package.json",
  "tooling/satsuma-lsp/package.json",
  "tooling/vscode-satsuma/package.json",
];

/**
 * The one lockfile covering every `tooling/*` package (ADR-049). It records each
 * workspace member's version under `packages["<workspace dir>"]`, so a release
 * bump has to update it there — the per-package lockfiles that used to hold
 * these versions no longer exist.
 */
export const ROOT_LOCKFILE_PATH = "package-lock.json";

/**
 * Eleventy's global data file, and the only tracked source of the version the
 * public site advertises. Every download link on the site is built from it
 * (`site/cli.njk`, `site/vscode.njk`, `site/learn.njk`, `site/_includes/footer.njk`),
 * so a release that leaves it behind ships a site pointing at the previous
 * tag's artifacts. The rendered pages under `site/_site/` are gitignored build
 * output and must not be edited here — Eleventy regenerates them from this file.
 */
export const SITE_DATA_PATH = "site/_data/site.json";

/** Site fields holding the advertised version, both spelled `vX.Y.Z`. */
const SITE_VERSION_KEYS = ["version", "version_tag"];

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$/;
const VERSION_HEADING_PATTERN = /^## v\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)? — /m;
const HTML_COMMENT_PATTERN = /<!--[^]*?-->/g;

// Git exports these while running hooks. They override a child command's cwd,
// so retaining them would make fixture and nested-worktree discovery inspect
// the caller's repository instead of the repoRoot passed to this module.
const GIT_REPOSITORY_ENV_NAMES = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
];

/** Environment override used by CI to keep every package on one build identity. */
export const BUILD_VERSION_ENV = "BUILD_VERSION";

// ── Build identity ----------------------------------------------------------

/**
 * Resolves the version baked into CLI/LSP code and distributable manifests.
 *
 * An explicit BUILD_VERSION wins so a workflow-dispatched release can request
 * the clean VERSION before its tag exists. Otherwise only HEAD at the matching
 * `v<VERSION>` tag is a release; every other revision carries its short SHA.
 */
export function resolveBuildVersion(
  repoRoot,
  { forceRelease = false, environment = process.env } = {},
) {
  const canonicalVersion = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
  assertVersion(canonicalVersion);

  const override = environment[BUILD_VERSION_ENV];
  if (override) {
    assertVersion(override);
    return override;
  }

  if (forceRelease || isReleaseRevision(repoRoot, canonicalVersion, environment)) {
    return canonicalVersion;
  }

  const shortSha = gitOutput(repoRoot, ["rev-parse", "--short", "HEAD"], environment);
  return `${canonicalVersion}-dev.${shortSha}`;
}

/**
 * Writes a build-only version into the CLI, LSP, and VSIX manifests.
 *
 * The caller owns the checkout lifetime: release CI uses this only in its
 * ephemeral workspace. VERSION, the root lockfile, changelog, and site data are
 * intentionally untouched because they continue to describe the next release.
 */
export function injectBuildVersion(repoRoot, buildVersion) {
  assertVersion(buildVersion);
  const changedPaths = [];
  for (const relativePackagePath of RELEASE_PACKAGE_PATHS) {
    const packagePath = path.join(repoRoot, relativePackagePath);
    const packageJson = readJson(packagePath);
    packageJson.version = buildVersion;
    fs.writeFileSync(packagePath, formatJson(packageJson));
    changedPaths.push(relativePackagePath);
  }
  return changedPaths;
}

function isReleaseRevision(repoRoot, canonicalVersion, environment) {
  try {
    const tag = execFileSync(
      "git",
      ["describe", "--tags", "--exact-match", "--match", `v${canonicalVersion}`, "HEAD"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: environmentForGitCwd(environment),
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return tag === `v${canonicalVersion}`;
  } catch {
    return false;
  }
}

function gitOutput(repoRoot, args, environment) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      env: environmentForGitCwd(environment),
    }).trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot derive build version from git: ${detail}`, { cause: error });
  }
}

function environmentForGitCwd(environment) {
  const cleanEnvironment = { ...environment };
  for (const name of GIT_REPOSITORY_ENV_NAMES) {
    delete cleanEnvironment[name];
  }
  return cleanEnvironment;
}

// ── Release preparation ----------------------------------------------------

/**
 * Moves the current Unreleased body into a dated version section and leaves a
 * fresh Unreleased section ready for the next change.
 */
export function promoteUnreleased(changelog, version, date) {
  const versionHeading = `## v${version} — ${date}`;
  if (changelog.includes(`## v${version} — `)) {
    return changelog;
  }

  const unreleasedHeading = "## Unreleased";
  const unreleasedStart = changelog.indexOf(unreleasedHeading);
  if (unreleasedStart === -1) {
    throw new Error("CHANGELOG.md has no '## Unreleased' section");
  }

  const bodyStart = unreleasedStart + unreleasedHeading.length;
  const followingVersion = changelog.slice(bodyStart).search(VERSION_HEADING_PATTERN);
  const bodyEnd = followingVersion === -1 ? changelog.length : bodyStart + followingVersion;
  const unreleasedBody = changelog.slice(bodyStart, bodyEnd).trim();

  if (!hasMeaningfulNotes(unreleasedBody)) {
    throw new Error("CHANGELOG.md's Unreleased section has no release notes");
  }

  const prefix = changelog.slice(0, unreleasedStart);
  const suffix = changelog.slice(bodyEnd).trimStart();
  return `${prefix}${unreleasedHeading}\n\n${versionHeading}\n\n${unreleasedBody}\n\n${suffix}`;
}

/**
 * Builds every file mutation needed for a version bump before any file is
 * written, preventing a malformed changelog from leaving a partial bump.
 */
export function buildVersionBumpChanges(repoRoot, version, date) {
  assertVersion(version);

  const changes = new Map();
  const versionPath = path.join(repoRoot, "VERSION");
  const oldVersion = fs.readFileSync(versionPath, "utf8").trim();
  changes.set(versionPath, `${version}\n`);

  for (const relativePackagePath of RELEASE_PACKAGE_PATHS) {
    const packagePath = path.join(repoRoot, relativePackagePath);
    const packageJson = readJson(packagePath);
    packageJson.version = version;
    changes.set(packagePath, formatJson(packageJson));
  }

  // One lockfile entry per releasable workspace member, edited in a single pass
  // so the root lockfile is written once no matter how many packages ship.
  const lockPath = path.join(repoRoot, ROOT_LOCKFILE_PATH);
  if (fs.existsSync(lockPath)) {
    const lockJson = readJson(lockPath);
    for (const workspaceDir of RELEASE_PACKAGE_PATHS.map(path.dirname)) {
      if (lockJson.packages?.[workspaceDir]) {
        lockJson.packages[workspaceDir].version = version;
      }
    }
    changes.set(lockPath, formatJson(lockJson));
  }

  const changelogPath = path.join(repoRoot, "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  changes.set(changelogPath, promoteUnreleased(changelog, version, date));

  const siteDataPath = path.join(repoRoot, SITE_DATA_PATH);
  if (fs.existsSync(siteDataPath)) {
    const siteData = readJson(siteDataPath);
    for (const key of SITE_VERSION_KEYS) {
      siteData[key] = `v${version}`;
    }
    changes.set(siteDataPath, formatJson(siteData));
  }

  return { changes, oldVersion };
}

/** Writes a previously validated set of release-preparation changes. */
export function applyVersionBump(repoRoot, version, date) {
  const result = buildVersionBumpChanges(repoRoot, version, date);
  for (const [filePath, contents] of result.changes) {
    fs.writeFileSync(filePath, contents);
  }
  return result;
}

/**
 * Validates that a requested tag, VERSION, releasable packages, and changelog
 * section all describe the same non-empty release.
 */
export function validateReleaseMetadata(repoRoot, tag) {
  if (!tag.startsWith("v")) {
    throw new Error(`Release tag '${tag}' must start with 'v'`);
  }

  const requestedVersion = tag.slice(1);
  assertVersion(requestedVersion);
  const canonicalVersion = fs.readFileSync(path.join(repoRoot, "VERSION"), "utf8").trim();
  if (canonicalVersion !== requestedVersion) {
    throw new Error(`Release tag ${tag} does not match VERSION (${canonicalVersion})`);
  }

  const lockJson = readJson(path.join(repoRoot, ROOT_LOCKFILE_PATH));
  for (const relativePackagePath of RELEASE_PACKAGE_PATHS) {
    const packagePath = path.join(repoRoot, relativePackagePath);
    const packageVersion = readJson(packagePath).version;
    if (packageVersion !== requestedVersion) {
      throw new Error(`${relativePackagePath} is ${packageVersion}, expected ${requestedVersion}`);
    }

    // The lockfile is what a fresh `npm ci` reifies from, so a member left
    // behind there ships a tarball whose version disagrees with its manifest.
    const workspaceDir = path.dirname(relativePackagePath);
    const lockVersion = lockJson.packages?.[workspaceDir]?.version;
    if (lockVersion !== requestedVersion) {
      throw new Error(
        `${ROOT_LOCKFILE_PATH} reports ${workspaceDir} as ${lockVersion}, expected ${requestedVersion}`,
      );
    }
  }

  // The site is checked here rather than left to review because its version is
  // the one users act on: it addresses the release assets by tag, so a stale
  // value serves the previous release's downloads from the current site.
  const siteDataPath = path.join(repoRoot, SITE_DATA_PATH);
  if (fs.existsSync(siteDataPath)) {
    const siteData = readJson(siteDataPath);
    for (const key of SITE_VERSION_KEYS) {
      if (siteData[key] !== tag) {
        throw new Error(`${SITE_DATA_PATH} ${key} is ${siteData[key]}, expected ${tag}`);
      }
    }
  }

  return extractReleaseNotes(fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"), tag);
}

/** Returns one version section after proving that it contains real release notes. */
export function extractReleaseNotes(changelog, tag) {
  const headingPrefix = `## ${tag} — `;
  const lines = changelog.split("\n");
  const startIndex = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (startIndex === -1) {
    throw new Error(`No changelog section found for ${tag}`);
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      endIndex = index;
      break;
    }
  }

  const notes = lines
    .slice(startIndex + 1, endIndex)
    .join("\n")
    .trim();
  if (!hasMeaningfulNotes(notes)) {
    throw new Error(`Changelog section for ${tag} has no release notes`);
  }
  return notes;
}

function assertVersion(version) {
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`Version '${version}' must be semver, for example 0.12.0 or 1.0.0-beta.1`);
  }
}

function hasMeaningfulNotes(notes) {
  return notes.replace(HTML_COMMENT_PATTERN, "").trim().length > 0;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function printUsage() {
  console.error(
    "Usage: node scripts/release-metadata.mjs " +
      "build-version [--release] | inject-build-version <version> | " +
      "bump <version> | validate <tag> | notes <tag>",
  );
}

function runCli() {
  const [command, value] = process.argv.slice(2);
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const repoRoot = defaultRepoRoot();
  if (command === "build-version") {
    if (value && value !== "--release") {
      printUsage();
      process.exitCode = 1;
      return;
    }
    console.log(resolveBuildVersion(repoRoot, { forceRelease: value === "--release" }));
    return;
  }
  if (command === "inject-build-version" && value) {
    const changedPaths = injectBuildVersion(repoRoot, value);
    console.log(`Injected ${value} into ${changedPaths.length} distributable package manifests.`);
    return;
  }
  if (command === "bump") {
    if (!value) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    const { changes, oldVersion } = applyVersionBump(repoRoot, value, date);
    console.log(`Bumped v${oldVersion} to v${value} across ${changes.size} files.`);
    return;
  }
  if (command === "validate") {
    if (!value) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    validateReleaseMetadata(repoRoot, value);
    console.log(`Release metadata is consistent for ${value}.`);
    return;
  }
  if (command === "notes") {
    if (!value) {
      printUsage();
      process.exitCode = 1;
      return;
    }
    const notes = validateReleaseMetadata(repoRoot, value);
    process.stdout.write(`${notes}\n`);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

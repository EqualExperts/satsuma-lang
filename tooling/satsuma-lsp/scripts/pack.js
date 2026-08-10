#!/usr/bin/env node
/**
 * pack.js — package the standalone LSP server, producing satsuma-lsp.tgz.
 *
 * dist/server.js is a self-contained esbuild bundle, so unlike satsuma-cli no
 * dependencies are bundled into the tarball. A temporary staging copy receives
 * the git-derived version before `npm pack`, keeping the tracked release
 * manifest clean during local development. The verification step is
 * the regression guard for sl-vwpr (v0.9.0 shipped a tarball with no WASM,
 * which fails every initialize request on a fresh install).
 *
 * Run via `npm run pack` locally or from scripts/build-artifacts.sh in CI.
 */

const { execFileSync } = require("child_process");
const {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("fs");
const os = require("os");
const path = require("path");

const lspRoot = path.join(__dirname, "..");
const repoRoot = path.join(lspRoot, "..", "..");
const buildVersion = execFileSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "release-metadata.mjs"), "build-version"],
  { cwd: repoRoot, encoding: "utf8" },
).trim();
const stagingRoot = mkdtempSync(path.join(os.tmpdir(), "satsuma-lsp-pack-"));
const stagedPackage = path.join(stagingRoot, "satsuma-lsp");

// --- Step 1: stage the package with its artifact identity -------------------

cpSync(lspRoot, stagedPackage, {
  recursive: true,
  filter: (source) => {
    const relativePath = path.relative(lspRoot, source);
    const firstSegment = relativePath.split(path.sep)[0];
    return (
      firstSegment !== "node_modules" && firstSegment !== ".turbo" && !relativePath.endsWith(".tgz")
    );
  },
});
const stagedManifestPath = path.join(stagedPackage, "package.json");
const stagedManifest = JSON.parse(readFileSync(stagedManifestPath, "utf8"));
stagedManifest.version = buildVersion;
writeFileSync(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`);
console.log(`pack: staged @satsuma/lsp with artifact version ${buildVersion}`);

// --- Step 2: pack and move to a stable filename -----------------------------

let generatedTarball;
try {
  execFileSync("npm", ["pack", "--ignore-scripts"], { cwd: stagedPackage, stdio: "inherit" });
  [generatedTarball] = readdirSync(stagedPackage).filter(
    (file) => file.startsWith("satsuma-lsp-") && file.endsWith(".tgz"),
  );

  if (!generatedTarball) {
    throw new Error("pack: npm pack did not produce a satsuma-lsp-*.tgz file");
  }

  renameSync(path.join(stagedPackage, generatedTarball), path.join(lspRoot, "satsuma-lsp.tgz"));
  console.log(`pack: renamed ${generatedTarball} → satsuma-lsp.tgz`);
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
}

// --- Step 3: verify the tarball ---------------------------------------------

execFileSync("node", ["scripts/verify-pack.js"], {
  cwd: lspRoot,
  stdio: "inherit",
  env: { ...process.env, EXPECTED_ARTIFACT_VERSION: buildVersion },
});

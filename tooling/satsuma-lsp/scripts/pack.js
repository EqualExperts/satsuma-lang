#!/usr/bin/env node
/**
 * pack.js — package the standalone LSP server, producing satsuma-lsp.tgz.
 *
 * dist/server.js is a self-contained esbuild bundle, so unlike satsuma-cli no
 * dependencies are bundled into the tarball — packing is just `npm pack`, a
 * rename to a stable filename, and a content check. The verification step is
 * the regression guard for sl-vwpr (v0.9.0 shipped a tarball with no WASM,
 * which fails every initialize request on a fresh install).
 *
 * Run via `npm run pack` locally or from scripts/build-artifacts.sh in CI.
 */

const { execFileSync } = require("child_process");
const { readdirSync, renameSync } = require("fs");
const path = require("path");

const lspRoot = path.join(__dirname, "..");

// --- Step 1: run npm pack ---------------------------------------------------

execFileSync("npm", ["pack"], { cwd: lspRoot, stdio: "inherit" });

// --- Step 2: rename to a stable filename ------------------------------------

// The package is named @satsuma/lsp, so npm pack emits satsuma-lsp-<ver>.tgz.
const [generatedTarball] = readdirSync(lspRoot).filter(
  (f) => f.startsWith("satsuma-lsp-") && f.endsWith(".tgz"),
);

if (!generatedTarball) {
  throw new Error("pack: npm pack did not produce a satsuma-lsp-*.tgz file");
}

renameSync(path.join(lspRoot, generatedTarball), path.join(lspRoot, "satsuma-lsp.tgz"));
console.log(`pack: renamed ${generatedTarball} → satsuma-lsp.tgz`);

// --- Step 3: verify the tarball ---------------------------------------------

execFileSync("node", ["scripts/verify-pack.js"], { cwd: lspRoot, stdio: "inherit" });

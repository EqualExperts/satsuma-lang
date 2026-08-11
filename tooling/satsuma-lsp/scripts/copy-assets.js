#!/usr/bin/env node
/**
 * copy-assets.js — prepare generated and runtime inputs for the LSP build.
 *
 * This prebuild bakes the shared git-derived build version into a generated
 * source module, then copies the three files server.ts loads from __dirname at
 * initialize time:
 *
 *   - tree-sitter-satsuma.wasm  (the Satsuma grammar)
 *   - tree-sitter.wasm          (the web-tree-sitter runtime)
 *   - highlights.scm            (semantic-token query; optional at runtime)
 *
 * esbuild only emits server.js, so without this step a packed tarball ships a
 * server that fails its initialize request with ENOENT (see sl-vwpr — the
 * v0.9.0 standalone tarball shipped no WASM at all).
 *
 * Run automatically via `npm run prebuild` so both `build` and `watch` leave
 * dist/ launch-ready. The VS Code extension does NOT consume these copies — it
 * bundles the server itself and copies the same assets in its own esbuild.js.
 */

const { copyFileSync, existsSync, mkdirSync } = require("fs");
const { execFileSync } = require("child_process");
const path = require("path");

const lspRoot = path.join(__dirname, "..");
const repoRoot = path.join(lspRoot, "..", "..");
const treeSitterDir = path.join(lspRoot, "..", "tree-sitter-satsuma");
const distDir = path.join(lspRoot, "dist");

mkdirSync(distDir, { recursive: true });

// Use the release tool's CLI rather than duplicating its tag/SHA rules in this
// CommonJS build script. BUILD_VERSION is inherited automatically in release CI.
execFileSync(
  process.execPath,
  [path.join(repoRoot, "scripts", "release-metadata.mjs"), "generate-build-versions", "lsp"],
  { cwd: repoRoot, stdio: "inherit" },
);

const assets = [
  {
    src: path.join(treeSitterDir, "tree-sitter-satsuma.wasm"),
    dest: path.join(distDir, "tree-sitter-satsuma.wasm"),
    label: "tree-sitter-satsuma.wasm (grammar)",
  },
  {
    // web-tree-sitter 0.26+ renamed its runtime tree-sitter.wasm →
    // web-tree-sitter.wasm; server.ts still resolves the old name, so the
    // copy renames it back. Resolved through Node rather than joined onto this
    // package's own node_modules: under npm workspaces the runtime hoists to
    // the root node_modules (feature 42, R2).
    src: require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    dest: path.join(distDir, "tree-sitter.wasm"),
    label: "web-tree-sitter.wasm (runtime) → tree-sitter.wasm",
  },
  {
    src: path.join(treeSitterDir, "queries", "highlights.scm"),
    dest: path.join(distDir, "highlights.scm"),
    label: "highlights.scm (semantic-token query)",
  },
];

for (const { src, dest, label } of assets) {
  if (!existsSync(src)) {
    throw new Error(
      `copy-assets: required asset not found at ${src}. ` +
        "Run `npm run install:all` from the repo root to build the WASM parser first.",
    );
  }
  copyFileSync(src, dest);
  console.log(`copy-assets: copied ${label} → dist/`);
}

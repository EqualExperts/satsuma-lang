#!/usr/bin/env node
/**
 * copy-assets.js — copy runtime assets into dist/ next to the bundled server.
 *
 * server.ts loads three files from __dirname (i.e. next to dist/server.js) at
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
const path = require("path");

const lspRoot = path.join(__dirname, "..");
const treeSitterDir = path.join(lspRoot, "..", "tree-sitter-satsuma");
const distDir = path.join(lspRoot, "dist");

mkdirSync(distDir, { recursive: true });

const assets = [
  {
    src: path.join(treeSitterDir, "tree-sitter-satsuma.wasm"),
    dest: path.join(distDir, "tree-sitter-satsuma.wasm"),
    label: "tree-sitter-satsuma.wasm (grammar)",
  },
  {
    // web-tree-sitter 0.26+ renamed its runtime tree-sitter.wasm →
    // web-tree-sitter.wasm; server.ts still resolves the old name, so the
    // copy renames it back.
    src: path.join(lspRoot, "node_modules", "web-tree-sitter", "web-tree-sitter.wasm"),
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

#!/usr/bin/env node
/**
 * copy-wasm-assets.mjs — stage both WASM files the harness client loads in the
 * browser into dist/.
 *
 * The harness serves dist/ as a static bundle, so the parser has to be reachable
 * over HTTP next to the client code rather than through Node's module
 * resolution:
 *
 *   - tree-sitter-satsuma.wasm  the Satsuma grammar, built by tree-sitter-satsuma
 *   - tree-sitter.wasm          the web-tree-sitter runtime, renamed from the
 *                               0.26+ filename the client still asks for
 *
 * Run via `npm run build:wasm` as part of the harness build. This replaced a
 * pair of `cp` calls that addressed `node_modules/web-tree-sitter/` inside this
 * package — a path that stopped existing when the tooling packages moved to npm
 * workspaces and the runtime hoisted to the root node_modules (feature 42, R2).
 */

import { createRequire } from "module";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const harnessRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(harnessRoot, "dist");
const require = createRequire(import.meta.url);

const assets = [
  {
    src: join(harnessRoot, "..", "tree-sitter-satsuma", "tree-sitter-satsuma.wasm"),
    dest: join(distDir, "tree-sitter-satsuma.wasm"),
    label: "tree-sitter-satsuma.wasm (grammar)",
    hint: "Run `npm run build:all` from the repo root to build the WASM grammar first.",
  },
  {
    // Resolved through Node, not joined by hand: web-tree-sitter exports the
    // .wasm as a subpath, so this finds it wherever npm hoisted the package.
    src: require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    dest: join(distDir, "tree-sitter.wasm"),
    label: "web-tree-sitter.wasm (runtime) → tree-sitter.wasm",
    hint: "Run `npm install` at the repo root.",
  },
];

mkdirSync(distDir, { recursive: true });

for (const { src, dest, label, hint } of assets) {
  if (!existsSync(src)) {
    throw new Error(`copy-wasm-assets: required asset not found at ${src}. ${hint}`);
  }
  copyFileSync(src, dest);
  console.log(`copy-wasm-assets: copied ${label} → dist/`);
}

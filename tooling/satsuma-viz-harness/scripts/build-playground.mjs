#!/usr/bin/env node
/**
 * build-playground.mjs — assemble the server-free "Try it Live!" bundle.
 *
 * Collects everything the playground needs to run with NO Node process into a
 * single flat directory (dist/playground/): the page, the client bundle, the
 * satsuma-viz component bundle, the two WASM parser artifacts, and the bundled
 * examples manifest that seeds the localStorage document library. The result
 * can be copied verbatim onto any static host (GitHub Pages included).
 *
 * Works under a non-root base path by construction: the page references its
 * assets with page-relative paths (./app.js, ./satsuma-viz.js) and the client
 * resolves the WASM files and examples.json against document.baseURI, so the
 * bundle runs identically at / and at /satsuma-lang/playground/. This script
 * VERIFIES that property — it refuses to emit a bundle whose index.html
 * references any root-absolute (/…) asset, because that is exactly the
 * regression that would break the GitHub Pages deployment.
 *
 * This module exports `buildPlaygroundBundle` (pure-ish, testable: src → dest
 * copy plus validation) and, when run directly, builds dist/playground/ from
 * the regular harness build outputs. Run `npm run build` first (the
 * build:playground npm script chains it).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist");

/**
 * The complete bundle manifest: every file the playground needs at runtime,
 * mapped from its harness-build location. Flat on purpose — index.html and
 * the client resolve all of these as siblings of the page.
 */
const BUNDLE_FILES = [
  join(DIST, "client", "index.html"),
  join(DIST, "client", "app.js"),
  join(DIST, "client", "satsuma-viz.js"),
  join(DIST, "client", "examples.json"),
  join(DIST, "client", "satsuma-logo.png"),
  join(DIST, "client", "lexend-latin.woff2"),
  join(DIST, "tree-sitter-satsuma.wasm"),
  join(DIST, "tree-sitter.wasm"),
];

/**
 * Root-absolute asset reference inside an HTML attribute — src="/…" or
 * href="/…". Any match would resolve to the HOST root instead of the
 * playground directory and break a non-root base path (GitHub Pages serves
 * the site from /satsuma-lang/).
 */
const ROOT_ABSOLUTE_ASSET = /(?:src|href)="\/(?!\/)/;

/**
 * Copy the playground bundle from the harness build outputs into `outDir`,
 * validating that index.html is base-path safe. Throws (emitting nothing
 * misleading) if a required build artifact is missing or index.html contains
 * a root-absolute asset reference.
 *
 * @param {string[]} files Absolute paths of the bundle files to copy.
 * @param {string} outDir Destination directory; recreated from scratch.
 * @returns {string[]} The basenames written into outDir.
 */
export function buildPlaygroundBundle(files, outDir) {
  for (const file of files) {
    if (!existsSync(file)) {
      throw new Error(
        `[playground] missing build artifact: ${file} — run "npm run build" first`,
      );
    }
  }

  const indexHtml = files.find((f) => basename(f) === "index.html");
  if (indexHtml) {
    const html = readFileSync(indexHtml, "utf-8");
    if (ROOT_ABSOLUTE_ASSET.test(html)) {
      throw new Error(
        "[playground] index.html references a root-absolute asset (src/href=\"/…\"); " +
          "all assets must be page-relative (./…) so the bundle works under a " +
          "non-root base path such as GitHub Pages",
      );
    }
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const file of files) {
    const dest = join(outDir, basename(file));
    copyFileSync(file, dest);
    written.push(basename(file));
  }
  return written;
}

/** CLI entry: emit dist/playground/ from the harness build outputs. */
function main() {
  const outDir = join(DIST, "playground");
  const written = buildPlaygroundBundle(BUNDLE_FILES, outDir);
  console.log(`[playground] ${written.length} file(s) → ${outDir}`);
  for (const name of written) console.log(`[playground]   ${name}`);
}

// Run main() only when invoked directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

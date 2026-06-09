#!/usr/bin/env node
/**
 * generate-examples-manifest.mjs — serialise the examples/ corpus into a static
 * JSON asset that seeds the playground's localStorage document library.
 *
 * The playground is server-free (feature 33): on first load the client seeds its
 * localStorage document library from this bundled JSON, so a visitor immediately
 * has the whole built-in example set locally, editable, and surviving reloads.
 * Seeding the *entire* corpus is deliberate — it is what makes cross-file
 * `import` lineage resolve in-browser (PRD decision #7; ~24 files / ~230 KB, well
 * under the localStorage quota).
 *
 * Manifest shape:
 *   { librarySeedVersion: string, examples: [{ name, path, source }] }
 *
 * - `path` is the example's POSIX-relative path under examples/ (e.g.
 *   "sfdc-to-snowflake/pipeline.stm"). It is both the library key and the basis
 *   for the document's virtual URI: the browser derives `new URL(path, base)`
 *   against a `file:///` library base, producing a `file:///…` URI in exactly
 *   the form the import resolver emits (feature 33 §1a) so cross-file imports
 *   between library documents resolve.
 * - `name` is the display label shown in the picker (same relative path, matching
 *   the Node dev server's /api/fixtures `name`).
 * - `librarySeedVersion` is a content hash of the corpus. Re-seeding is gated on
 *   this key: a version bump means a built-in example changed, so the client adds
 *   new/updated built-ins without clobbering documents the user has edited
 *   (sl-kd45 re-seed semantics).
 *
 * This module exports `buildExamplesManifest` (pure, testable) and, when run
 * directly, writes the manifest to dist/client/examples.json for the build.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// scripts/ → satsuma-viz-harness/ → tooling/ → repo root.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const EXAMPLES_DIR = join(REPO_ROOT, "examples");
const OUTPUT_PATH = join(HERE, "..", "dist", "client", "examples.json");

// Length of the hex digest kept for the seed version. 12 hex chars (48 bits) is
// ample to detect any corpus change without bloating the stored key.
const SEED_VERSION_HEX_LENGTH = 12;

/** Recursively collect absolute paths of every .stm file under `dir`, sorted. */
function discoverStmFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".stm")) found.push(full);
    }
  };
  walk(dir);
  found.sort();
  return found;
}

/**
 * Content hash of the example set — stable for identical corpora, different the
 * moment any path or source changes. Computed over the already-sorted entries so
 * it does not depend on filesystem iteration order.
 */
function seedVersionFor(examples) {
  const hash = createHash("sha256");
  for (const e of examples) {
    hash.update(e.path);
    hash.update("\0");
    hash.update(e.source);
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, SEED_VERSION_HEX_LENGTH);
}

/**
 * Build the examples manifest from a corpus directory. Pure: reads files but
 * derives no global state, so it is directly unit-testable.
 *
 * @param {string} examplesDir Absolute path to the examples/ corpus root.
 * @returns {{ librarySeedVersion: string, examples: Array<{name: string, path: string, source: string}> }}
 */
export function buildExamplesManifest(examplesDir) {
  const examples = discoverStmFiles(examplesDir).map((abs) => {
    // Normalise to a POSIX relative path so the key/URI form is identical on
    // Windows and POSIX hosts (the browser only ever sees forward slashes).
    const path = relative(examplesDir, abs).split(sep).join("/");
    return { name: path, path, source: readFileSync(abs, "utf-8") };
  });
  return { librarySeedVersion: seedVersionFor(examples), examples };
}

/** CLI entry: build the manifest from examples/ and write it for the build. */
function main() {
  const manifest = buildExamplesManifest(EXAMPLES_DIR);
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(manifest));
  console.log(
    `[examples-manifest] ${manifest.examples.length} example(s), ` +
      `seed ${manifest.librarySeedVersion} → ${relative(REPO_ROOT, OUTPUT_PATH)}`,
  );
}

// Run main() only when invoked directly, not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

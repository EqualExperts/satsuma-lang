/**
 * Tests for the examples manifest generator (sl-c6r7).
 *
 * The manifest is the seed source for the playground's localStorage document
 * library, so these pin the properties the in-browser loader and the import
 * resolver depend on: the whole corpus is captured, paths are clean POSIX keys
 * that derive valid file:/// URIs, and the seed version is a stable content hash.
 *
 * Inputs are a tiny on-disk fixture corpus written to a temp dir, not the real
 * examples/ tree, so the assertions stay exact and independent of corpus churn.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildExamplesManifest } from "./generate-examples-manifest.mjs";

// The file:/// base the browser library mounts documents under. Kept in step
// with the resolver's URI form (feature 33 §1a).
const LIBRARY_BASE = "file:///library/";

let corpusDir;

before(() => {
  // A minimal two-file corpus, one in a subdirectory, mirroring the real layout
  // (examples/<group>/<file>.stm) so the relative-path keys are exercised.
  corpusDir = mkdtempSync(join(tmpdir(), "satsuma-examples-"));
  mkdirSync(join(corpusDir, "group"), { recursive: true });
  writeFileSync(join(corpusDir, "root.stm"), "schema a { id INT }\n");
  writeFileSync(join(corpusDir, "group", "pipeline.stm"), "schema b { id INT }\n");
  // A non-.stm file must be ignored by the generator.
  writeFileSync(join(corpusDir, "README.md"), "not satsuma\n");
});

after(() => {
  rmSync(corpusDir, { recursive: true, force: true });
});

describe("buildExamplesManifest", () => {
  // Only .stm files are captured, and each carries its source verbatim — this is
  // the whole-corpus seeding the playground relies on.
  it("captures every .stm file with its source and ignores other files", () => {
    const { examples } = buildExamplesManifest(corpusDir);
    const byPath = Object.fromEntries(examples.map((e) => [e.path, e]));
    assert.deepEqual(Object.keys(byPath).sort(), ["group/pipeline.stm", "root.stm"]);
    assert.equal(byPath["root.stm"].source, "schema a { id INT }\n");
    assert.equal(byPath["group/pipeline.stm"].source, "schema b { id INT }\n");
  });

  // Paths must be POSIX-relative (forward slashes, no leading slash) so they are
  // valid library keys on any host, and so the URI derivation below is correct.
  it("emits POSIX-relative paths usable as library keys", () => {
    const { examples } = buildExamplesManifest(corpusDir);
    for (const e of examples) {
      assert.ok(!e.path.includes("\\"), `path must not contain backslashes: ${e.path}`);
      assert.ok(!e.path.startsWith("/"), `path must be relative: ${e.path}`);
    }
  });

  // The headline cross-runtime contract: resolving a manifest path against the
  // file:/// library base yields a file:/// URI in exactly the form the import
  // resolver produces, so indexedFiles.has(resolved) matches in the browser.
  it("derives file:/// virtual URIs consistent with the resolver", () => {
    const { examples } = buildExamplesManifest(corpusDir);
    const uri = new URL(
      examples.find((e) => e.path === "group/pipeline.stm").path,
      LIBRARY_BASE,
    ).href;
    assert.equal(uri, "file:///library/group/pipeline.stm");
  });

  // The seed version must be deterministic for an unchanged corpus (so returning
  // visitors are not re-seeded needlessly) and must change when any source
  // changes (so a built-in update is picked up). Gating re-seed on this is what
  // protects a user's edits.
  it("produces a stable content-hash seed version that changes with content", () => {
    const first = buildExamplesManifest(corpusDir).librarySeedVersion;
    const again = buildExamplesManifest(corpusDir).librarySeedVersion;
    assert.equal(first, again, "identical corpus must yield identical seed version");

    writeFileSync(join(corpusDir, "root.stm"), "schema a { id INT, name STRING }\n");
    const changed = buildExamplesManifest(corpusDir).librarySeedVersion;
    assert.notEqual(changed, first, "a source change must bump the seed version");
  });
});

/**
 * build-playground.test.mjs — unit tests for the static playground bundler.
 *
 * Validates the three properties the "Try it Live!" build must hold (sl-ncu9):
 * the bundle is complete (every runtime file present, flat, next to the page),
 * an incomplete build is an error rather than a silently broken bundle, and a
 * base-path-unsafe index.html (root-absolute asset refs) is rejected because it
 * would 404 under GitHub Pages' /satsuma-lang/ prefix.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildPlaygroundBundle } from "./build-playground.mjs";

/** A minimal page whose every asset reference is page-relative. */
const SAFE_INDEX_HTML = [
  "<!DOCTYPE html><html><head>",
  '<script type="module" src="./satsuma-viz.js"></script>',
  '<script type="module" src="./app.js"></script>',
  "</head><body></body></html>",
].join("\n");

describe("buildPlaygroundBundle", () => {
  let srcDir;
  let outDir;

  beforeEach(() => {
    srcDir = mkdtempSync(join(tmpdir(), "playground-src-"));
    outDir = join(mkdtempSync(join(tmpdir(), "playground-out-")), "playground");
  });

  afterEach(() => {
    rmSync(srcDir, { recursive: true, force: true });
    rmSync(join(outDir, ".."), { recursive: true, force: true });
  });

  /** Write a fake build artifact and return its absolute path. */
  function artifact(name, content = `content of ${name}`) {
    const path = join(srcDir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
    return path;
  }

  it("copies every bundle file flat into the output directory", () => {
    // The bundle contract: all runtime files land as SIBLINGS of index.html,
    // because the page and client resolve assets page-relative.
    const files = [
      artifact("index.html", SAFE_INDEX_HTML),
      artifact("app.js"),
      artifact("examples.json", "{}"),
      artifact("tree-sitter.wasm"),
    ];

    const written = buildPlaygroundBundle(files, outDir);

    assert.deepEqual(written.sort(), ["app.js", "examples.json", "index.html", "tree-sitter.wasm"]);
    assert.deepEqual(readdirSync(outDir).sort(), written.sort());
    assert.equal(readFileSync(join(outDir, "index.html"), "utf-8"), SAFE_INDEX_HTML);
  });

  it("rebuilds the output directory from scratch (no stale files survive)", () => {
    // A leftover file from a previous build (e.g. a renamed bundle) must not
    // linger in the published bundle, where it would mask a broken reference.
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "stale.js"), "old");

    buildPlaygroundBundle([artifact("index.html", SAFE_INDEX_HTML)], outDir);

    assert.deepEqual(readdirSync(outDir), ["index.html"]);
  });

  it("throws when a required build artifact is missing", () => {
    // Emitting a partial bundle would deploy a playground that 404s at
    // runtime; failing the build is the only honest outcome.
    const missing = join(srcDir, "app.js"); // never written
    assert.throws(
      () => buildPlaygroundBundle([artifact("index.html", SAFE_INDEX_HTML), missing], outDir),
      /missing build artifact/,
    );
  });

  it("rejects an index.html that references a root-absolute asset", () => {
    // src="/app.js" resolves to the HOST root, not the playground directory —
    // broken the moment the bundle is served under /satsuma-lang/. The build
    // must refuse to emit such a page.
    const badHtml = SAFE_INDEX_HTML.replace('src="./app.js"', 'src="/app.js"');
    assert.throws(
      () => buildPlaygroundBundle([artifact("index.html", badHtml)], outDir),
      /root-absolute asset/,
    );
  });

  it("accepts protocol-relative and external URLs (only /… roots are unsafe)", () => {
    // The guard must be precise: https://… and //cdn.example/… references are
    // not base-path hazards and must not fail the build.
    const html = SAFE_INDEX_HTML.replace(
      '<script type="module" src="./app.js"></script>',
      '<script type="module" src="./app.js"></script><link href="https://example.test/x.css" />',
    );
    const written = buildPlaygroundBundle([artifact("index.html", html)], outDir);
    assert.deepEqual(written, ["index.html"]);
  });
});

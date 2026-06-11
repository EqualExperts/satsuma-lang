/**
 * source-files.test.js — Unit tests for src/source-files.ts
 *
 * Pins the extension policy fixed by sl-v215: `.satsuma` is a first-class
 * source extension alongside `.stm`, and every consumer recognises files via
 * this shared predicate rather than inline `.endsWith(".stm")` checks.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SATSUMA_FILE_EXTENSIONS,
  SATSUMA_FILE_GLOB,
  isSatsumaFilePath,
} from "@satsuma/core";

describe("isSatsumaFilePath", () => {
  it("recognises both registered extensions, on paths and on URIs (sl-v215)", () => {
    // Consumers pass both fs paths (LSP workspace scan) and URI strings
    // (LSP watched-file events) — the predicate must accept either form.
    assert.equal(isSatsumaFilePath("/ws/pipeline.stm"), true);
    assert.equal(isSatsumaFilePath("/ws/pipeline.satsuma"), true);
    assert.equal(isSatsumaFilePath("file:///ws/pipeline.stm"), true);
    assert.equal(isSatsumaFilePath("file:///ws/pipeline.satsuma"), true);
  });

  it("rejects unrelated extensions, including ones containing 'stm'", () => {
    // ".stm" must match as a suffix segment, not a substring — a .stmx or
    // .json file must never be indexed as Satsuma source.
    assert.equal(isSatsumaFilePath("/ws/pipeline.stmx"), false);
    assert.equal(isSatsumaFilePath("/ws/notes.md"), false);
    assert.equal(isSatsumaFilePath("/ws/pipeline.stm.bak"), false);
  });

  it("matches every extension listed in SATSUMA_FILE_EXTENSIONS", () => {
    // The predicate and the constant must never drift apart: a new extension
    // added to the list is automatically recognised by the predicate.
    for (const ext of SATSUMA_FILE_EXTENSIONS) {
      assert.equal(isSatsumaFilePath(`/ws/file${ext}`), true);
    }
  });
});

describe("SATSUMA_FILE_GLOB", () => {
  it("covers exactly the registered extensions", () => {
    // Watchers built from the glob and indexers built from the predicate must
    // agree on the file set, or watched .satsuma edits would be dropped again.
    const globExts = /\{(.+)\}/.exec(SATSUMA_FILE_GLOB)?.[1].split(",") ?? [];
    assert.deepEqual(
      globExts.map((e) => `.${e}`).sort(),
      [...SATSUMA_FILE_EXTENSIONS].sort(),
    );
  });
});

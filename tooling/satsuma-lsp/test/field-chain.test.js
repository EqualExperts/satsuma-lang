/**
 * field-chain.test.js — Unit tests for satsuma/fieldChain.
 *
 * The handler delegates straight to @satsuma/viz-backend's
 * buildFieldChainFromWorkspace, exercised here with the LSP's own shape of
 * `WorkspaceIndex` and an open-editor/disk-fallback tree loader — the same
 * split viz-full-lineage.test.js pins for the merged VizModel. sl-iwlv added
 * this LSP-side wiring so the chain view can reuse the server's existing
 * workspace index instead of the browser's in-memory adapter.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  buildFieldChainFromWorkspace,
  createWorkspaceIndex,
  indexFile,
} = require("@satsuma/viz-backend");

before(async () => {
  await initTestParser();
});

/**
 * Build a field chain over an in-memory multi-file workspace, using a loader
 * that only serves trees for files explicitly marked "open" — the rest fall
 * through to a disk-fallback stand-in, mirroring the server's real
 * `trees.get(uri) ?? parseTreeFromDisk(uri)` composition.
 */
function chainOver(files, openUris, entryUri, focusField, options) {
  const index = createWorkspaceIndex();
  const allTrees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    allTrees[uri] = tree;
    indexFile(index, uri, tree);
  }
  const requested = [];
  const loadTree = (uri) => {
    requested.push(uri);
    return allTrees[uri] ?? null;
  };
  const openTrees = new Map(openUris.map((uri) => [uri, allTrees[uri]]));
  const model = buildFieldChainFromWorkspace(
    entryUri,
    index,
    (uri) => openTrees.get(uri) ?? loadTree(uri),
    focusField,
    options,
  );
  return { model, requested };
}

describe("satsuma/fieldChain — import graph traversal", () => {
  const FILES = {
    "file:///defs.stm": "schema a { id string }\nschema c { id string }",
    "file:///entry.stm":
      'import { a, c } from "defs.stm"\n' +
      "schema b { id string }\n" +
      "mapping ab { source { a } target { b } id -> id }\n" +
      "mapping bc { source { b } target { c } id -> id }\n",
  };

  it("traces a chain whose hops span files the requester never opened", () => {
    // Neither defs.stm's schemas nor the mappings referencing them are "open" —
    // the fallback loader alone must supply them, mirroring sl-mg63's fix for
    // full-lineage: a chain must not silently stop at open-tab boundaries.
    const { model, requested } = chainOver(
      FILES,
      ["file:///entry.stm"],
      "file:///entry.stm",
      "b.id",
    );

    assert.deepEqual(model.upstream, [
      { field: "::a.id", via_mapping: "::ab", classification: "none", depth: 1 },
    ]);
    assert.deepEqual(model.downstream, [
      { field: "::c.id", via_mapping: "::bc", classification: "none", depth: 1 },
    ]);
    assert.ok(
      requested.includes("file:///defs.stm"),
      "the unopened imported file must still be requested from the fallback loader",
    );
  });

  it("returns an empty chain when the entry file itself cannot be loaded", () => {
    // Mirrors computeFullLineage's null-primary contract, adapted to
    // FieldChainModel's shape: no upstream/downstream rather than no model,
    // since a chain always names the focus field even when it finds nothing.
    const index = createWorkspaceIndex();
    const model = buildFieldChainFromWorkspace("file:///missing.stm", index, () => null, "b.id");
    assert.deepEqual(model, { field: "::b.id", maxDepth: 10, upstream: [], downstream: [] });
  });

  it("forwards depth and direction options to the traversal", () => {
    const { model } = chainOver(FILES, [], "file:///entry.stm", "c.id", {
      depth: 1,
      direction: "upstream",
    });
    assert.deepEqual(model.upstream, [
      { field: "::b.id", via_mapping: "::bc", classification: "none", depth: 1 },
    ]);
    assert.deepEqual(model.downstream, []);
    assert.equal(model.maxDepth, 1);
  });
});

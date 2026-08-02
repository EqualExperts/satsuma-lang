/**
 * viz-model.test.js — Unit tests for the satsuma/vizModel custom LSP request.
 *
 * The handler in server.ts is a thin wrapper around buildVizModel(uri, tree,
 * scopedIndex). These tests exercise that same call path against a multi-file
 * workspace index so that any change to the contract (returned shape, scoping,
 * deduplication) fails here, not silently in the viz client.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  createWorkspaceIndex,
  indexFile,
  createScopedIndex,
  getImportReachableUris,
  buildVizModel,
} = require("@satsuma/viz-backend");

before(async () => {
  await initTestParser();
});

/** Build a workspace from `{uri: source}` and return {index, trees}. */
function workspace(files) {
  const index = createWorkspaceIndex();
  const trees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    trees[uri] = tree;
    indexFile(index, uri, tree);
  }
  return { index, trees };
}

/** Mirror the satsuma/vizModel handler: build a viz model scoped to import-reachable files. */
function vizModel(files, primaryUri) {
  const { index, trees } = workspace(files);
  const scoped = createScopedIndex(index, getImportReachableUris(primaryUri, index));
  return buildVizModel(primaryUri, trees[primaryUri], scoped);
}

describe("satsuma/vizModel — single file", () => {
  it("returns a model whose uri matches the requested document", () => {
    const model = vizModel({ "file:///a.stm": "schema customers { id UUID }" }, "file:///a.stm");
    assert.equal(model.uri, "file:///a.stm");
  });

  it("groups schemas under the global namespace when no namespace block exists", () => {
    const model = vizModel(
      { "file:///a.stm": "schema customers { id UUID }\nschema orders { id UUID }" },
      "file:///a.stm",
    );
    const global = model.namespaces.find((n) => n.name === null);
    assert.ok(global, "expected a global (null-named) namespace group");
    const ids = global.schemas.map((s) => s.id).sort();
    assert.deepEqual(ids, ["customers", "orders"]);
  });
});

describe("satsuma/vizModel — multi-file workspace scoping", () => {
  // The vizModel for a file should *only* reflect that file's local entities;
  // unrelated workspace files must not leak into the model regardless of how
  // many other files exist in the index.
  it("excludes schemas from unrelated workspace files", () => {
    const model = vizModel(
      {
        "file:///a.stm": "schema customers { id UUID }",
        "file:///b.stm": "schema unrelated { id UUID }",
      },
      "file:///a.stm",
    );
    const allIds = model.namespaces.flatMap((g) => g.schemas.map((s) => s.id));
    assert.ok(allIds.includes("customers"));
    assert.ok(!allIds.includes("unrelated"), "scoped vizModel must not include unrelated schemas");
  });
});

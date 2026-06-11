/**
 * viz-full-lineage.test.js — Unit tests for satsuma/vizFullLineage.
 *
 * Exercises the real computeFullLineage module the server handler delegates
 * to. The handler walks the import graph from the requested file, asks the
 * caller-provided loader for each file's tree, and merges per-file VizModels
 * into one. Tree acquisition is a callback precisely so files that are NOT
 * open in any editor can be parsed from disk (sl-mg63) — these tests pin
 * both the merge contract and that loader contract.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeFullLineage } = require("../dist/full-lineage");
const {
  createWorkspaceIndex,
  indexFile,
} = require("@satsuma/viz-backend");

before(async () => { await initTestParser(); });

/**
 * Run computeFullLineage over an in-memory workspace. Every file's tree is
 * served through the loader callback — exactly how the server supplies
 * open-editor trees with a disk-parse fallback. Returns the merged model
 * plus the URIs the loader was asked for.
 */
function fullLineage(files, primaryUri) {
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
  const model = computeFullLineage(primaryUri, index, loadTree);
  return { model, requested };
}

describe("satsuma/vizFullLineage — import graph traversal", () => {
  // Two-file workspace: the entry file imports a schema from a defining file.
  // The merged model must contain the upstream schema, otherwise the viz would
  // be unable to render cross-file lineage.
  const FILES = {
    "file:///defs.stm": "schema customers { id UUID name VARCHAR }",
    "file:///entry.stm": 'import { customers } from "defs.stm"\nschema orders { customer_id UUID }',
  };

  it("anchors the merged model to the primary uri", () => {
    const { model } = fullLineage(FILES, "file:///entry.stm");
    assert.equal(model.uri, "file:///entry.stm");
  });

  it("includes schemas from import-reachable files", () => {
    const { model } = fullLineage(FILES, "file:///entry.stm");
    const ids = model.namespaces.flatMap((g) => g.schemas.map((s) => s.id));
    assert.ok(ids.includes("customers"), "imported schema 'customers' should appear in merged model");
    assert.ok(ids.includes("orders"), "local schema 'orders' should still appear");
  });

  // sl-mg63: the old handler resolved each reachable URI only through the
  // open-editor trees map, so "full transitive lineage" silently contained
  // just the files the user happened to have open. The loader callback must
  // be asked for EVERY reachable file — the server backs it with a disk
  // parse for files no editor has open.
  it("requests every import-reachable file from the loader, not only open ones (sl-mg63)", () => {
    const { model, requested } = fullLineage(FILES, "file:///entry.stm");
    assert.ok(
      requested.includes("file:///defs.stm"),
      "the imported (potentially closed) file must be requested from the loader",
    );
    const ids = model.namespaces.flatMap((g) => g.schemas.map((s) => s.id));
    assert.ok(ids.includes("customers"), "closed imported file's schema must appear in lineage");
  });

  it("returns null when the primary file cannot be loaded", () => {
    // Mirrors the old contract: no tree for the requested file → no model.
    const index = createWorkspaceIndex();
    const model = computeFullLineage("file:///missing.stm", index, () => null);
    assert.equal(model, null);
  });

  it("skips unreadable imported files but still returns the rest", () => {
    // A deleted or unreadable import must not take down the whole lineage.
    const index = createWorkspaceIndex();
    const entrySrc = 'import { customers } from "gone.stm"\nschema orders { id UUID }';
    const entryTree = parse(entrySrc);
    indexFile(index, "file:///entry.stm", entryTree);
    const model = computeFullLineage("file:///entry.stm", index, (uri) =>
      uri === "file:///entry.stm" ? entryTree : null,
    );
    assert.ok(model, "model should still be produced");
    const ids = model.namespaces.flatMap((g) => g.schemas.map((s) => s.id));
    assert.ok(ids.includes("orders"));
  });
});

describe("satsuma/vizFullLineage — stub deduplication", () => {
  // When the entry file imports a schema that is also locally referenced as a
  // bare name, the merged model must not contain two copies of `customers` —
  // the upstream definition supersedes any stub.
  it("deduplicates schemas by qualified id across files", () => {
    const { model } = fullLineage(
      {
        "file:///defs.stm": "schema customers { id UUID email VARCHAR }",
        "file:///entry.stm":
          'import { customers } from "defs.stm"\n' +
          "mapping `m` {\n  source { customers }\n  target { customers }\n  id -> id\n}",
      },
      "file:///entry.stm",
    );
    const customerCards = model.namespaces
      .flatMap((g) => g.schemas)
      .filter((s) => s.id === "customers");
    assert.equal(customerCards.length, 1, "customers should appear exactly once after merge");
    // The surviving card must be the full definition (has fields), not a stub.
    assert.ok(customerCards[0].fields.length >= 1, "merged card should retain real fields");
  });
});

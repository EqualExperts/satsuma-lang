/**
 * Tests for buildModelFromSources — the runtime-agnostic parse→index→model
 * pipeline that drives both the Node harness server and the in-browser
 * playground (feature 33 §1b).
 *
 * These pin the two properties the browser client depends on: a model can be
 * built from a string buffer with no filesystem, and cross-file `import`s
 * between in-memory documents resolve into merged lineage. The invariant is
 * tested here, at the core level, rather than in the harness client (per the
 * Core-vs-Consumer rule).
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser } = require("./helper");
const { buildModelFromSources } = require("../dist/model-from-sources");

before(async () => {
  await initTestParser();
});

/** Collect every schema id present across all namespaces of a model. */
function schemaIds(model) {
  return model.namespaces.flatMap((ns) => ns.schemas.map((s) => s.id)).sort();
}

/** Collect every mapping id present across all namespaces of a model. */
function mappingIds(model) {
  return model.namespaces.flatMap((ns) => ns.mappings.map((m) => m.id)).sort();
}

describe("buildModelFromSources — single in-memory buffer", () => {
  // The headline browser case: a model is built from one string buffer with no
  // file access. Proves the entry document's schemas and mappings reach the model.
  it("builds a single-file model from a string buffer with no filesystem", () => {
    const uri = "file:///buffer.stm";
    const source = [
      "schema users { id INT }",
      "schema customers { id INT }",
      "mapping m { source { users } target { customers } id -> id }",
    ].join("\n");

    const model = buildModelFromSources(uri, [{ uri, source }]);

    assert.equal(model.uri, uri);
    assert.deepEqual(schemaIds(model), ["customers", "users"]);
    assert.deepEqual(mappingIds(model), ["m"]);
  });

  // A mid-edit buffer that the parser cannot turn into any blocks must yield an
  // empty (not crashing) model, so the live editor can keep its last good viz.
  it("returns an empty model for a buffer with no extractable blocks", () => {
    const uri = "file:///empty.stm";
    const model = buildModelFromSources(uri, [{ uri, source: "   \n\n" }]);
    assert.deepEqual(model.namespaces, []);
    assert.deepEqual(model.fileNotes, []);
  });

  // When the requested entry URI is not among the supplied documents, the
  // pipeline degrades to an empty model rather than throwing.
  it("returns an empty model when the entry URI is absent from the documents", () => {
    const model = buildModelFromSources("file:///missing.stm", [
      { uri: "file:///other.stm", source: "schema s { id INT }" },
    ]);
    assert.equal(model.uri, "file:///missing.stm");
    assert.deepEqual(model.namespaces, []);
  });
});

describe("buildModelFromSources — cross-file lineage from in-memory documents", () => {
  const base = "file:///library/";
  const entryUri = `${base}pipeline.stm`;
  const importeeUri = `${base}customers.stm`;
  const documents = [
    {
      uri: entryUri,
      source: [
        'import { customers } from "./customers.stm"',
        "mapping m { source { customers } target { users } id -> id }",
        "schema users { id INT }",
      ].join("\n"),
    },
    { uri: importeeUri, source: "schema customers { id INT }" },
  ];

  // Lineage mode must pull the imported document's schema into the merged model,
  // proving import resolution + merge works entirely in memory (the browser
  // playground's cross-file lineage rests on this).
  it("merges an imported document's schema into the lineage model", () => {
    const model = buildModelFromSources(entryUri, documents, { lineage: true });
    assert.ok(
      schemaIds(model).includes("customers"),
      "imported schema is present in the merged lineage model",
    );
    assert.ok(schemaIds(model).includes("users"), "local schema is present");
  });

  // Single-file mode (the default) must NOT pull the imported file's full
  // definition in as a first-class schema — the imported `customers` appears
  // only as a stub for edge rendering, and the importee's own `users`-style
  // local content stays out. This contrasts with lineage mode above.
  it("does not merge imported documents in single-file mode", () => {
    const single = buildModelFromSources(entryUri, documents, { lineage: false });
    const lineage = buildModelFromSources(entryUri, documents, { lineage: true });
    // The lineage model is assembled from more than one document; the single
    // model is rooted only at the entry. The entry's own location is the entry.
    assert.equal(single.uri, entryUri);
    assert.equal(lineage.uri, entryUri);
    // The merged model carries the importee's location for its contributed
    // schema, which the single-file model does not.
    const lineageUris = new Set(
      lineage.namespaces.flatMap((ns) =>
        ns.schemas.map((s) => s.location?.uri).filter(Boolean),
      ),
    );
    assert.ok(
      lineageUris.has(importeeUri),
      "lineage model includes a schema sourced from the imported document",
    );
  });
});

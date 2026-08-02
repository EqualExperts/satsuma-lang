/**
 * viz-linked-files.test.js — Unit tests for satsuma/vizLinkedFiles.
 *
 * The handler returns the set of *other* file URIs (excluding the current one)
 * that define or reference a given schema id. The viz client uses this list to
 * populate "linked files" expansion in the lineage panel.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  createWorkspaceIndex,
  indexFile,
  findReferences,
  resolveDefinition,
} = require("@satsuma/viz-backend");

before(async () => {
  await initTestParser();
});

/** Mirror the satsuma/vizLinkedFiles handler logic. */
function linkedFiles(files, schemaId, currentUri) {
  const index = createWorkspaceIndex();
  for (const [uri, source] of Object.entries(files)) {
    indexFile(index, uri, parse(source));
  }
  const refs = findReferences(index, schemaId);
  const defs = resolveDefinition(index, schemaId, null);
  const uris = new Set();
  for (const r of refs) if (r.uri !== currentUri) uris.add(r.uri);
  for (const d of defs) if (d.uri !== currentUri) uris.add(d.uri);
  return [...uris];
}

describe("satsuma/vizLinkedFiles", () => {
  // The schema is defined in defs.stm and referenced from a mapping in
  // entry.stm. Asking for linked files *from defs.stm* should surface entry.stm
  // (the file that uses it) without echoing defs.stm itself.
  it("returns referencing files when called from the defining file", () => {
    const result = linkedFiles(
      {
        "file:///defs.stm": "schema customers { id UUID }",
        "file:///entry.stm":
          'import { customers } from "defs.stm"\n' +
          "mapping `m` {\n  source { customers }\n  target { customers }\n  id -> id\n}",
      },
      "customers",
      "file:///defs.stm",
    );
    assert.ok(result.includes("file:///entry.stm"));
    assert.ok(!result.includes("file:///defs.stm"), "current file must be excluded");
  });

  // Symmetric case: from a referencing file, the defining file should appear.
  it("returns the defining file when called from a referencing file", () => {
    const result = linkedFiles(
      {
        "file:///defs.stm": "schema customers { id UUID }",
        "file:///entry.stm":
          'import { customers } from "defs.stm"\n' +
          "mapping `m` {\n  source { customers }\n  target { customers }\n  id -> id\n}",
      },
      "customers",
      "file:///entry.stm",
    );
    assert.ok(result.includes("file:///defs.stm"));
    assert.ok(!result.includes("file:///entry.stm"));
  });

  it("returns an empty array for an unknown schema name", () => {
    const result = linkedFiles(
      { "file:///a.stm": "schema customers { id UUID }" },
      "nonexistent",
      "file:///a.stm",
    );
    assert.deepEqual(result, []);
  });
});

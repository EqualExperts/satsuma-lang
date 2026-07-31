/**
 * coverage.test.js — LSP coverage adapter wiring.
 *
 * Coverage semantics are tested once, in satsuma-core/test/coverage.test.js
 * (sl-gsxu). What can only break here is the adapter: resolving a schema
 * reference through the LSP WorkspaceIndex, projecting FieldInfo onto core's
 * field shape, and mapping FieldInfo.range onto the line the gutter decorates.
 * These tests cover exactly that seam and nothing else.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");
const { computeMappingCoverage } = require("../dist/coverage");

before(async () => { await initTestParser(); });

/** Run computeMappingCoverage on a single-file source text. */
function coverage(source, mappingName, uri = "file:///test.stm") {
  const tree = parse(source);
  const idx = createWorkspaceIndex();
  indexFile(idx, uri, tree);
  return computeMappingCoverage(uri, tree, mappingName, idx);
}

const SRC = `schema src {
  id INT
  unused INT
}
schema tgt {
  id INT
  memo STRING
}
mapping load {
  source { src }
  target { tgt }
  id -> id
}`;

describe("LSP coverage adapter", () => {
  it("resolves both mapping sides through the workspace index", () => {
    // The adapter's job is index lookup; if resolveDefinition is wired wrongly
    // the gutter silently decorates nothing, with no error to trace.
    const result = coverage(SRC, "load");
    assert.deepEqual(
      result.schemas.map((s) => [s.role, s.schemaId]),
      [["source", "src"], ["target", "tgt"]],
    );
  });

  it("reports each field's declaration line and URI for gutter decoration", () => {
    // The overlay places markers at FieldCoverageEntry.line in the file named
    // by .uri, so this projection from FieldInfo.range is load-bearing.
    const tgt = coverage(SRC, "load").schemas.find((s) => s.role === "target");
    assert.deepEqual(
      tgt.fields.map((f) => [f.path, f.line, f.uri, f.mapped]),
      [
        ["id", 5, "file:///test.stm", true],
        ["memo", 6, "file:///test.stm", false],
      ],
    );
  });

  it("projects nested FieldInfo children onto nested coverage paths", () => {
    // FieldInfo nests differently from the CLI's FieldDecl; a dropped
    // children[] mapping would hide every nested field from the gutter.
    const src = `schema src {
  address record {
    line1 STRING
    line2 STRING
  }
}
schema tgt { addr STRING }
mapping load {
  source { src }
  target { tgt }
  address.line1 -> addr
}`;
    const source = coverage(src, "load").schemas.find((s) => s.role === "source");
    assert.deepEqual(
      source.fields.map((f) => [f.path, f.mapped]),
      [["address", true], ["address.line1", true], ["address.line2", false]],
    );
  });
});

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { prepareRename, computeRename } = require("../dist/rename");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");

before(async () => { await initTestParser(); });

function buildIndex(files) {
  const idx = createWorkspaceIndex();
  const trees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    trees[uri] = tree;
    indexFile(idx, uri, tree);
  }
  return { index: idx, trees };
}

describe("prepareRename", () => {
  it("returns range for schema block label", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID\n}",
    });
    const result = prepareRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
    );
    assert.ok(result);
    assert.equal(result.placeholder, "customers");
  });

  it("returns range for source ref", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm":
        "mapping `test` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
    });
    const result = prepareRename(
      trees["file:///a.stm"],
      1,
      12,
      "file:///a.stm",
      index,
    );
    assert.ok(result);
    assert.equal(result.placeholder, "customers");
  });

  it("returns null for non-renameable positions", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID\n}",
    });
    // Cursor on "schema" keyword (not a renameable node)
    const result = prepareRename(
      trees["file:///a.stm"],
      0,
      2,
      "file:///a.stm",
      index,
    );
    assert.equal(result, null);
  });
});

/**
 * Apply a WorkspaceEdit's TextEdits for one file to its source text.
 * Edits are applied bottom-up so earlier edits do not shift later ranges.
 * Supports single-line ranges only — sufficient for these tests.
 */
function applyEdits(source, edits) {
  const lines = source.split("\n");
  const sorted = [...edits].sort(
    (a, b) =>
      b.range.start.line - a.range.start.line ||
      b.range.start.character - a.range.start.character,
  );
  for (const e of sorted) {
    assert.equal(e.range.start.line, e.range.end.line, "expected single-line edit");
    const line = lines[e.range.start.line];
    lines[e.range.start.line] =
      line.slice(0, e.range.start.character) +
      e.newText +
      line.slice(e.range.end.character);
  }
  return lines.join("\n");
}

describe("computeRename", () => {
  it("renames schema definition and all references", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID\n}",
      "file:///b.stm":
        "mapping `test` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
    });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
      "clients",
    );
    assert.ok(edit);
    assert.ok(edit.changes);
    // Should have edits in both files
    assert.ok(edit.changes["file:///a.stm"]);
    assert.ok(edit.changes["file:///b.stm"]);
    // Definition edit
    assert.ok(
      edit.changes["file:///a.stm"].some(
        (e) => e.newText === "clients",
      ),
    );
    // Reference edit
    assert.ok(
      edit.changes["file:///b.stm"].some(
        (e) => e.newText === "clients",
      ),
    );
  });

  it("renames fragment and all spread sites", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm": `fragment audit_fields {
  ts TIMESTAMP
}
schema customers {
  id UUID
  ...audit_fields
}`,
    });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      10,
      "file:///a.stm",
      index,
      "tracking_fields",
    );
    assert.ok(edit);
    const edits = edit.changes["file:///a.stm"];
    assert.ok(edits);
    // Should rename both the definition and the spread
    assert.ok(edits.length >= 2);
    assert.ok(edits.every((e) => e.newText === "tracking_fields"));
  });

  it("refuses rename to existing name", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm":
        "schema customers {\n  id UUID\n}\nschema orders {\n  id UUID\n}",
    });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
      "orders", // already exists
    );
    assert.equal(edit, null);
  });

  it("returns null for same name", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID\n}",
    });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
      "customers",
    );
    assert.equal(edit, null);
  });

  it("rewrites @refs in NL strings without deleting the @ sigil", () => {
    // sl-xf3f: the NL ref index stored the range of the whole "@name" match,
    // so rename replaced the sigil too, turning "@customers" into "clients"
    // and breaking the ref. The round trip must keep the @.
    const bSource =
      'mapping `m` {\n  source { customers }\n  target { dim }\n  -> name { "from @customers" }\n}';
    const { index, trees } = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID\n}",
      "file:///b.stm": bSource,
    });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
      "clients",
    );
    assert.ok(edit);
    const renamed = applyEdits(bSource, edit.changes["file:///b.stm"]);
    assert.ok(
      renamed.includes('"from @clients"'),
      `expected NL ref to keep its @ sigil, got: ${renamed}`,
    );
  });

  it("rewrites @refs inside note tags and note blocks", () => {
    // sl-ellp: NL refs in note metadata and note blocks were never indexed, so
    // renaming a schema left its name stale in prose documentation. Both note
    // shapes must be rewritten alongside structural references.
    const bSource =
      'schema dim (note "fed by @customers") {\n  id UUID\n  note { "joins against @customers" }\n}';
    const { index, trees } = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID\n}",
      "file:///b.stm": bSource,
    });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
      "clients",
    );
    assert.ok(edit);
    const renamed = applyEdits(bSource, edit.changes["file:///b.stm"]);
    assert.ok(
      renamed.includes('"fed by @clients"'),
      `expected note tag ref to be renamed, got: ${renamed}`,
    );
    assert.ok(
      renamed.includes('"joins against @clients"'),
      `expected note block ref to be renamed, got: ${renamed}`,
    );
  });

  it("preserves the dotted tail of an arrow path whose first segment matches the renamed name", () => {
    // sl-xf3f: arrow paths were indexed under their first segment but with the
    // range of the WHOLE path node, so renaming a schema named "address"
    // rewrote "address.street -> s" to "location -> s", silently destroying
    // ".street". (That the field segment is matched at all is kind-blind
    // overreach tracked separately in sl-p256 — this test pins that whatever
    // is rewritten, the rest of the path survives.)
    const source =
      "schema address {\n  street VARCHAR\n}\nmapping `m` {\n  source { src }\n  target { dim }\n  address.street -> s\n}";
    const { index, trees } = buildIndex({ "file:///a.stm": source });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
      "location",
    );
    assert.ok(edit);
    const renamed = applyEdits(source, edit.changes["file:///a.stm"]);
    assert.ok(
      renamed.includes("location.street -> s"),
      `expected the .street tail to survive the rename, got: ${renamed}`,
    );
  });

  it("renames from a reference site", () => {
    const { index, trees } = buildIndex({
      "file:///a.stm": "schema customers {\n  id UUID\n}",
      "file:///b.stm":
        "mapping `test` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
    });
    const edit = computeRename(
      trees["file:///b.stm"],
      1,
      12,
      "file:///b.stm",
      index,
      "clients",
    );
    assert.ok(edit);
    // Should still rename in both files
    assert.ok(edit.changes["file:///a.stm"]);
    assert.ok(edit.changes["file:///b.stm"]);
  });
});

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

  it("placeholder matches exactly the text the edit range covers for a namespaced block (sl-kilo)", () => {
    // For a block inside a namespace the context name is qualified ("a::foo")
    // but the rename range covers only the bare label. A qualified placeholder
    // makes the client prefill "a::foo"; accepting it writes the qualified
    // name INTO the label, producing namespace a { schema a::foo2 }.
    const source = "namespace a {\n  schema foo {\n    id UUID\n  }\n}";
    const { index, trees } = buildIndex({ "file:///a.stm": source });
    // Cursor on "foo" (line 1, col 10)
    const result = prepareRename(trees["file:///a.stm"], 1, 10, "file:///a.stm", index);
    assert.ok(result);
    const lines = source.split("\n");
    const covered = lines[result.range.start.line].slice(
      result.range.start.character,
      result.range.end.character,
    );
    assert.equal(result.placeholder, covered);
    assert.equal(result.placeholder, "foo");
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
  it("renaming a::foo leaves same-named refs in namespace b untouched (sl-p256)", () => {
    // Two namespaces each declare a schema foo; namespace b's mapping refs
    // bind to b::foo. The namespace-blind findReferences fan-out previously
    // pulled those bare refs into a rename of a::foo, rewriting another
    // namespace's mapping.
    const source = [
      "namespace a {",
      "  schema foo { id UUID }",
      "  mapping m1 {",
      "    source { foo }",
      "    target { foo }",
      "    id -> id",
      "  }",
      "}",
      "namespace b {",
      "  schema foo { id UUID }",
      "  mapping m2 {",
      "    source { foo }",
      "    target { foo }",
      "    id -> id",
      "  }",
      "}",
    ].join("\n");
    const { index, trees } = buildIndex({ "file:///a.stm": source });
    // Cursor on namespace a's "foo" label (line 1, col 10)
    const edit = computeRename(trees["file:///a.stm"], 1, 10, "file:///a.stm", index, "bar");
    assert.ok(edit);
    const result = applyEdits(source, edit.changes["file:///a.stm"]);
    const aBlock = result.slice(0, result.indexOf("namespace b"));
    const bBlock = result.slice(result.indexOf("namespace b"));
    assert.ok(aBlock.includes("schema bar"), "a's definition is renamed");
    assert.ok(aBlock.includes("source { bar }"), "a's own mapping refs are renamed");
    assert.ok(!bBlock.includes("bar"), "namespace b must be untouched");
    assert.ok(bBlock.includes("source { foo }"), "b's refs keep binding to b::foo");
  });

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

  it("rewrites a bare @ref in unquoted pipe text without deleting the @ sigil", () => {
    // bptar-l6n8: bare pipe text parses to a structural at_ref node, not an
    // nl_string, so the rename pipeline never saw it — `{ derived from
    // @customers }` kept the old name after a rename while the quoted form
    // was rewritten.
    const bSource =
      'mapping `m` {\n  source { customers }\n  target { dim }\n  a -> b { derived from @customers }\n}';
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
      renamed.includes("derived from @clients"),
      `expected bare at_ref to be renamed with @ intact, got: ${renamed}`,
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

  it("preserves a source ref's metadata block when renaming the referenced schema", () => {
    // sl-kf1r: source/target refs were indexed with the range of the whole
    // source_ref node, which includes the optional metadata block — renaming
    // customers -> clients turned `customers (note "refreshed daily")` into
    // `clients`, silently deleting the note.
    const source =
      'schema customers {\n  id UUID\n}\nmapping `m` {\n  source { customers (note "refreshed daily") }\n  target { dim }\n  id -> id\n}';
    const { index, trees } = buildIndex({ "file:///a.stm": source });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      8,
      "file:///a.stm",
      index,
      "clients",
    );
    assert.ok(edit);
    const renamed = applyEdits(source, edit.changes["file:///a.stm"]);
    assert.ok(
      renamed.includes('source { clients (note "refreshed daily") }'),
      `expected the metadata block to survive the rename, got: ${renamed}`,
    );
  });

  it("preserves the ... sigil when renaming a fragment used as a spread", () => {
    // sl-kf1r: spread refs were indexed with the range of the whole
    // fragment_spread node, which includes the "..." sigil — renaming the
    // fragment turned "...audit_fields" into "tracking_fields", deleting the
    // sigil and leaving an invalid declaration.
    const source =
      "fragment audit_fields {\n  ts TIMESTAMP\n}\nschema customers {\n  id UUID\n  ...audit_fields\n}";
    const { index, trees } = buildIndex({ "file:///a.stm": source });
    const edit = computeRename(
      trees["file:///a.stm"],
      0,
      10,
      "file:///a.stm",
      index,
      "tracking_fields",
    );
    assert.ok(edit);
    const renamed = applyEdits(source, edit.changes["file:///a.stm"]);
    assert.ok(
      renamed.includes("...tracking_fields"),
      `expected the spread sigil to survive the rename, got: ${renamed}`,
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

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeHover } = require("../dist/hover");

before(async () => { await initTestParser(); });

/** Shorthand: get the markdown hover text at a position. */
function hover(source, line, col) {
  const tree = parse(source);
  const result = computeHover(tree, line, col);
  return result?.contents?.value ?? null;
}

describe("computeHover", () => {
  it("returns null for empty files", () => {
    assert.equal(hover("", 0, 0), null);
  });

  it("shows schema summary on block label", () => {
    const md = hover(
      "schema customers {\n  id UUID (pk)\n  name VARCHAR(200)\n}",
      0,
      8,
    );
    assert.ok(md);
    assert.ok(md.includes("**schema** `customers`"));
    assert.ok(md.includes("2 field(s)"));
    assert.ok(md.includes("`id`"));
    assert.ok(md.includes("UUID"));
    assert.ok(md.includes("*(pk)*"));
  });

  it("shows the schema summary when the cursor sits at the end of the block label (sl-ogd5)", () => {
    // Word-end regression: column 16 is immediately after the final "s" of
    // "customers"; hover must resolve the label, not the following node.
    const md = hover(
      "schema customers {\n  id UUID (pk)\n  name VARCHAR(200)\n}",
      0,
      16,
    );
    assert.ok(md, "expected hover content at end-of-identifier cursor");
    assert.ok(md.includes("**schema** `customers`"));
  });

  it("shows fragment summary on block label", () => {
    const md = hover(
      "fragment audit {\n  created_at TIMESTAMPTZ\n  updated_at TIMESTAMPTZ\n}",
      0,
      10,
    );
    assert.ok(md);
    assert.ok(md.includes("**fragment** `audit`"));
    assert.ok(md.includes("2 field(s)"));
  });

  it("shows field info with type and parent", () => {
    const md = hover(
      "schema customers {\n  email VARCHAR(255) (pii)\n}",
      1,
      3,
    );
    assert.ok(md);
    assert.ok(md.includes("**field** `email`"));
    assert.ok(md.includes("Type: `VARCHAR(255)`"));
    assert.ok(md.includes("Metadata: pii"));
    assert.ok(md.includes("In: `schema customers`"));
  });

  it("shows type info on type expression", () => {
    const md = hover("schema foo {\n  id UUID\n}", 1, 6);
    assert.ok(md);
    assert.ok(md.includes("**type** `UUID`"));
  });

  it("shows tag description for known tags", () => {
    const md = hover("schema foo {\n  id UUID (pk)\n}", 1, 12);
    assert.ok(md);
    assert.ok(md.includes("**tag** `pk`"));
    assert.ok(md.includes("Primary key"));
  });

  it("shows mapping summary with source and target", () => {
    const md = hover(
      "mapping migrate {\n  source { `legacy` }\n  target { `new_db` }\n  old_id -> new_id\n}",
      0,
      9,
    );
    assert.ok(md);
    assert.ok(md.includes("**mapping** `migrate`"));
    assert.ok(md.includes("Source:"));
    assert.ok(md.includes("Target:"));
  });

  it("shows transform summary with body", () => {
    const md = hover(
      "transform clean {\n  trim | lowercase\n}",
      0,
      11,
    );
    assert.ok(md);
    assert.ok(md.includes("**transform** `clean`"));
    assert.ok(md.includes("trim"));
  });

  it("shows metric summary with display label", () => {
    // Metrics are now schema blocks with (metric, metric_name "...", ...) metadata.
    // Hover should show **metric** kind and the metric_name value as Display.
    const md = hover(
      'schema mrr (\n  metric,\n  metric_name "MRR",\n  source fact_sub,\n  grain monthly,\n) {\n  value DECIMAL\n}',
      0,
      8,
    );
    assert.ok(md);
    assert.ok(md.includes("**metric** `mrr`"));
    assert.ok(md.includes('Display: "MRR"'));
  });

  it("shows spread info with resolved fragment", () => {
    const source = [
      "fragment audit {",
      "  created_at TIMESTAMPTZ",
      "  updated_at TIMESTAMPTZ",
      "}",
      "",
      "schema orders {",
      "  id UUID (pk)",
      "  ...audit",
      "}",
    ].join("\n");
    const md = hover(source, 7, 5);
    assert.ok(md);
    assert.ok(md.includes("**spread** `...audit`"));
    assert.ok(md.includes("**fragment** `audit`"));
    assert.ok(md.includes("2 field(s)"));
  });

  it("shows spread label for unresolved fragment", () => {
    const md = hover("schema foo {\n  ...unknown\n}", 1, 5);
    assert.ok(md);
    assert.ok(md.includes("**spread** `...unknown`"));
  });

  it("shows arrow path info", () => {
    const md = hover(
      "mapping m {\n  source { `src` }\n  target { `tgt` }\n  old_id -> new_id\n}",
      3,
      3,
    );
    assert.ok(md);
    assert.ok(md.includes("**source path**"));
  });

  it("shows target arrow path info", () => {
    const md = hover(
      "mapping m {\n  source { `src` }\n  target { `tgt` }\n  old_id -> new_id\n}",
      3,
      14,
    );
    assert.ok(md);
    assert.ok(md.includes("**target path**"));
  });

  it("shows namespace info", () => {
    const md = hover(
      "namespace crm {\n  schema customers {\n    id UUID\n  }\n}",
      0,
      11,
    );
    assert.ok(md);
    assert.ok(md.includes("**namespace** `crm`"));
  });

  it("shows note block info", () => {
    const md = hover('note {\n  "This is documentation"\n}', 0, 1);
    assert.ok(md);
    assert.ok(md.includes("**note**"));
  });

  it("returns hover range pointing to the target node", () => {
    const tree = parse("schema customers {\n  id UUID\n}");
    const result = computeHover(tree, 0, 8);
    assert.ok(result);
    assert.ok(result.range);
    // Range should cover the schema_block
    assert.equal(result.range.start.line, 0);
  });

  it("handles nested record fields", () => {
    const md = hover(
      "schema order {\n  address record {\n    street STRING\n    city STRING\n  }\n}",
      1,
      3,
    );
    assert.ok(md);
    assert.ok(md.includes("**field** `address`"));
    assert.ok(md.includes("Structure: `record`"));
  });

  it("handles list_of record fields", () => {
    const md = hover(
      "schema order {\n  items list_of record {\n    sku STRING\n  }\n}",
      1,
      3,
    );
    assert.ok(md);
    assert.ok(md.includes("**field** `items`"));
    assert.ok(md.includes("Structure: `list_of record`"));
  });
});

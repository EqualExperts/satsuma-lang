const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeDocumentSymbols } = require("../dist/symbols");

before(async () => {
  await initTestParser();
});

// SymbolKind constants from LSP spec
const SymbolKind = {
  Class: 5,
  Interface: 11,
  Function: 12,
  Constant: 14,
  Field: 8,
  Struct: 23,
  Namespace: 3,
  File: 1,
  Package: 4,
  Property: 7,
};

describe("computeDocumentSymbols", () => {
  it("returns schema as Class with fields as children", () => {
    const tree = parse(`schema customers {
  customer_id UUID (pk)
  name VARCHAR(200)
  email VARCHAR(255) (pii)
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "customers");
    assert.equal(symbols[0].kind, SymbolKind.Class);
    assert.equal(symbols[0].children.length, 3);
    assert.equal(symbols[0].children[0].name, "customer_id");
    assert.equal(symbols[0].children[0].kind, SymbolKind.Field);
  });

  it("returns fragment as Interface", () => {
    const tree = parse(`fragment \`audit fields\` {
  created_at TIMESTAMPTZ
  updated_at TIMESTAMPTZ
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "audit fields");
    assert.equal(symbols[0].kind, SymbolKind.Interface);
    assert.equal(symbols[0].children.length, 2);
  });

  it("returns mapping as Function", () => {
    const tree = parse(`mapping \`customer migration\` {
  source { \`legacy_db\` }
  target { \`new_db\` }
  old_id -> new_id
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "customer migration");
    assert.equal(symbols[0].kind, SymbolKind.Function);
  });

  it("returns transform as Function", () => {
    const tree = parse(`transform \`clean email\` {
  trim | lowercase | validate_email
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "clean email");
    assert.equal(symbols[0].kind, SymbolKind.Function);
  });

  it("returns metric as Constant with display label", () => {
    // Metrics are now schema blocks decorated with (metric, metric_name "...", ...)
    // metadata. Document symbols should show SymbolKind.Constant and the display label.
    const tree = parse(`schema monthly_recurring_revenue (
  metric,
  metric_name "MRR",
  source fact_subscriptions,
  grain monthly,
) {
  value DECIMAL(14,2)
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "monthly_recurring_revenue");
    assert.equal(symbols[0].kind, SymbolKind.Constant);
    assert.equal(symbols[0].detail, "MRR");
  });

  it("handles nested record fields as Struct", () => {
    const tree = parse(`schema order {
  order_id STRING (pk)
  customer record {
    id STRING
    email STRING (pii)
  }
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    const fields = symbols[0].children;
    assert.equal(fields.length, 2);
    assert.equal(fields[0].name, "order_id");
    assert.equal(fields[0].kind, SymbolKind.Field);
    assert.equal(fields[1].name, "customer");
    assert.equal(fields[1].kind, SymbolKind.Struct);
    assert.equal(fields[1].children.length, 2);
    assert.equal(fields[1].children[0].name, "id");
  });

  it("handles list_of record fields", () => {
    const tree = parse(`schema order {
  line_items list_of record {
    sku STRING
    quantity INT
  }
}`);
    const symbols = computeDocumentSymbols(tree);
    const field = symbols[0].children[0];
    assert.equal(field.name, "line_items");
    assert.equal(field.kind, SymbolKind.Struct);
    assert.equal(field.detail, "list_of record");
    assert.equal(field.children.length, 2);
  });

  it("handles note blocks", () => {
    const tree = parse(`note {
  "Some documentation here"
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "note");
    assert.equal(symbols[0].kind, SymbolKind.File);
  });

  it("handles anonymous mappings", () => {
    const tree = parse(`mapping {
  source { \`foo\` }
  target { \`bar\` }
  a -> b
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "(anonymous)");
    assert.equal(symbols[0].kind, SymbolKind.Function);
  });

  it("handles multiple top-level blocks", () => {
    const tree = parse(`schema foo {
  a STRING
}

schema bar {
  b INT
}

mapping \`migrate\` {
  source { \`foo\` }
  target { \`bar\` }
  a -> b
}`);
    const symbols = computeDocumentSymbols(tree);
    assert.equal(symbols.length, 3);
    assert.equal(symbols[0].name, "foo");
    assert.equal(symbols[1].name, "bar");
    assert.equal(symbols[2].name, "migrate");
  });

  it("handles empty files", () => {
    const tree = parse("");
    const symbols = computeDocumentSymbols(tree);
    assert.deepEqual(symbols, []);
  });

  it("selectionRange points to the block label", () => {
    const tree = parse("schema customers {\n  id UUID\n}");
    const symbols = computeDocumentSymbols(tree);
    const sel = symbols[0].selectionRange;
    // "customers" starts at col 7 on line 0
    assert.equal(sel.start.line, 0);
    assert.equal(sel.start.character, 7);
  });
});

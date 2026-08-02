const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeFoldingRanges } = require("../dist/folding");

before(async () => {
  await initTestParser();
});

describe("computeFoldingRanges", () => {
  it("returns fold ranges for schema blocks", () => {
    const tree = parse(`schema customers {
  id UUID (pk)
  name VARCHAR(200)
}`);
    const ranges = computeFoldingRanges(tree);
    assert.ok(ranges.length >= 1);
    const schemaFold = ranges.find((r) => r.startLine === 0);
    assert.ok(schemaFold, "Expected a fold starting at line 0");
    assert.equal(schemaFold.endLine, 3);
  });

  it("returns fold ranges for multiple block types", () => {
    const tree = parse(`schema foo {
  a STRING
}

fragment \`bar\` {
  b INT
}

mapping \`baz\` {
  source { \`foo\` }
  target { \`foo\` }
  a -> a
}`);
    const ranges = computeFoldingRanges(tree);
    // At least 3 top-level blocks
    const topLevelFolds = ranges.filter(
      (r) => r.startLine === 0 || r.startLine === 4 || r.startLine === 8,
    );
    assert.ok(
      topLevelFolds.length >= 3,
      `Expected 3+ top-level folds, got ${topLevelFolds.length}`,
    );
  });

  it("returns fold ranges for nested structures", () => {
    const tree = parse(`schema order {
  customer record {
    id STRING
    email STRING
  }
}`);
    const ranges = computeFoldingRanges(tree);
    // Should have at least schema fold and no separate record fold (record is part of field_decl)
    assert.ok(ranges.length >= 1);
  });

  it("does not fold single-line blocks", () => {
    // A single-line construct should not produce a fold
    const tree = parse("schema foo { a STRING }");
    const ranges = computeFoldingRanges(tree);
    const singleLine = ranges.filter((r) => r.startLine === r.endLine);
    assert.equal(singleLine.length, 0, "Single-line blocks should not be foldable");
  });

  it("handles empty files", () => {
    const tree = parse("");
    const ranges = computeFoldingRanges(tree);
    assert.deepEqual(ranges, []);
  });

  it("folds each/flatten blocks inside mappings", () => {
    const tree = parse(`mapping {
  source { \`src\` }
  target { \`tgt\` }

  each items -> target_items {
    .sku -> .sku
    .qty -> .qty
  }
}`);
    const ranges = computeFoldingRanges(tree);
    // Should have fold for mapping and for each block
    const eachFold = ranges.find((r) => r.startLine === 4);
    assert.ok(eachFold, "Expected a fold for the each block");
  });

  it("folds map literal blocks", () => {
    const tree = parse(`mapping {
  source { \`src\` }
  target { \`tgt\` }

  status -> status {
    map {
      A: "active"
      S: "suspended"
    }
  }
}`);
    const ranges = computeFoldingRanges(tree);
    const mapFold = ranges.find((r) => r.startLine === 5);
    assert.ok(mapFold, "Expected a fold for the map literal");
  });
});

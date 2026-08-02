/**
 * formatting.test.js — Tests for the DocumentFormattingProvider.
 *
 * Verifies that computeFormatting() returns correct TextEdit arrays
 * and that the output matches the CLI formatter.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeFormatting, initFormatting } = require("../dist/formatting");

before(async () => {
  await initTestParser();
  await initFormatting();
});

describe("computeFormatting", () => {
  it("returns empty array for already-formatted input", () => {
    const src = "schema test {\n  id  INT  (pk)\n}\n";
    const tree = parse(src);
    const edits = computeFormatting(tree, src);
    assert.equal(edits.length, 0, "should return no edits for formatted input");
  });

  it("returns a single TextEdit for unformatted input", () => {
    const src = "schema test{id INT (pk)}";
    const tree = parse(src);
    const edits = computeFormatting(tree, src);
    assert.equal(edits.length, 1, "should return one edit");
    assert.equal(edits[0].range.start.line, 0);
    assert.equal(edits[0].range.start.character, 0);
  });

  it("produces formatted output that matches expectations", () => {
    const src = "schema test{id INT (pk)}";
    const tree = parse(src);
    const edits = computeFormatting(tree, src);
    assert.ok(edits[0].newText.includes("schema test {"));
    assert.ok(edits[0].newText.includes("  id  INT  (pk)"));
    assert.ok(edits[0].newText.endsWith("}\n"));
  });

  it("handles mapping with arrows", () => {
    const src =
      "mapping test {\n  source { s }\n  target { t }\n  s.x -> t.x { trim | lowercase }\n}";
    const tree = parse(src);
    const edits = computeFormatting(tree, src);
    const result = edits.length > 0 ? edits[0].newText : src;
    assert.ok(result.includes("source { s }"));
    assert.ok(result.includes("target { t }"));
    assert.ok(result.includes("s.x -> t.x { trim | lowercase }"));
  });

  it("preserves comments", () => {
    const src = "// Header comment\nschema test {\n  x  INT\n}\n";
    const tree = parse(src);
    const edits = computeFormatting(tree, src);
    const result = edits.length > 0 ? edits[0].newText : src;
    assert.ok(result.includes("// Header comment"));
  });

  it("is idempotent", () => {
    const src = "schema messy{id INT (pk) name STRING}";
    const tree = parse(src);
    const edits1 = computeFormatting(tree, src);
    assert.equal(edits1.length, 1);

    const formatted = edits1[0].newText;
    const tree2 = parse(formatted);
    const edits2 = computeFormatting(tree2, formatted);
    assert.equal(edits2.length, 0, "formatting should be idempotent");
  });
});

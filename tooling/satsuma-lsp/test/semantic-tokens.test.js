const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { initTestParser, parse } = require("./helper");
const { initParser } = require("../dist/parser-utils");
const {
  computeSemanticTokens,
  setHighlightsSource,
  semanticTokensLegend,
} = require("../dist/semantic-tokens");

const WASM_PATH = path.resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");
const HIGHLIGHTS_PATH = path.resolve(__dirname, "../../tree-sitter-satsuma/queries/highlights.scm");

before(async () => {
  await initTestParser();
  // Also init the server's parser-utils so getLanguage() works for Query construction
  await initParser(WASM_PATH);
  setHighlightsSource(fs.readFileSync(HIGHLIGHTS_PATH, "utf-8"));
});

/**
 * Decode the delta-encoded semantic tokens data into readable objects.
 * Each token is 5 ints: deltaLine, deltaStartChar, length, tokenType, tokenModifiers.
 */
function decodeTokens(data) {
  const tokens = [];
  let line = 0;
  let col = 0;
  for (let i = 0; i < data.length; i += 5) {
    const dLine = data[i];
    const dCol = data[i + 1];
    const len = data[i + 2];
    const typeIdx = data[i + 3];
    const mods = data[i + 4];

    if (dLine > 0) {
      line += dLine;
      col = dCol;
    } else {
      col += dCol;
    }

    tokens.push({
      line,
      col,
      length: len,
      type: semanticTokensLegend.tokenTypes[typeIdx],
      mods,
    });
  }
  return tokens;
}

describe("computeSemanticTokens", () => {
  it("returns empty data for empty files", () => {
    const tree = parse("");
    const result = computeSemanticTokens(tree);
    assert.deepEqual(result.data, []);
  });

  it("tokenizes schema keyword and label", () => {
    const tree = parse("schema customers {}");
    const result = computeSemanticTokens(tree);
    const tokens = decodeTokens(result.data);

    // First token: "schema" keyword
    assert.equal(tokens[0].line, 0);
    assert.equal(tokens[0].col, 0);
    assert.equal(tokens[0].length, 6);
    assert.equal(tokens[0].type, "keyword");

    // Second token: "customers" — type with definition modifier
    assert.equal(tokens[1].line, 0);
    assert.equal(tokens[1].col, 7);
    assert.equal(tokens[1].length, 9);
    assert.equal(tokens[1].type, "type");
    assert.equal(tokens[1].mods & 1, 1); // definition modifier bit
  });

  it("tokenizes field declarations with types", () => {
    const tree = parse("schema foo {\n  id UUID\n}");
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    // Find the field name token
    const fieldToken = tokens.find((t) => t.type === "property" && t.line === 1);
    assert.ok(fieldToken, "should have a property token for field name");
    assert.equal(fieldToken.length, 2); // "id"

    // Find the type token
    const typeToken = tokens.find((t) => t.type === "type" && t.line === 1);
    assert.ok(typeToken, "should have a type token for UUID");
    assert.equal(typeToken.length, 4); // "UUID"
  });

  it("tokenizes mapping keyword and label as function definition", () => {
    const tree = parse("mapping migrate {\n  source { `s` }\n  target { `t` }\n  a -> b\n}");
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const keyword = tokens.find((t) => t.type === "keyword");
    assert.ok(keyword);
    assert.equal(keyword.length, 7); // "mapping"

    const label = tokens.find((t) => t.type === "function");
    assert.ok(label);
    assert.equal(label.mods & 1, 1); // definition modifier
  });

  it("tokenizes namespace labels as namespace type", () => {
    const tree = parse("namespace crm {}");
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const nsToken = tokens.find((t) => t.type === "namespace");
    assert.ok(nsToken, "should have a namespace token");
    assert.equal(nsToken.length, 3); // "crm"
  });

  it("tokenizes metadata tags as decorators", () => {
    const tree = parse("schema foo {\n  id UUID (pk, pii)\n}");
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const decorators = tokens.filter((t) => t.type === "decorator");
    assert.ok(decorators.length >= 2, "should have decorator tokens for pk and pii");
  });

  it("tokenizes comments", () => {
    const tree = parse("// regular comment\n//! warning\n//? question");
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const comments = tokens.filter((t) => t.type === "comment");
    assert.equal(comments.length, 3, "should have 3 comment tokens");
  });

  // After Feature 28, pipe chain bare tokens are NL text, not function calls.
  // They should receive string tokens, while the block label stays function.definition.
  it("tokenizes pipe chain bare tokens as strings, not function calls", () => {
    const tree = parse("transform clean {\n  trim | lowercase | validate_email\n}");
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    // 'clean' is still function.definition (block label)
    const funcTokens = tokens.filter((t) => t.type === "function");
    assert.ok(funcTokens.length >= 1, "should have function token for block label");

    // Bare pipe tokens (trim, lowercase, validate_email) are now string tokens
    const stringTokens = tokens.filter((t) => t.type === "string");
    assert.ok(stringTokens.length >= 3, "pipe chain bare tokens should be string tokens");
  });

  it("tokenizes import keywords", () => {
    const tree = parse('import { customers } from "crm.stm"');
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const keywords = tokens.filter((t) => t.type === "keyword");
    assert.ok(keywords.length >= 2, "should have keyword tokens for import and from");
  });

  it("tokenizes operators and punctuation", () => {
    const tree = parse("schema foo {\n  a STRING\n}");
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const operators = tokens.filter((t) => t.type === "operator");
    assert.ok(operators.length >= 2, "should have operator tokens for { and }");
  });

  it("deduplicates overlapping captures", () => {
    // nl_string captures can overlap with other string captures in highlights.scm
    const tree = parse('metric mrr "MRR" {}');
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    // Check no two tokens share the same position
    const positions = tokens.map((t) => `${t.line}:${t.col}`);
    const unique = new Set(positions);
    assert.equal(positions.length, unique.size, "no duplicate token positions");
  });

  it("does not emit variable tokens for strings without @refs", () => {
    const tree = parse('note { "No refs here." }');
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const varTokens = tokens.filter((t) => t.type === "variable");
    assert.equal(varTokens.length, 0, "should have no variable tokens");
  });

  it("has a valid legend with standard token types", () => {
    assert.ok(semanticTokensLegend.tokenTypes.length > 0);
    assert.ok(semanticTokensLegend.tokenModifiers.length > 0);
    assert.ok(semanticTokensLegend.tokenTypes.includes("keyword"));
    assert.ok(semanticTokensLegend.tokenTypes.includes("type"));
    assert.ok(semanticTokensLegend.tokenTypes.includes("function"));
    assert.ok(semanticTokensLegend.tokenTypes.includes("variable"));
    assert.ok(semanticTokensLegend.tokenTypes.includes("property"));
  });

  it("applies nlRef modifier to @refs in nl_string", () => {
    const tree = parse('note { "Check @balance field." }');
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const varTokens = tokens.filter((t) => t.type === "variable");
    assert.equal(varTokens.length, 1, "should have 1 variable token");
    // nlRef modifier is at bit index 4 (1 << 4 = 16)
    assert.equal(varTokens[0].mods & 16, 16, "should have nlRef modifier set");

    // String parts should NOT have the nlRef modifier
    const stringTokens = tokens.filter((t) => t.type === "string" && t.line === 0 && t.col >= 7);
    for (const st of stringTokens) {
      assert.equal(st.mods & 16, 0, "string segments should not have nlRef modifier");
    }
  });

  it("legend includes nlRef modifier", () => {
    assert.ok(
      semanticTokensLegend.tokenModifiers.includes("nlRef"),
      "should include nlRef modifier in legend",
    );
  });

  it("tokenizes @ref references inside nl_string as variable", () => {
    const tree = parse('note { "Check @balance and @customers.email field." }');
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const varTokens = tokens.filter((t) => t.type === "variable");
    assert.equal(varTokens.length, 2, "should have 2 variable tokens for @refs");
    assert.equal(varTokens[0].length, "@balance".length);
    assert.equal(varTokens[1].length, "@customers.email".length);

    // Should have nlRef modifier
    assert.equal(varTokens[0].mods & 16, 16, "@ref should have nlRef modifier");
    assert.equal(varTokens[1].mods & 16, 16, "@ref should have nlRef modifier");
  });

  it("tokenizes @ref references inside multiline_string as variable", () => {
    const tree = parse('note {\n  """\n  Sum @orders.total and @tax fields.\n  """\n}');
    const tokens = decodeTokens(computeSemanticTokens(tree).data);

    const varTokens = tokens.filter((t) => t.type === "variable");
    assert.equal(varTokens.length, 2, "should have 2 variable tokens for @refs in multiline");
    assert.equal(varTokens[0].length, "@orders.total".length);
    assert.equal(varTokens[1].length, "@tax".length);
  });
});

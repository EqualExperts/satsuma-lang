/**
 * parser-utils.test.js — Coverage for nodeAtPosition, the shared
 * cursor-position resolver used by every position-based LSP handler.
 *
 * Regression suite for sl-ogd5: tree-sitter ranges are half-open, so the
 * raw descendantForPosition lookup resolved a cursor immediately after the
 * last character of an identifier to the *following* node, making all
 * position-based features fail at word end while working mid-word.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { nodeAtPosition } = require("../dist/parser-utils");

before(async () => { await initTestParser(); });

// Column reference for the fixture below (line 4):
//   "  source { customers }"
//    0123456789…
// "customers" spans columns 11–20 (end-exclusive).
const SOURCE = `schema customers {
  id UUID (pk)
}
mapping \`test\` {
  source { customers }
  target { dim }
  id -> id
}`;

describe("nodeAtPosition", () => {
  it("resolves the identifier when the cursor sits immediately after its last character", () => {
    // The core sl-ogd5 case: position 20 is the half-open end of
    // "customers", where the raw lookup returns the following node.
    const tree = parse(SOURCE);
    const node = nodeAtPosition(tree, 4, 20);
    assert.equal(node.text, "customers");
  });

  it("resolves the identifier for mid-word and word-start cursors", () => {
    // Guards that the end-of-word retry does not disturb the positions
    // that already worked before the fix.
    const tree = parse(SOURCE);
    assert.equal(nodeAtPosition(tree, 4, 15).text, "customers");
    assert.equal(nodeAtPosition(tree, 4, 11).text, "customers");
  });

  it("treats a cursor after a word-then-whitespace boundary as end of that word only when adjacent", () => {
    // Line 6 is "  id -> id". Column 4 sits immediately after "id" → the
    // word wins. Column 5 is separated from "id" by a space → the retry
    // must not reach back across the whitespace.
    const tree = parse(SOURCE);
    assert.equal(nodeAtPosition(tree, 6, 4).text, "id");
    assert.notEqual(nodeAtPosition(tree, 6, 5).text, "id");
  });

  it("leaves cursors on punctuation on the punctuation node", () => {
    // Column 6 is inside "->" on line 6. The word-token preference must
    // not pull the cursor off a punctuation token the user is actually on.
    const tree = parse(SOURCE);
    assert.equal(nodeAtPosition(tree, 6, 6).text, "->");
  });

  it("returns a node for column 0 without attempting a negative retry", () => {
    // Word-start at the line origin: there is no column -1 to retry, and
    // the raw position already resolves the token.
    const tree = parse(SOURCE);
    assert.equal(nodeAtPosition(tree, 0, 0).text, "schema");
  });
});

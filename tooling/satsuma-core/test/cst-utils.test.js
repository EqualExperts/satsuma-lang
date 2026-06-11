/**
 * cst-utils.test.js — Unit tests for satsuma-core/src/cst-utils.ts
 *
 * Uses lightweight mock CST nodes that mirror the tree-sitter node structure
 * (type, text, namedChildren). No native binary or WASM required.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  child,
  children,
  allDescendants,
  labelText,
  stringText,
  entryText,
  qualifiedNameText,
  sourceRefText,
  sourceRefStructuralText,
  fieldNameText,
  walkDescendants,
} from "../dist/cst-utils.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function n(type, namedChildren = [], text = "") {
  return {
    type,
    text,
    isNamed: true,
    namedChildren,
    children: namedChildren,
    childCount: namedChildren.length,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: text.length },
    startIndex: 0,
    endIndex: text.length,
    isMissing: false,
    parent: null,
    child: (i) => namedChildren[i] ?? null,
  };
}

function ident(text) {
  return n("identifier", [], text);
}

function backtick(inner) {
  return n("backtick_name", [], `\`${inner}\``);
}

function nlStr(inner) {
  return n("nl_string", [], `"${inner}"`);
}


function blockLabel(nameNode) {
  return n("block_label", [nameNode]);
}

// ── child() ──────────────────────────────────────────────────────────────────

describe("child()", () => {
  it("returns the first named child of the given type", () => {
    const a = ident("a");
    const b = n("block_label", [], "lbl");
    const root = n("schema_block", [a, b]);
    assert.strictEqual(child(root, "block_label"), b);
  });

  it("returns null when no child of the given type exists", () => {
    const root = n("schema_block", [ident("foo")]);
    assert.strictEqual(child(root, "block_label"), null);
  });

  it("skips null entries in namedChildren", () => {
    const b = n("block_label", [], "lbl");
    const root = { ...n("schema_block", []), namedChildren: [null, b] };
    assert.strictEqual(child(root, "block_label"), b);
  });
});

// ── children() ───────────────────────────────────────────────────────────────

describe("children()", () => {
  it("returns all named children of the given type", () => {
    const f1 = n("field_decl", [], "f1");
    const f2 = n("field_decl", [], "f2");
    const other = ident("x");
    const root = n("schema_body", [f1, other, f2]);
    assert.deepEqual(children(root, "field_decl"), [f1, f2]);
  });

  it("returns empty array when no children of the given type", () => {
    const root = n("schema_body", [ident("x")]);
    assert.deepEqual(children(root, "field_decl"), []);
  });

  it("filters null entries", () => {
    const f1 = n("field_decl", [], "f1");
    const root = { ...n("schema_body", []), namedChildren: [null, f1, null] };
    assert.deepEqual(children(root, "field_decl"), [f1]);
  });
});

// ── allDescendants() ─────────────────────────────────────────────────────────

describe("allDescendants()", () => {
  it("collects all descendants of the given type at any depth", () => {
    const w1 = n("warning_comment", [], "//! a");
    const w2 = n("warning_comment", [], "//! b");
    const nested = n("schema_body", [w1]);
    const root = n("source_node", [nested, w2]);
    const result = allDescendants(root, "warning_comment");
    assert.deepEqual(result, [w1, w2]);
  });

  it("returns empty array when type not found", () => {
    const root = n("root", [n("schema_block", [ident("a")])]);
    assert.deepEqual(allDescendants(root, "warning_comment"), []);
  });

  it("skips null children", () => {
    const w = n("warning_comment", [], "//! x");
    const body = { ...n("schema_body", []), namedChildren: [null, w] };
    const root = n("root", [body]);
    assert.deepEqual(allDescendants(root, "warning_comment"), [w]);
  });
});

// ── labelText() ──────────────────────────────────────────────────────────────

describe("labelText()", () => {
  it("returns identifier text from block_label", () => {
    const lbl = blockLabel(ident("customers"));
    const block = n("schema_block", [lbl]);
    assert.equal(labelText(block), "customers");
  });

  it("strips backticks from backtick_name in block_label", () => {
    const lbl = blockLabel(backtick("my entity"));
    const block = n("schema_block", [lbl]);
    assert.equal(labelText(block), "my entity");
  });

  it("returns null when no block_label child", () => {
    const block = n("schema_block", [ident("x")]);
    assert.equal(labelText(block), null);
  });

  it("returns null when block_label has no children", () => {
    const lbl = n("block_label", []);
    const block = n("schema_block", [lbl]);
    assert.equal(labelText(block), null);
  });
});

// ── stringText() ─────────────────────────────────────────────────────────────

describe("stringText()", () => {
  it("strips nl_string delimiters from a simple string", () => {
    assert.equal(stringText(nlStr("hello world")), "hello world");
  });

  it("returns empty string for an empty nl_string", () => {
    const empty = n("nl_string", [], '""');
    assert.equal(stringText(empty), "");
  });

  it("unescapes escaped double quotes in nl_string", () => {
    // nl_string raw text includes the backslash-quote sequence from the source
    const node = n("nl_string", [], '"she said \\"hello\\""');
    assert.equal(stringText(node), 'she said "hello"');
  });

  it("unescapes escaped backslashes in nl_string", () => {
    const node = n("nl_string", [], '"path\\\\to\\\\file"');
    assert.equal(stringText(node), "path\\to\\file");
  });

  it("unescapes mixed escaped quotes and backslashes in nl_string", () => {
    const node = n("nl_string", [], '"a\\\\\\"b"');
    assert.equal(stringText(node), 'a\\"b');
  });

  it("strips multiline_string delimiters and trims whitespace (no escape handling)", () => {
    const ms = n("multiline_string", [], '"""  trimmed  """');
    assert.equal(stringText(ms), "trimmed");
  });

  it("preserves backslash sequences in multiline_string (raw syntax)", () => {
    const ms = n("multiline_string", [], '"""has \\"quotes\\" inside"""');
    assert.equal(stringText(ms), 'has \\"quotes\\" inside');
  });

  it("returns raw text for other node types", () => {
    const id = ident("foo");
    assert.equal(stringText(id), "foo");
  });

  it("returns null for null input", () => {
    assert.equal(stringText(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(stringText(undefined), null);
  });
});

// ── entryText() ──────────────────────────────────────────────────────────────

describe("entryText()", () => {
  it("strips backticks from backtick_name", () => {
    assert.equal(entryText(backtick("my field")), "my field");
  });

  it("strips quotes from nl_string", () => {
    assert.equal(entryText(nlStr("some value")), "some value");
  });

  it("returns raw text for identifier", () => {
    assert.equal(entryText(ident("customer_id")), "customer_id");
  });

  it("returns null for null input", () => {
    assert.equal(entryText(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(entryText(undefined), null);
  });
});

// ── qualifiedNameText() ─────────────────────────────────────────────────────

describe("qualifiedNameText()", () => {
  it("extracts ns::name from a qualified_name node with two identifiers", () => {
    const qn = n("qualified_name", [ident("crm"), ident("customers")], "crm::customers");
    assert.equal(qualifiedNameText(qn), "crm::customers");
  });

  it("returns null when qualified_name has fewer than two identifiers", () => {
    const qn = n("qualified_name", [ident("solo")], "solo");
    assert.equal(qualifiedNameText(qn), null);
  });

  it("returns null for non-qualified_name node type", () => {
    assert.equal(qualifiedNameText(ident("plain")), null);
  });

  it("returns null for null input", () => {
    assert.equal(qualifiedNameText(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(qualifiedNameText(undefined), null);
  });
});

// ── sourceRefText() ─────────────────────────────────────────────────────────

describe("sourceRefText()", () => {
  it("extracts identifier text from a source_ref with an identifier child", () => {
    const ref = n("source_ref", [ident("orders")], "orders");
    assert.equal(sourceRefText(ref), "orders");
  });

  it("extracts qualified name from a source_ref with a qualified_name child", () => {
    const qn = n("qualified_name", [ident("crm"), ident("orders")], "crm::orders");
    const ref = n("source_ref", [qn], "crm::orders");
    assert.equal(sourceRefText(ref), "crm::orders");
  });

  it("falls back to qualified_name text when a recovered tree has an incomplete qualified child", () => {
    const qn = n("qualified_name", [ident("crm")], "crm::");
    const ref = n("source_ref", [qn], "crm::");
    assert.equal(sourceRefText(ref), "crm::");
  });

  it("strips backticks from a source_ref with a backtick_name child", () => {
    const ref = n("source_ref", [backtick("my entity")], "`my entity`");
    assert.equal(sourceRefText(ref), "my entity");
  });

  it("strips quotes from a source_ref with an nl_string child", () => {
    const ref = n("source_ref", [nlStr("string ref")], '"string ref"');
    assert.equal(sourceRefText(ref), "string ref");
  });

  it("returns null for null input", () => {
    assert.equal(sourceRefText(null), null);
  });
});

// ── sourceRefStructuralText() ──────────────────────────────────────────────

describe("sourceRefStructuralText()", () => {
  it("extracts identifier text from a structural source_ref", () => {
    const ref = n("source_ref", [ident("orders")], "orders");
    assert.equal(sourceRefStructuralText(ref), "orders");
  });

  it("extracts qualified names from structural source refs", () => {
    const qn = n("qualified_name", [ident("crm"), ident("orders")], "crm::orders");
    const ref = n("source_ref", [qn], "crm::orders");
    assert.equal(sourceRefStructuralText(ref), "crm::orders");
  });

  it("falls back to recovered qualified_name text for structural source refs", () => {
    const qn = n("qualified_name", [ident("crm")], "crm::");
    const ref = n("source_ref", [qn], "crm::");
    assert.equal(sourceRefStructuralText(ref), "crm::");
  });

  it("ignores nl_string join descriptions inside a source_ref", () => {
    const ref = n("source_ref", [nlStr("Join on a.id = b.id")], '"Join on a.id = b.id"');
    assert.equal(sourceRefStructuralText(ref), null);
  });
});

// ── fieldNameText() ─────────────────────────────────────────────────────────

describe("fieldNameText()", () => {
  it("returns plain identifier text from a field_name node", () => {
    const fn = n("field_name", [ident("amount")], "amount");
    assert.equal(fieldNameText(fn), "amount");
  });

  it("strips backticks from a backtick_name child of field_name", () => {
    const fn = n("field_name", [backtick("field with spaces")], "`field with spaces`");
    assert.equal(fieldNameText(fn), "field with spaces");
  });

  it("returns the node text when field_name has no named children", () => {
    const fn = { ...n("field_name", [], "bare"), namedChildren: [] };
    assert.equal(fieldNameText(fn), "bare");
  });

  it("returns null for null input", () => {
    assert.equal(fieldNameText(null), null);
  });
});

// ── walkDescendants() ───────────────────────────────────────────────────────

describe("walkDescendants()", () => {
  it("visits all named descendants depth-first", () => {
    const leaf1 = ident("a");
    const leaf2 = ident("b");
    const mid = n("field_decl", [leaf1], "f");
    const root = n("schema_body", [mid, leaf2]);
    const visited = [];
    walkDescendants(root, (node) => visited.push(node.text));
    // depth-first: mid, leaf1 (inside mid), leaf2
    assert.deepEqual(visited, ["f", "a", "b"]);
  });

  it("handles empty children without error", () => {
    const root = n("root", []);
    const visited = [];
    walkDescendants(root, (node) => visited.push(node.text));
    assert.deepEqual(visited, []);
  });

  it("skips null entries in namedChildren", () => {
    const leaf = ident("x");
    const root = { ...n("root", []), namedChildren: [null, leaf] };
    const visited = [];
    walkDescendants(root, (node) => visited.push(node.text));
    assert.deepEqual(visited, ["x"]);
  });
});

// ── MISSING-node guards (sl-0nvt) ───────────────────────────────────────────
// Tree-sitter error recovery inserts zero-width MISSING leaves (e.g. inside
// `import { } from "x"` or `source { }`). Extraction must yield null/no names
// for those shapes, never empty strings.

describe("zero-width MISSING recovery guards (sl-0nvt)", () => {
  /** A zero-width MISSING identifier as produced by tree-sitter recovery. */
  function missingIdent() {
    return { ...ident(""), isMissing: true };
  }

  it("sourceRefText returns null for a source_ref holding only a MISSING identifier", () => {
    const ref = n("source_ref", [missingIdent()], "");
    assert.equal(sourceRefText(ref), null);
  });

  it("sourceRefStructuralText returns null for a source_ref holding only a MISSING identifier", () => {
    const ref = n("source_ref", [missingIdent()], "");
    assert.equal(sourceRefStructuralText(ref), null);
  });

  it("qualifiedNameText returns null when either identifier is MISSING", () => {
    const qn = n("qualified_name", [ident("crm"), missingIdent()], "crm::");
    assert.equal(qualifiedNameText(qn), null);
  });
});

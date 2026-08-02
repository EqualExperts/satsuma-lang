/**
 * recovery.test.js — LSP behaviour on recovered (MISSING-node) trees.
 *
 * The grammar produces MISSING / ERROR nodes when input is mid-edit. The
 * LSP must keep responding to client requests on those trees rather than
 * crashing — otherwise the editor goes silent every time the user types
 * an unmatched brace, which would make Satsuma editing painful.
 *
 * Each test parses an intentionally broken snippet, builds a workspace
 * index, and exercises one LSP feature, asserting only that:
 *   1. The handler returns without throwing.
 *   2. It produces a well-typed result (array / object / null) rather
 *      than `undefined` from a half-finished traversal.
 *
 * These are *integration* tests at the handler level: they invoke the
 * same compiled functions the server.ts request handlers do.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");
const { computeDiagnostics } = require("../dist/diagnostics");
const { computeDocumentSymbols } = require("../dist/symbols");
const { computeCompletions } = require("../dist/completion");

before(async () => {
  await initTestParser();
});

/** Parse `source`, index it under `uri`, and return {tree, index}. */
function indexed(source, uri = "file:///broken.stm") {
  const tree = parse(source);
  const index = createWorkspaceIndex();
  indexFile(index, uri, tree);
  return { tree, index, uri };
}

describe("LSP error recovery — handlers on MISSING-node trees", () => {
  // ── 1. diagnostics on an unterminated schema body ────────────────────────
  it("computeDiagnostics produces parse diagnostics, not a crash, when a brace is missing", () => {
    // No closing brace — the parser inserts a MISSING `}` and creates ERROR
    // nodes around the broken region. computeDiagnostics walks the tree
    // collecting parse errors; it must produce a (non-empty) array.
    const { tree } = indexed("schema customers {\n  id UUID\n  name VARCHAR\n");
    let diags;
    assert.doesNotThrow(() => {
      diags = computeDiagnostics(tree);
    });
    assert.ok(Array.isArray(diags));
    assert.ok(diags.length >= 1, "an unterminated schema body should yield ≥1 parse diagnostic");
  });

  // ── 2. document symbols on a half-typed mapping body ──────────────────────
  it("computeDocumentSymbols returns the well-formed prefix when later content is broken", () => {
    // The first schema is well-formed; the mapping body afterwards is
    // truncated mid-arrow. Symbol extraction must still surface the schema.
    const { tree } = indexed(
      `schema customers {
  id UUID
  name VARCHAR
}
mapping \`m\` {
  source { customers
  target { dim }
  id ->
`,
    );
    let symbols;
    assert.doesNotThrow(() => {
      symbols = computeDocumentSymbols(tree);
    });
    assert.ok(Array.isArray(symbols));
    const names = symbols.map((s) => s.name);
    assert.ok(names.includes("customers"), "well-formed schema must still appear in symbol list");
  });

  // ── 3. completions on a file with a dangling field declaration ─────────────
  it("computeCompletions handles a field with a missing type without throwing", () => {
    // The `email` field has no type; the parser inserts a MISSING type node.
    // Completions inside the surrounding schema must still return an array.
    const src = `schema customers {
  id UUID
  email
  name VARCHAR
}
mapping \`m\` {
  source { c }
  target { c }
  id -> id
}`;
    const { tree, index, uri } = indexed(src);
    let items;
    assert.doesNotThrow(() => {
      // Cursor inside `source { c }` — schema-name completion context.
      items = computeCompletions(tree, 6, 12, uri, index);
    });
    assert.ok(Array.isArray(items));
  });
});

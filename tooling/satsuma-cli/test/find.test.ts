/**
 * find.test.ts — Unit tests for the `satsuma find` tag-matching helpers.
 *
 * These tests parse minimal Satsuma snippets with the real WASM parser and
 * call the real helpers exported from src/commands/find.ts. An earlier
 * version of this file asserted against inline *copies* of the helpers,
 * which silently diverged from the implementation — the sl-xav4 regression
 * was invisible to it. Never re-inline the helpers here.
 *
 * End-to-end command behaviour (scopes, JSON shape, exit codes, fragment
 * spreads) is covered in integration.test.ts.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

let parseSource: (src: string) => { tree: any };
let findTagInMeta: (metaNode: any, tag: string) => string | null;
let collectFieldMatches: (
  bodyNode: any,
  blockType: string,
  blockName: string,
  file: string,
  tag: string,
  acc: any[],
) => void;

before(async () => {
  ({ parseSource } = await import("#src/parser.js"));
  ({ findTagInMeta, collectFieldMatches } = await import("#src/commands/find.js"));
});

// ── CST helpers ───────────────────────────────────────────────────────────────

/** Depth-first search for the first named node of the given type. */
function findNode(node: any, type: string): any {
  if (node.type === type) return node;
  for (const c of node.namedChildren) {
    const hit = findNode(c, type);
    if (hit) return hit;
  }
  return null;
}

/** Parse a snippet and return its first node of the given type, asserting it exists. */
function parseAndFind(src: string, type: string): any {
  const { tree } = parseSource(src);
  const node = findNode(tree.rootNode, type);
  assert.ok(node, `expected a ${type} node in:\n${src}`);
  return node;
}

/** Run the real collectFieldMatches over the first schema_body of a snippet. */
function matchesFor(src: string, tag: string): any[] {
  const body = parseAndFind(src, "schema_body");
  const acc: any[] = [];
  collectFieldMatches(body, "schema", "s", "s.stm", tag, acc);
  return acc;
}

// ── findTagInMeta ─────────────────────────────────────────────────────────────

describe("findTagInMeta", () => {
  it("matches a bare tag token and returns its source text", () => {
    const meta = parseAndFind("schema s {\n  email TEXT (pii)\n}\n", "metadata_block");
    assert.equal(findTagInMeta(meta, "pii"), "pii");
  });

  it("matches case-insensitively but preserves the source casing in the result", () => {
    const meta = parseAndFind("schema s {\n  email TEXT (PII)\n}\n", "metadata_block");
    assert.equal(findTagInMeta(meta, "pii"), "PII");
  });

  it("matches a key-value pair by its key", () => {
    const meta = parseAndFind('schema s {\n  email TEXT (format "email")\n}\n', "metadata_block");
    assert.equal(findTagInMeta(meta, "format"), "format");
  });

  it("returns null when no tag in the block matches", () => {
    const meta = parseAndFind("schema s {\n  id INT (required)\n}\n", "metadata_block");
    assert.equal(findTagInMeta(meta, "pii"), null);
  });

  it("matches individual enum values inside an enum body", () => {
    const meta = parseAndFind("schema s {\n  kind TEXT (enum {home, work})\n}\n", "metadata_block");
    assert.equal(findTagInMeta(meta, "work"), "work");
  });

  it("matches the enum construct itself via --tag enum", () => {
    const meta = parseAndFind("schema s {\n  kind TEXT (enum {home, work})\n}\n", "metadata_block");
    assert.equal(findTagInMeta(meta, "enum"), "enum");
  });

  it("matches a note tag via --tag note", () => {
    const meta = parseAndFind('schema s {\n  id INT (note "primary id")\n}\n', "metadata_block");
    assert.equal(findTagInMeta(meta, "note"), "note");
  });
});

// ── collectFieldMatches ───────────────────────────────────────────────────────

describe("collectFieldMatches", () => {
  it("collects a tagged field with its name, type, and 1-indexed line", () => {
    const matches = matchesFor("schema s {\n  email VARCHAR(255) (pii)\n}\n", "pii");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].field, "email");
    assert.equal(matches[0].fieldType, "VARCHAR(255)");
    assert.equal(matches[0].line, 2);
  });

  it("ignores fields whose metadata does not contain the tag", () => {
    const matches = matchesFor("schema s {\n  id INT (pk)\n  email TEXT (pii)\n}\n", "pii");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].field, "email");
  });

  it("descends into nested record fields, reporting a dotted block path", () => {
    const src = "schema s {\n  contact record {\n    email TEXT (pii)\n  }\n}\n";
    const matches = matchesFor(src, "pii");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].block, "s.contact");
    assert.equal(matches[0].field, "email");
  });

  it("strips backtick delimiters from quoted field names", () => {
    const matches = matchesFor("schema s {\n  `First Name` TEXT (pii)\n}\n", "pii");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].field, "First Name");
  });

  it("reports list_of fields with their list_of element type", () => {
    const src = "schema s {\n  phones list_of record {\n    number TEXT (pii)\n  }\n}\n";
    const body = parseAndFind(src, "schema_body");
    const acc: any[] = [];
    collectFieldMatches(body, "schema", "s", "s.stm", "pii", acc);
    // The tagged field lives inside the list element record
    assert.equal(acc.length, 1);
    assert.equal(acc[0].block, "s.phones");
    assert.equal(acc[0].field, "number");
  });

  it("includes all of a field's tags in the metadata array", () => {
    const matches = matchesFor("schema s {\n  email TEXT (pii, required)\n}\n", "pii");
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].metadata, ["pii", "required"]);
  });
});

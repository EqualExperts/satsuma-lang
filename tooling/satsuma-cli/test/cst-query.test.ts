/**
 * cst-query.test.ts — Unit tests for namespace-aware CST block lookup
 *
 * Tests findBlockNode, which resolves qualified names (ns::name),
 * anonymous block keys (<anon>@file:row), and unqualified names
 * against a CST tree that may contain namespace_block containers.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Test setup: load real parser for CST-level tests ────────────────────────

let findBlockNode: (root: any, nodeType: string, name: string) => any;
let parseFile: (filePath: string) => any;

before(async () => {
  const parser = await import("#src/parser.js");
  parseFile = parser.parseFile;
  const cstQuery = await import("#src/cst-query.js");
  findBlockNode = cstQuery.findBlockNode;
});

// ── findBlockNode: qualified name resolution ────────────────────────────────

describe("findBlockNode", () => {
  it("finds a top-level schema by bare name", () => {
    const { tree } = parseFile(resolve(__dirname, "../../../examples/db-to-db/pipeline.stm"));
    const node = findBlockNode(tree.rootNode, "schema_block", "legacy_sqlserver");
    assert.ok(node, "should find legacy_sqlserver schema");
    assert.equal(node.type, "schema_block");
  });

  it("returns null for a non-existent schema", () => {
    const { tree } = parseFile(resolve(__dirname, "../../../examples/db-to-db/pipeline.stm"));
    const node = findBlockNode(tree.rootNode, "schema_block", "no_such_schema");
    assert.equal(node, null);
  });

  it("finds a namespace-qualified schema (ns::name)", () => {
    // namespace-collision.stm has namespace alpha { schema customer ... }
    const { tree } = parseFile(resolve(__dirname, "fixtures/namespace-collision.stm"));
    const node = findBlockNode(tree.rootNode, "schema_block", "alpha::customer");
    assert.ok(node, "should find alpha::customer in namespace block");
    assert.equal(node.type, "schema_block");
  });

  it("skips non-matching namespace blocks", () => {
    const { tree } = parseFile(resolve(__dirname, "fixtures/namespace-collision.stm"));
    // Looking for "nonexistent::customer" should fail
    const node = findBlockNode(tree.rootNode, "schema_block", "nonexistent::customer");
    assert.equal(node, null, "should not find customer in wrong namespace");
  });

  it("ignores global schemas when namespace is required", () => {
    const { tree } = parseFile(resolve(__dirname, "../../../examples/db-to-db/pipeline.stm"));
    // db-to-db has global schemas; looking for ns::schema should fail
    const node = findBlockNode(tree.rootNode, "schema_block", "fake::legacy_sqlserver");
    assert.equal(node, null, "should not find global schema when namespace specified");
  });

  it("finds a mapping block by name", () => {
    const { tree } = parseFile(resolve(__dirname, "../../../examples/db-to-db/pipeline.stm"));
    const node = findBlockNode(tree.rootNode, "mapping_block", "customer migration");
    assert.ok(node, "should find customer migration mapping");
    assert.equal(node.type, "mapping_block");
  });
});

// ── findBlockNode: anonymous block keys ─────────────────────────────────────

describe("findBlockNode: anonymous blocks", () => {
  it("finds a block by <anon>@file:row key", () => {
    const { tree } = parseFile(resolve(__dirname, "../../../examples/db-to-db/pipeline.stm"));
    // Use the actual row of the first schema_block
    const firstSchema = tree.rootNode.namedChildren.find((c: any) => c.type === "schema_block");
    assert.ok(firstSchema, "should have at least one schema block");
    const key = `<anon>@test:${firstSchema.startPosition.row}`;
    const node = findBlockNode(tree.rootNode, "schema_block", key);
    assert.ok(node, "should find block by anonymous row key");
    assert.equal(node.startPosition.row, firstSchema.startPosition.row);
  });

  it("returns null for non-matching row", () => {
    const { tree } = parseFile(resolve(__dirname, "../../../examples/db-to-db/pipeline.stm"));
    const node = findBlockNode(tree.rootNode, "schema_block", "<anon>@test:99999");
    assert.equal(node, null, "should not find block at non-existent row");
  });
});

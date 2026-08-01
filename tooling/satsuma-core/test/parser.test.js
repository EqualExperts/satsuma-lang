/**
 * parser.test.js — Authoritative tests for the WASM parser singleton.
 *
 * These tests exercise the lifecycle contract of initParser/getParser/getLanguage
 * as defined in @satsuma/core/parser.  Any overlapping tests in satsuma-cli or
 * vscode-satsuma/server that were testing the same init logic are retired in
 * favour of these.
 *
 * The WASM file path is resolved relative to this test file so that the tests
 * run correctly without any build step for the grammar (the .wasm is a committed
 * artifact in tree-sitter-satsuma/).
 *
 * Structure: two describe blocks in sequence.
 *   1. "pre-init" — tests that run before initParser(), where getParser() must throw.
 *   2. "post-init" — tests that run after initParser() resolves via a before() hook.
 * This ordering matters because before() runs before ALL tests in a describe block,
 * so "throws before init" cases must live in a separate block without a before().
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser, getParser, getLanguage } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the grammar WASM — committed artifact, no build needed for tests.
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

// ── Pre-init: guards must throw before the singleton is populated ────────────

describe("parser singleton — pre-init", () => {
  it("getParser() throws before initParser() is called", () => {
    // Guards the contract that callers must explicitly initialise before parsing.
    // Without this check, callers would get a null-dereference instead of a
    // clear actionable error.
    assert.throws(() => getParser(), /not initialised/);
  });

  it("getLanguage() throws before initParser() is called", () => {
    // Same contract for getLanguage() — used by semantic-tokens query construction.
    assert.throws(() => getLanguage(), /not loaded/);
  });
});

// ── Post-init: lifecycle and parsing behaviour after a successful init ────────

describe("parser singleton — post-init", () => {
  before(async () => {
    await initParser(WASM_PATH);
  });

  it("getParser() returns a Parser after initParser() resolves", () => {
    // Verifies that the singleton is populated after a successful init.
    const parser = getParser();
    assert.ok(parser, "parser should be non-null");
    assert.equal(typeof parser.parse, "function", "parser must have a parse() method");
  });

  it("getLanguage() returns a Language after initParser() resolves", () => {
    // Verifies that the language instance is available for Query construction.
    const lang = getLanguage();
    assert.ok(lang, "language should be non-null");
  });

  it("re-calling initParser() is a no-op — same parser instance is returned", async () => {
    // Re-init must be idempotent because CLI commands call initParser() once per
    // process and there is no coordination between callers.
    const parserBefore = getParser();
    await initParser(WASM_PATH);
    const parserAfter = getParser();
    assert.equal(parserBefore, parserAfter, "parser instance must not change on re-init");
  });

  it("parser can parse valid Satsuma source after init", () => {
    // Smoke-checks that the loaded grammar actually understands Satsuma syntax.
    // If the wrong WASM were loaded, this parse would produce only ERROR nodes.
    const parser = getParser();
    const tree = parser.parse("schema Customers {}");
    assert.ok(tree, "parse must return a tree");
    assert.equal(tree.rootNode.type, "source_file", "root node must be source_file");
    assert.equal(tree.rootNode.hasError, false, "valid source must parse without errors");
  });

  it("rejects v1 bracket array paths ('items[].id') as a parse error", () => {
    // sl-8o1n: v2 removed [] from field paths — iteration is expressed via
    // each/flatten (grammar.js, 'iteration is expressed via each/flatten').
    // coverage-paths.ts deleted its [] normalisation on the strength of this
    // guarantee, so if brackets were ever re-admitted to the grammar this test
    // failing is the signal that path normalisation needs revisiting.
    const parser = getParser();
    const tree = parser.parse("mapping load {\n  source { src }\n  target { tgt }\n  items[].id -> sku\n}\n");
    assert.equal(tree.rootNode.hasError, true, "bracket paths must not parse in v2");
  });
});

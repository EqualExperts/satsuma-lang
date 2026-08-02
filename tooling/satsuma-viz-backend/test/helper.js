/**
 * Shared test helper — initialises the WASM parser once and exports a parse()
 * function for use across all LSP server tests.
 *
 * Uses satsuma-core's parser singleton so that trees, languages, and queries
 * all share the same WASM module instance. This avoids cross-module memory
 * errors when tsc-compiled dist/ code (which delegates to satsuma-core) operates
 * on trees created by a different web-tree-sitter instance.
 */
const path = require("path");
const { initParser, getParser, getLanguage } = require("@satsuma/core");

const WASM_PATH = path.resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

/** Initialise the WASM parser.  Must be awaited once before parse() is called. */
async function initTestParser() {
  await initParser(WASM_PATH);
}

/** Parse Satsuma source.  Call initTestParser() first. */
function parse(source) {
  return getParser().parse(source);
}

module.exports = { initTestParser, parse, getLanguage };

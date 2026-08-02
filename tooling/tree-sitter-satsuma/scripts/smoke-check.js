#!/usr/bin/env node
/**
 * smoke-check.js — Satsuma v2 parser smoke test
 *
 * Usage:
 *   node scripts/smoke-check.js <file.stm>
 *   node scripts/smoke-check.js examples/
 *
 * Parses one or more .stm files with the tree-sitter-satsuma v2 grammar and emits
 * a JSON summary of the constructs found. Exits with code 1 if any parse errors
 * are encountered.
 *
 * Requires: tree-sitter and tree-sitter-satsuma bindings to be built first.
 *   cd tooling/tree-sitter-satsuma
 *   npm run build
 */

"use strict";

const Parser = require("tree-sitter");
const STM = require("../"); // tree-sitter-satsuma binding (built from grammar.js)
const fs = require("fs");
const path = require("path");

// ── Initialise parser ─────────────────────────────────────────────────────────
const parser = new Parser();
parser.setLanguage(STM);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return all descendant nodes of the given type(s). */
function collectNodes(node, ...types) {
  const results = [];
  function walk(n) {
    if (types.includes(n.type)) results.push(n);
    for (const child of n.namedChildren) walk(child);
  }
  walk(node);
  return results;
}

/** Slice the raw source text for a node. */
function text(node, src) {
  return src.slice(node.startIndex, node.endIndex);
}

/** Extract the display text of a block_label child on a block node. */
function blockLabel(blockNode, src) {
  const label = blockNode.namedChildren.find((n) => n.type === "block_label");
  if (!label) return null;
  const inner = label.namedChildren[0];
  if (!inner) return null;
  const raw = text(inner, src);
  if (inner.type === "quoted_name") return raw.slice(1, -1); // strip ' '
  return raw;
}

/**
 * Return true if a schema_block is a metric schema (has the bare `metric` tag_token
 * in its metadata_block). In v2, metrics are schema blocks, not a separate block type.
 */
function isMetricSchema(schemaNode) {
  const meta = schemaNode.namedChildren.find((n) => n.type === "metadata_block");
  if (!meta) return false;
  return meta.namedChildren.some(
    (n) =>
      n.type === "tag_token" && n.namedChildren[0]?.type === "identifier" && n.text === "metric",
  );
}

/** Return the metric display name from the metric_name tag, if present. */
function metricDisplayName(metricNode, src) {
  const meta = metricNode.namedChildren.find((n) => n.type === "metadata_block");
  if (!meta) return null;
  const nameEntry = meta.namedChildren.find(
    (n) => n.type === "tag_with_value" && n.namedChildren[0]?.text === "metric_name",
  );
  if (!nameEntry) return null;
  const val = nameEntry.namedChildren[1];
  const strNode = val?.namedChildren.find((n) => n.type === "nl_string");
  return strNode ? text(strNode, src).slice(1, -1) : null;
}

/** Count ERROR nodes recursively. */
function countErrors(node) {
  let count = node.type === "ERROR" ? 1 : 0;
  for (const child of node.namedChildren) count += countErrors(child);
  return count;
}

// ── Parse a single file ───────────────────────────────────────────────────────

function parseFile(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const tree = parser.parse(src);
  const root = tree.rootNode;
  const errors = countErrors(root);

  const summary = {
    file: path.resolve(filePath),
    errors,
    schemas: collectNodes(root, "schema_block").map((n) => ({
      name: blockLabel(n, src),
    })),
    fragments: collectNodes(root, "fragment_block").map((n) => ({
      name: blockLabel(n, src),
    })),
    transforms: collectNodes(root, "transform_block").map((n) => ({
      name: blockLabel(n, src),
    })),
    mappings: collectNodes(root, "mapping_block").map((n) => ({
      name: blockLabel(n, src),
    })),
    // In v2, metrics are schema_block nodes with the bare `metric` tag in metadata.
    metrics: collectNodes(root, "schema_block")
      .filter(isMetricSchema)
      .map((n) => ({
        name: blockLabel(n, src),
        display: metricDisplayName(n, src),
      })),
    warnings: collectNodes(root, "warning_comment").map((n) => text(n, src).slice(3).trim()),
    questions: collectNodes(root, "question_comment").map((n) => text(n, src).slice(3).trim()),
  };

  return { summary, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/smoke-check.js <file.stm | directory> [...]");
  process.exit(1);
}

// Collect all .stm files from arguments (file or directory)
const files = [];
for (const arg of args) {
  const stat = fs.statSync(arg);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(arg, { recursive: true })) {
      if (entry.endsWith(".stm")) files.push(path.join(arg, entry));
    }
  } else {
    files.push(arg);
  }
}

let totalErrors = 0;
const results = [];

for (const file of files) {
  try {
    const { summary, errors } = parseFile(file);
    results.push(summary);
    totalErrors += errors;
    if (errors > 0) {
      process.stderr.write(`[FAIL] ${file}: ${errors} parse error(s)\n`);
    } else {
      process.stderr.write(`[ OK ] ${file}\n`);
    }
  } catch (err) {
    process.stderr.write(`[ERR ] ${file}: ${err.message}\n`);
    totalErrors += 1;
  }
}

// Emit JSON summary to stdout (suitable for piping to jq)
if (results.length === 1) {
  console.log(JSON.stringify(results[0], null, 2));
} else {
  console.log(JSON.stringify(results, null, 2));
}

if (totalErrors > 0) {
  process.stderr.write(`\n${totalErrors} total parse error(s) across ${files.length} file(s)\n`);
  process.exit(1);
}

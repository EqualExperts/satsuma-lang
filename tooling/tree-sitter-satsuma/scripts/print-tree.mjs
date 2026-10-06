#!/usr/bin/env node
/**
 * print-tree.mjs — print a Satsuma file's parse tree in the tree-sitter CLI's
 * `parse` format, using the grammar the workspace build already produced.
 *
 * The Python fixture and CST-summary tests read the CLI's text dump. They used
 * to get it from `tree-sitter parse --wasm -p .`, and `-p` implies `--rebuild`:
 * every call recompiled the grammar from C with clang (wasi-sdk), dozens of
 * times per test run, and downloaded wasi-sdk into a private cache when it was
 * missing. This script loads the built `tree-sitter-satsuma.wasm` through
 * web-tree-sitter instead — the same runtime the CLI, LSP and viz use — so the
 * tests need no C toolchain and compile nothing.
 *
 * It owns only the dump format. It does not build the grammar: the `.wasm`
 * must already exist (`npm run build` in this package, or the workspace
 * build), and if the grammar has changed since, it must be rebuilt first.
 *
 * Usage: node scripts/print-tree.mjs <file.stm>
 * Exit codes mirror the CLI's: 0 for a clean tree, 1 when it contains ERROR or
 * MISSING nodes (the tree is still printed), 2 when nothing could be parsed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GRAMMAR_WASM = resolve(PACKAGE_ROOT, "tree-sitter-satsuma.wasm");

/** Exit codes, matching `tree-sitter parse` so callers can treat them alike. */
const EXIT_CLEAN = 0;
const EXIT_TREE_HAS_ERRORS = 1;
const EXIT_UNUSABLE = 2;

/** The CLI indents each level of the tree by two spaces. */
const INDENT = "  ";

/** `[row, column]`, the CLI's notation for a position. */
function point({ row, column }) {
  return `[${row}, ${column}]`;
}

/**
 * The opening of one node's line: `field: (type [r, c] - [r, c]`. A missing
 * node is written `(MISSING type …` and, when anonymous, with its token quoted
 * (`(MISSING "}" …`), exactly as the CLI writes it.
 */
function nodeHeader(node, fieldName) {
  const field = fieldName ? `${fieldName}: ` : "";
  const type = node.isNamed ? node.type : JSON.stringify(node.type);
  const label = node.isMissing ? `MISSING ${type}` : type;
  return `${field}(${label} ${point(node.startPosition)} - ${point(node.endPosition)}`;
}

/**
 * Render the tree the way the CLI does: only named nodes and missing nodes are
 * printed, each on its own line, with its children indented beneath it and
 * its closing parenthesis after the last of them.
 */
function renderTree(rootNode) {
  const out = [];
  const visit = (node, fieldName, depth) => {
    out.push(`${depth === 0 ? "" : "\n"}${INDENT.repeat(depth)}${nodeHeader(node, fieldName)}`);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && (child.isNamed || child.isMissing)) {
        visit(child, node.fieldNameForChild(i), depth + 1);
      }
    }
    out.push(")");
  };
  visit(rootNode, null, 0);
  return `${out.join("")}\n`;
}

async function main(argv) {
  const [sourcePath] = argv;
  if (!sourcePath) {
    process.stderr.write("usage: node scripts/print-tree.mjs <file.stm>\n");
    return EXIT_UNUSABLE;
  }
  if (!existsSync(GRAMMAR_WASM)) {
    process.stderr.write(
      `grammar not built: ${GRAMMAR_WASM} is missing — run \`npm run build\` in tooling/tree-sitter-satsuma\n`,
    );
    return EXIT_UNUSABLE;
  }

  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(GRAMMAR_WASM));
  const tree = parser.parse(readFileSync(sourcePath, "utf8"));
  if (!tree) {
    process.stderr.write(`tree-sitter produced no tree for ${sourcePath}\n`);
    return EXIT_UNUSABLE;
  }

  process.stdout.write(renderTree(tree.rootNode));
  return tree.rootNode.hasError ? EXIT_TREE_HAS_ERRORS : EXIT_CLEAN;
}

process.exitCode = await main(process.argv.slice(2));

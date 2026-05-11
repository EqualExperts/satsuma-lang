/**
 * parser.ts — tree-sitter Satsuma v2 parser wrapper (WASM)
 *
 * The singleton parser lifecycle (initParser / getParser / getLanguage) lives
 * in @satsuma/core/parser and is re-exported from here so existing CLI callers
 * need not change their import paths.
 *
 * This module adds the CLI-specific file-I/O helpers (parseFile, parseSource)
 * that have no place in the shared core.
 */

export { initParser, getParser, getLanguage } from "@satsuma/core";
import { getParser } from "@satsuma/core";
import { readFileSync } from "fs";
import type { ParsedFile, SyntaxNode, Tree } from "./types.js";

// ── CLI file-I/O helpers ────────────────────────────────────────────────────

/**
 * Parse a single .stm file.
 * Reads the file synchronously and returns a ParsedFile with the source,
 * tree, and ERROR node count for quick validity checks.
 */
export function parseFile(filePath: string): ParsedFile {
  const src = readFileSync(filePath, "utf8");
  const parser = getParser();
  const tree = parser.parse(src);
  if (!tree) throw new Error(`parse returned null for ${filePath}`);
  const errorCount = countErrors(tree.rootNode);
  return { filePath, src, tree, errorCount };
}

/**
 * Parse source text directly (useful for testing without file I/O).
 */
export function parseSource(src: string): { src: string; tree: Tree; errorCount: number } {
  const parser = getParser();
  const tree = parser.parse(src);
  if (!tree) throw new Error("parse returned null");
  const errorCount = countErrors(tree.rootNode);
  return { src, tree, errorCount };
}

/**
 * Count parse-error nodes recursively in a tree.
 * Counts both ERROR nodes (unexpected tokens) and MISSING nodes (expected
 * tokens the parser could not find), matching the two error signals that
 * tree-sitter produces.  See @satsuma/core parse-errors.ts for details.
 */
function countErrors(node: SyntaxNode): number {
  let n = (node.type === "ERROR" || node.isMissing) ? 1 : 0;
  for (const child of node.namedChildren) n += countErrors(child);
  return n;
}

/**
 * cst-utils.ts — CST navigation helpers for Satsuma tree-sitter nodes
 *
 * Pure utility functions with no side effects. Both the CLI and LSP server
 * consume these; neither consumer should maintain its own copies.
 */

import type { SyntaxNode } from "./types.js";

/**
 * True when a node is real input text rather than a tree-sitter recovery
 * artifact. Error recovery can insert zero-width MISSING nodes (e.g.
 * `import { } from "x"` yields an import_name containing a MISSING
 * identifier whose .text is ""). Extraction helpers must check this before
 * trusting .text, or downstream tooling reports empty-string names (sl-0nvt).
 */
export function isPresent(node: SyntaxNode | null | undefined): node is SyntaxNode {
  return node != null && !node.isMissing && node.text.length > 0;
}

/**
 * First named child of the given type, or null.
 * Filters out null entries for compatibility with web-tree-sitter's nullable array.
 */
export function child(node: SyntaxNode, type: string): SyntaxNode | null {
  return node.namedChildren.find((c) => c !== null && c.type === type) ?? null;
}

/**
 * All named children of the given type.
 * Filters out null entries for compatibility with web-tree-sitter's nullable array.
 */
export function children(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.namedChildren.filter((c): c is SyntaxNode => c !== null && c.type === type);
}

/**
 * Collect all descendants of a given type (depth-first).
 */
export function allDescendants(node: SyntaxNode, type: string, acc: SyntaxNode[] = []): SyntaxNode[] {
  for (const c of node.namedChildren) {
    if (c !== null) {
      if (c.type === type) acc.push(c);
      allDescendants(c, type, acc);
    }
  }
  return acc;
}

/**
 * Extract text from a block_label child of `node`.
 * block_label → identifier | backtick_name
 */
export function labelText(node: SyntaxNode): string | null {
  const lbl = child(node, "block_label");
  if (!lbl) return null;
  const inner = lbl.namedChildren[0];
  if (!inner) return null;
  if (inner.type === "backtick_name") return inner.text.slice(1, -1);
  return inner.text; // identifier
}

/**
 * Strip outer delimiters from a string node and unescape contents.
 *
 * - nl_string ("..."):      strip quotes, then unescape \" → " and \\ → \
 * - multiline_string ("""..."""): strip triple-quotes and trim (raw syntax, no escapes)
 * - other node types:       return raw text unchanged
 */
export function stringText(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "multiline_string") return node.text.slice(3, -3).trim();
  if (node.type === "nl_string") {
    return node.text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return node.text;
}

/**
 * Extract the text from a source/target entry node.
 * Handles backtick_name, nl_string, and plain identifier.
 */
export function entryText(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "backtick_name") return node.text.slice(1, -1);
  if (node.type === "nl_string") return node.text.slice(1, -1);
  return node.text; // identifier
}

/**
 * Extract the namespace::name text from a qualified_name CST node.
 * Returns null if the node is missing or has fewer than two identifier children.
 *
 * A qualified_name node in the Satsuma grammar has the form:
 *   identifier "::" identifier
 * e.g. `crm::customers` → "crm::customers".
 */
export function qualifiedNameText(node: SyntaxNode | null | undefined): string | null {
  if (!node || node.type !== "qualified_name") return null;
  const ids = node.namedChildren.filter((c) => c.type === "identifier" && isPresent(c));
  if (ids.length < 2 || !ids[0] || !ids[1]) return null;
  return `${ids[0].text}::${ids[1].text}`;
}

/**
 * Extract the text from a source_ref CST node, handling all child variants:
 * qualified_name (ns::name), backtick_name, identifier, and nl_string.
 *
 * Returns null for empty or unrecognized source_ref content.
 */
export function sourceRefText(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  const qn = child(node, "qualified_name");
  if (isPresent(qn)) return qualifiedNameText(qn) ?? qn.text;
  const bn = child(node, "backtick_name");
  if (isPresent(bn)) return bn.text.slice(1, -1);
  const id = child(node, "identifier");
  if (isPresent(id)) return id.text;
  const ns = child(node, "nl_string");
  if (isPresent(ns)) return ns.text.slice(1, -1);
  return null;
}

/**
 * Extract the structural schema/fragment name from a source_ref CST node.
 *
 * Unlike sourceRefText(), this deliberately ignores nl_string children because
 * quoted text inside `source {}` is natural-language join/filter documentation,
 * not a structural schema reference.
 */
export function sourceRefStructuralText(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  const qn = child(node, "qualified_name");
  if (isPresent(qn)) return qualifiedNameText(qn) ?? qn.text;
  const bn = child(node, "backtick_name");
  if (isPresent(bn)) return bn.text.slice(1, -1);
  const id = child(node, "identifier");
  if (isPresent(id)) return id.text;
  return null;
}

/**
 * Extract the display name from a field_name CST node.
 * Strips backtick delimiters when the inner node is a backtick_name.
 */
export function fieldNameText(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  const inner = node.namedChildren[0];
  if (!inner) return node.text;
  if (inner.type === "backtick_name") return inner.text.slice(1, -1);
  return inner.text;
}

/**
 * Walk all named descendants of a node depth-first, calling `fn` on each.
 * This is the generic callback-based traversal — use `allDescendants` when
 * you only need nodes of a specific type.
 */
export function walkDescendants(node: SyntaxNode, fn: (n: SyntaxNode) => void): void {
  for (const ch of node.namedChildren) {
    if (ch !== null) {
      fn(ch);
      walkDescendants(ch, fn);
    }
  }
}

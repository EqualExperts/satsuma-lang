/**
 * cst-utils.ts — CST navigation helpers for Satsuma tree-sitter nodes
 *
 * Pure utility functions with no side effects. Both the CLI and LSP server
 * consume these; neither consumer should maintain its own copies.
 *
 * `SyntaxNode.namedChildren` (types.ts) is typed as non-nullable, but the
 * child/children/allDescendants/walkDescendants walkers below still filter
 * out `null` entries defensively. That is not dead code: test/cst-utils.test.js
 * constructs mock nodes with real `null` holes in `namedChildren` and asserts
 * these walkers skip them rather than throw, so a caller building a CST from a
 * source other than the audited web-tree-sitter adapter (parser.ts) can still
 * rely on this module's own null-safety instead of the type's promise.
 */

import type { SatsumaGrammarSymbol } from "./generated/cst-types.js";
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
 * Filters out null entries — see the module header for why this matters
 * despite `namedChildren`'s non-nullable type.
 */
export function child(node: SyntaxNode, type: SatsumaGrammarSymbol): SyntaxNode | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see module header
  return node.namedChildren.find((c) => c !== null && c.type === type) ?? null;
}

/**
 * All named children of the given type.
 * Filters out null entries — see the module header for why this matters
 * despite `namedChildren`'s non-nullable type.
 */
export function children(node: SyntaxNode, type: SatsumaGrammarSymbol): SyntaxNode[] {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see module header
  return node.namedChildren.filter((c): c is SyntaxNode => c !== null && c.type === type);
}

/**
 * Collect all descendants of a given type (depth-first).
 * Filters out null entries — see the module header for why this matters
 * despite `namedChildren`'s non-nullable type.
 */
export function allDescendants(
  node: SyntaxNode,
  type: SatsumaGrammarSymbol,
  acc: SyntaxNode[] = [],
): SyntaxNode[] {
  for (const c of node.namedChildren) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see module header
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
 * Text of one name segment (`identifier` or `backtick_name`), with a
 * `backtick_name`'s delimiters removed.
 *
 * Shared by arrow paths (arrow-path.ts) and namespace-qualified names below,
 * and uses the same `slice(1, -1)` unquoting as field declarations
 * (`fieldNameText`), so a reference and the declaration it names agree on
 * what the name is.
 */
export function pathSegmentText(seg: SyntaxNode): string {
  return seg.type === "backtick_name" ? seg.text.slice(1, -1) : seg.text;
}

/**
 * Extract the canonical `ns::name` text from a qualified_name CST node, or
 * null when the node is missing or error recovery left either side absent.
 *
 * The grammar's qualified_name is `identifier "::" (identifier | backtick_name)`:
 * a namespace name is always a bare identifier, while the name after `::` may
 * be backtick-quoted (bsw-iuzs). The quoted form is unquoted here, so
 * `` raw::`crm-contacts` `` and `raw::crm_contacts` both come back as plain
 * `ns::name` text that matches the declared schema's key.
 */
export function qualifiedNameText(node: SyntaxNode | null | undefined): string | null {
  if (!node || node.type !== "qualified_name") return null;
  const parts = node.namedChildren.filter(
    (c) => (c.type === "identifier" || c.type === "backtick_name") && isPresent(c),
  );
  const [ns, name] = parts;
  if (parts.length < 2 || !ns || !name || ns.type !== "identifier") return null;
  return `${ns.text}::${pathSegmentText(name)}`;
}

/**
 * Extract the imported name from an import_name CST node: `ns::name`,
 * a backtick name or a bare identifier, unquoted. Returns null when error
 * recovery left the entry empty, so `import { } from "x"` yields no names
 * rather than [""] (sl-0nvt).
 */
export function importNameText(node: SyntaxNode | null | undefined): string | null {
  if (!node) return null;
  const qn = child(node, "qualified_name");
  if (isPresent(qn)) return qualifiedNameText(qn);
  const q = child(node, "backtick_name");
  if (isPresent(q)) return q.text.slice(1, -1);
  const id = child(node, "identifier");
  return isPresent(id) ? id.text : null;
}

/** One schema a metric's `source` tag names, with the CST node that names it. */
export interface MetricSourceRef {
  /** The qualified_name, backtick_name or identifier node naming the source;
   *  consumers that need a position (the LSP's reference index) use its range. */
  node: SyntaxNode;
  /** The source's name, unquoted: `` raw::`crm-contacts` `` → `raw::crm-contacts`. */
  name: string;
}

/**
 * Read the schemas a metric's `source` tag names from the tag's value node.
 *
 * The grammar wraps every tag value in value_text, whether it is a single
 * name (`source orders`) or a braced list (`source { raw::`crm-contacts`,
 * other }`); each named child is one source. A qualified name or backtick
 * name comes back unquoted (bsw-iuzs), so the name matches how the schema is
 * keyed. Core's metric extraction, the VizModel builder and the LSP index all
 * read sources through this one function, so the CLI, the viz and the editor
 * agree on what a metric draws from. Children that name nothing (recovered
 * qualified names, stray tokens) are skipped.
 */
export function metricSourceRefs(value: SyntaxNode | null | undefined): MetricSourceRef[] {
  if (!value) return [];
  const items = value.type === "value_text" ? value.namedChildren : [value];
  const refs: MetricSourceRef[] = [];
  for (const node of items) {
    if (!isPresent(node)) continue;
    let name: string | null = null;
    if (node.type === "qualified_name") name = qualifiedNameText(node);
    else if (node.type === "identifier" || node.type === "backtick_name")
      name = pathSegmentText(node);
    if (name) refs.push({ node, name });
  }
  return refs;
}

/**
 * Extract the fragment or schema name a spread (`...name`) refers to from its
 * spread_label CST node.
 *
 * A spread_label is one of: a qualified_name (`...ns::name`, whose name side
 * may be backtick-quoted), a backtick_name, or an unquoted run of words
 * (`...address fields`: identifier + continuation_word children, sl-3ccy),
 * which is joined with single spaces. Quoted names come back unquoted. A
 * recovered qualified_name with a side missing falls back to its raw text.
 */
export function spreadLabelText(node: SyntaxNode): string {
  const qn = child(node, "qualified_name");
  if (qn) return qualifiedNameText(qn) ?? qn.text;
  const q = child(node, "backtick_name");
  if (q) return q.text.slice(1, -1);
  return node.namedChildren
    .filter((c) => c.type === "identifier" || c.type === "continuation_word")
    .map((c) => c.text)
    .join(" ");
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see module header
    if (ch !== null) {
      fn(ch);
      walkDescendants(ch, fn);
    }
  }
}

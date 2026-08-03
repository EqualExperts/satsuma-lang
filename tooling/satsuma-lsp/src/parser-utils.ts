/**
 * parser-utils.ts — LSP-specific parser helpers and CST navigation wrappers.
 *
 * The parser singleton (initParser / getParser / getLanguage) lives in
 * @satsuma/core and is re-exported here so existing server.ts callers need not
 * change their import paths.
 *
 * LSP callers pass a locateFile option to initParser() so that esbuild's CJS
 * bundle can find the web-tree-sitter runtime WASM (tree-sitter.wasm) next to
 * the bundled server.js, rather than at the module-relative default path.
 *
 * This module also wraps cst-utils functions from @satsuma/core to preserve
 * the concrete Node type used by other LSP server code.
 */

import { Range, Position } from "vscode-languageserver";
import type {
  ParsedSatsumaTree,
  SatsumaGrammarSymbol,
  SyntaxNode as CoreSyntaxNode,
} from "@satsuma/core";
import type { Parser, Language, Node, Point, Query, QueryCapture } from "web-tree-sitter";

type RecursiveCoreMember = "children" | "namedChildren" | "child" | "childForFieldName" | "parent";
type CoreNodeScalars = Omit<CoreSyntaxNode, RecursiveCoreMember>;
type WebNavigationMember =
  | RecursiveCoreMember
  | "tree"
  | "namedChild"
  | "childForFieldId"
  | "childrenForFieldName"
  | "childrenForFieldId"
  | "firstChildForIndex"
  | "firstNamedChildForIndex"
  | "firstChild"
  | "firstNamedChild"
  | "lastChild"
  | "lastNamedChild"
  | "nextSibling"
  | "previousSibling"
  | "nextNamedSibling"
  | "previousNamedSibling"
  | "descendantForIndex"
  | "namedDescendantForIndex"
  | "descendantForPosition"
  | "namedDescendantForPosition"
  | "descendantsOfType";

/**
 * Concrete web-tree-sitter node whose recursive navigation retains the same
 * generated-symbol-typed contract at every child, parent, and descendant.
 */
export type SyntaxNode = Omit<Node, keyof CoreSyntaxNode | WebNavigationMember> &
  CoreNodeScalars & {
    /** Parse tree that owns this node. */
    tree: Tree;
    /** All concrete children, including anonymous punctuation nodes. */
    children: SyntaxNode[];
    /** All concrete named children. */
    namedChildren: SyntaxNode[];
    /** Concrete child at a zero-based index. */
    child(index: number): SyntaxNode;
    /** Concrete named child at a zero-based index. */
    namedChild(index: number): SyntaxNode;
    /** Concrete child assigned to the numeric grammar field, when present. */
    childForFieldId(fieldId: number): SyntaxNode;
    /** Concrete child assigned to the named grammar field, when present. */
    childForFieldName(fieldName: string): SyntaxNode;
    /** All concrete children assigned to the named grammar field. */
    childrenForFieldName(fieldName: string): SyntaxNode[];
    /** All concrete children assigned to the numeric grammar field. */
    childrenForFieldId(fieldId: number): SyntaxNode[];
    /** First concrete child whose byte range starts at or after the index. */
    firstChildForIndex(index: number): SyntaxNode;
    /** First concrete named child whose byte range starts at or after the index. */
    firstNamedChildForIndex(index: number): SyntaxNode;
    /** First concrete child. */
    firstChild: SyntaxNode;
    /** First concrete named child. */
    firstNamedChild: SyntaxNode;
    /** Last concrete child. */
    lastChild: SyntaxNode;
    /** Last concrete named child. */
    lastNamedChild: SyntaxNode;
    /** Following concrete sibling, or null at the end of the sibling list. */
    nextSibling: SyntaxNode | null;
    /** Preceding concrete sibling, or null at the start of the sibling list. */
    previousSibling: SyntaxNode | null;
    /** Following concrete named sibling, or null when none remains. */
    nextNamedSibling: SyntaxNode | null;
    /** Preceding concrete named sibling, or null when none remains. */
    previousNamedSibling: SyntaxNode | null;
    /** Concrete parent, or null for the source-file root. */
    parent: SyntaxNode | null;
    /** Smallest concrete descendant spanning the byte index. */
    descendantForIndex(index: number): SyntaxNode;
    /** Smallest concrete descendant spanning the byte-index range. */
    descendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    /** Smallest concrete named descendant spanning the byte index. */
    namedDescendantForIndex(index: number): SyntaxNode;
    /** Smallest concrete named descendant spanning the byte-index range. */
    namedDescendantForIndex(startIndex: number, endIndex: number): SyntaxNode;
    /** Smallest concrete descendant spanning the source position. */
    descendantForPosition(position: Point): SyntaxNode;
    /** Smallest concrete descendant spanning the source-position range. */
    descendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    /** Smallest concrete named descendant spanning the source position. */
    namedDescendantForPosition(position: Point): SyntaxNode;
    /** Smallest concrete named descendant spanning the source-position range. */
    namedDescendantForPosition(startPosition: Point, endPosition: Point): SyntaxNode;
    /** Concrete descendants whose types match one or more generated symbols. */
    descendantsOfType(
      type: SatsumaGrammarSymbol | SatsumaGrammarSymbol[],
      startPosition?: Point,
      endPosition?: Point,
    ): SyntaxNode[];
  };

/** Concrete web-tree-sitter tree whose root carries the typed node contract. */
export type Tree = Omit<ParsedSatsumaTree, "rootNode" | "rootNodeWithOffset" | "copy"> & {
  /** Root concrete node of the parsed Satsuma document. */
  readonly rootNode: SyntaxNode;
  /** Root concrete node rebased to the requested byte and source-position offset. */
  rootNodeWithOffset(offsetBytes: number, offsetExtent: Point): SyntaxNode;
  /** Independent tree handle retaining the same typed concrete contract. */
  copy(): Tree;
};

// Re-export the singleton lifecycle from core.
export { initParser, getParser, getLanguage, createQuery } from "@satsuma/core";
export type { ParserInitOptions } from "@satsuma/core";

// ---------- CST navigation helpers (delegating to satsuma-core) ----------
//
// feat/26/sl-60gz: logic lives in satsuma-core/src/cst-utils.ts; wrappers here
// preserve the concrete `Node` type required by other LSP server code (which
// uses nodeRange() and web-tree-sitter WASM APIs that need the full Node type).

import {
  child as _child,
  children as _children,
  labelText as _labelText,
  stringText as _stringText,
  walkDescendants as _walkDescendants,
} from "@satsuma/core";

/**
 * Narrow a concrete node after it crosses a web-tree-sitter API whose upstream
 * declaration can only promise `type: string`.
 *
 * Parser roots are already narrowed by core. LSP-only navigation results and
 * query captures pass through this single audited assertion; handlers never
 * cast CST objects themselves. The runtime object is unchanged, so every
 * concrete web-tree-sitter navigation method remains available.
 */
function narrowCst(value: Node | CoreSyntaxNode): SyntaxNode;
function narrowCst(value: ParsedSatsumaTree): Tree;
function narrowCst(value: Node | CoreSyntaxNode | ParsedSatsumaTree): SyntaxNode | Tree {
  return value as unknown as SyntaxNode | Tree;
}

/** First named child of the given type. */
export function child(node: SyntaxNode, type: SatsumaGrammarSymbol): SyntaxNode | null {
  const match = _child(node, type);
  return match ? narrowCst(match) : null;
}

/** All named children of the given type. */
export function children(node: SyntaxNode, type: SatsumaGrammarSymbol): SyntaxNode[] {
  return _children(node, type).map((match) => narrowCst(match));
}

/** Extract the display text from a block_label node. */
export function labelText(node: SyntaxNode): string | null {
  return _labelText(node);
}

/** Strip delimiters from an NL string or multiline string node. */
export function stringText(node: SyntaxNode | null | undefined): string | null {
  return _stringText(node);
}

/** Walk all named descendants depth-first, calling fn on each. */
export function walkDescendants(node: SyntaxNode, fn: (n: SyntaxNode) => void): void {
  _walkDescendants(node, (descendant) => fn(narrowCst(descendant)));
}

/** A query capture whose concrete node has crossed the audited CST boundary. */
export interface SyntaxQueryCapture extends Omit<QueryCapture, "node"> {
  /** Captured concrete node with a generated-symbol-typed discriminant. */
  node: SyntaxNode;
}

/** Run a tree-sitter query and narrow every captured node at the LSP boundary. */
export function queryCaptures(query: Query, node: SyntaxNode): SyntaxQueryCapture[] {
  return query.captures(node).map((capture) => ({
    ...capture,
    node: narrowCst(capture.node),
  }));
}

// ---------- Parsing ─────────────────────────────────────────────────────────

import { getParser as _getParser } from "@satsuma/core";

export function parseSource(source: string): Tree {
  const tree = _getParser().parse(source);
  if (!tree) throw new Error("parse returned null");
  return narrowCst(tree);
}

// ---------- Cursor-position node resolution ----------

// A node is "word-like" if it is a leaf token whose text contains at least
// one word character — identifiers, field names, labels, string tokens.
// Punctuation tokens ("." "{" "->") are not word-like, so the end-of-word
// retry in nodeAtPosition never hijacks a cursor that legitimately sits on
// punctuation or in open space.
const WORD_CHAR = /\w/;

function isWordToken(node: SyntaxNode): boolean {
  return node.childCount === 0 && WORD_CHAR.test(node.text);
}

/**
 * Resolve the CST node the user means when their cursor is at the given
 * LSP position.
 *
 * tree-sitter node ranges are half-open, so `descendantForPosition` with
 * the raw position resolves a cursor sitting immediately *after* the last
 * character of an identifier to the *following* node — which made
 * go-to-definition, hover, references, rename, completion, and code
 * actions fail at word end while working mid-word (sl-ogd5). Like
 * standard LSP servers, when the node at the raw position is not itself
 * a word token we retry one column to the left and prefer a word token
 * found there. Mid-word and word-start cursors are unaffected: the raw
 * position already resolves to the word token. Cursors separated from
 * the previous word by whitespace are also unaffected: the left retry
 * lands on the whitespace, which resolves to a non-leaf parent.
 *
 * All position-based handlers must resolve their start node through this
 * helper rather than calling `descendantForPosition` directly.
 */
export function nodeAtPosition(tree: Tree, line: number, character: number): SyntaxNode | null {
  const exact = narrowCst(tree.rootNode.descendantForPosition({ row: line, column: character }));
  if (exact && isWordToken(exact)) return exact;
  if (character > 0) {
    const left = narrowCst(
      tree.rootNode.descendantForPosition({ row: line, column: character - 1 }),
    );
    if (left && isWordToken(left)) return left;
  }
  return exact ?? null;
}

// ---------- CST → LSP helpers ----------

/** Convert a tree-sitter node span to an LSP Range. */
export function nodeRange(node: SyntaxNode): Range {
  return Range.create(
    Position.create(node.startPosition.row, node.startPosition.column),
    Position.create(node.endPosition.row, node.endPosition.column),
  );
}

// Silence unused import warnings for type-only imports from web-tree-sitter.
// Parser and Language are used by callers importing these re-exported types.
export type { Parser, Language };

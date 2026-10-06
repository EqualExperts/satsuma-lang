/**
 * comment-attachment.ts — which field or arrow a trailing `//!` or `//?`
 * comment annotates.
 *
 * The grammar declares comments as tree-sitter *extras*: they may appear
 * between any two tokens and are attached to whichever node is open at that
 * point, not to the item they describe. So in
 *
 *     schema s {
 *       id   INT  //! legacy key
 *       name STRING //? still needed?
 *     }
 *
 * the `//!` is a sibling of `id`'s field_decl inside schema_body, but the
 * `//?` — trailing the body's LAST field — lands outside schema_body, as a
 * child of schema_block. Any consumer that wants to show a comment against
 * its field must therefore attach by position, not by tree shape. This module
 * owns that rule. It does not own comment text, wording or kind; see
 * comment-diagnostics.ts and the extractors for those.
 *
 * Node identity: web-tree-sitter hands out a fresh wrapper object on every
 * `.children` / `.parent` access, so `===` and `Array.prototype.indexOf`
 * never match two views of the same node. Nodes are compared by type and
 * byte range instead.
 */

import type { SyntaxNode } from "./types.js";

/** The comment kinds that annotate an item; plain `//` comments are not shown. */
const ANNOTATION_COMMENT_TYPES = new Set(["warning_comment", "question_comment"]);

/**
 * Rule: the items a trailing comment can annotate — field declarations and
 * the three mapping arrow forms (grammar.js `_arrow_decl`). A comment that
 * trails anything else (a block header, a metadata list) belongs to the
 * enclosing block instead.
 */
const ANNOTATABLE_TYPES = new Set(["field_decl", "map_arrow", "computed_arrow", "nested_arrow"]);

/** True for a `//!` warning or `//?` question comment node. */
export function isAnnotationComment(node: SyntaxNode): boolean {
  return ANNOTATION_COMMENT_TYPES.has(node.type);
}

/** True when two wrappers denote the same CST node (see module header). */
function sameNode(a: SyntaxNode | null, b: SyntaxNode | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.type === b.type &&
    a.startIndex === b.startIndex &&
    a.endIndex === b.endIndex
  );
}

/** Position of `node` among its parent's children (all, not just named), or -1. */
function siblingIndex(node: SyntaxNode): number {
  const siblings = node.parent?.children ?? [];
  return siblings.findIndex((s) => sameNode(s, node));
}

/**
 * The field_decl or arrow that `comment` trails on the same line, or null
 * when the comment stands on a line of its own or trails something that is
 * not an annotatable item.
 *
 * Starting from the node just before the comment, descends through last
 * children that end on the comment's line and keeps the innermost
 * annotatable one. Descent stops at an anonymous token such as a closing
 * `}` — a comment after `addr record { street STRING }` describes `addr`,
 * not `street`.
 */
export function trailingCommentOwner(comment: SyntaxNode): SyntaxNode | null {
  const index = siblingIndex(comment);
  if (index <= 0) return null;
  const line = comment.startPosition.row;
  let node: SyntaxNode | undefined = comment.parent?.children[index - 1];
  let owner: SyntaxNode | null = null;
  while (node && node.endPosition.row === line && !isAnnotationComment(node)) {
    if (ANNOTATABLE_TYPES.has(node.type)) owner = node;
    const last: SyntaxNode | undefined = node.children[node.children.length - 1];
    if (!last?.isNamed) break;
    node = last;
  }
  return owner;
}

/**
 * Every `//!` / `//?` comment that trails `item` (a field_decl or arrow), in
 * source order. Searches the item's following siblings, then — because a
 * comment after a body's last item is hoisted out of the body — the
 * following siblings of each ancestor that ends on the same line.
 */
export function trailingComments(item: SyntaxNode): SyntaxNode[] {
  const line = item.endPosition.row;
  const found: SyntaxNode[] = [];
  for (let node = item; node.parent; node = node.parent) {
    const siblings = node.parent.children;
    for (let i = siblingIndex(node) + 1; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (!sibling || sibling.startPosition.row !== line) break;
      if (isAnnotationComment(sibling) && sameNode(trailingCommentOwner(sibling), item)) {
        found.push(sibling);
      }
    }
    // A node running past this line closes after the comment, so nothing
    // further up can hold a comment on the item's line.
    if (node.endPosition.row !== line) break;
  }
  return found;
}

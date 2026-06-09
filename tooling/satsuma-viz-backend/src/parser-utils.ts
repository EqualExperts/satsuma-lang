/**
 * parser-utils.ts — host-neutral CST helpers for the viz backend.
 *
 * This package only needs stable tree types and node navigation helpers from
 * @satsuma/core, plus a Range adapter for indexed definitions and references.
 * It does not own parser lifecycle or editor protocol wiring.
 */

// Range/Position are runtime values (Range.create / Position.create) imported
// from vscode-languageserver-types — the zero-dependency types package — rather
// than the top-level vscode-languageserver, whose JSON-RPC server pulls in
// Node-only modules. This keeps the package bundleable for --platform=browser
// (feature 33: the playground runs this code in the browser).
import {
  Position,
  Range,
} from "vscode-languageserver-types";
import {
  child,
  children,
  labelText,
  stringText,
  walkDescendants,
} from "@satsuma/core";
import type { SyntaxNode } from "@satsuma/core";

export type { SyntaxNode, Tree } from "@satsuma/core";
export { child, children, labelText, stringText, walkDescendants };

/** Convert a tree-sitter node span to an LSP Range. */
export function nodeRange(node: SyntaxNode): Range {
  return Range.create(
    Position.create(node.startPosition.row, node.startPosition.column),
    Position.create(node.endPosition.row, node.endPosition.column),
  );
}

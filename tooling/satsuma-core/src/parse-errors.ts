/**
 * parse-errors.ts — CST error node collection for Satsuma parse trees.
 *
 * tree-sitter produces two kinds of error signal in the CST:
 *
 *   ERROR nodes — inserted when the parser encounters a token sequence it
 *   cannot match to any grammar rule.  The node spans the unexpected tokens
 *   and has type "ERROR".  ERROR nodes may contain nested children (the
 *   tokens that were consumed in error-recovery mode).
 *
 *   MISSING nodes — inserted when the parser needed a specific token to
 *   complete a rule but couldn't find it.  The node has zero width (start
 *   equals end), carries the expected node type as its `type` field, and has
 *   `isMissing === true`.  A single syntax error often produces both an ERROR
 *   node and one or more MISSING siblings.
 *
 * Both kinds must be collected to give complete diagnostic coverage.  This
 * module provides a plain-data extraction: callers receive ParseErrorEntry[]
 * and map it to their native diagnostic type (LintDiagnostic, vscode.Diagnostic,
 * etc.) using whichever fields they need.
 */

import type { SyntaxNode, Tree } from "./types.js";

// ── Public types ────────────────────────────────────────────────────────────

/**
 * A single parse error extracted from the CST.
 * All position values are 0-indexed (matching tree-sitter's native format).
 */
export interface ParseErrorEntry {
  /** Human-readable description of the problem. */
  message: string;
  /** 0-indexed row of the error node's start position. */
  startRow: number;
  /** 0-indexed column of the error node's start position. */
  startColumn: number;
  /** 0-indexed row of the error node's end position. */
  endRow: number;
  /** 0-indexed column of the error node's end position. */
  endColumn: number;
  /**
   * True when the node is a MISSING node (expected token not found), false
   * when it is an ERROR node (unexpected tokens encountered).  Consumers
   * may use this to apply different formatting or severity.
   */
  isMissing: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Maximum characters from ERROR node text shown in the diagnostic message. */
const MAX_ERROR_PREVIEW_CHARS = 40;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Collect all ERROR and MISSING nodes from a parse tree.
 *
 * Returns a ParseErrorEntry for each problematic node found during a full CST
 * walk.  The array is empty when the tree parsed without errors.
 *
 * Position values are 0-indexed; callers that need 1-indexed output (e.g. the
 * CLI) should add 1 to startRow and startColumn.
 */
export function collectParseErrors(tree: Tree): ParseErrorEntry[] {
  const errors: ParseErrorEntry[] = [];
  walkErrors(tree.rootNode, errors);
  return errors;
}

// ── Internal walk ───────────────────────────────────────────────────────────

function walkErrors(node: SyntaxNode, out: ParseErrorEntry[]): void {
  if (node.type === "ERROR") {
    const preview = node.text.slice(0, MAX_ERROR_PREVIEW_CHARS).replace(/\n/g, "\\n");
    out.push({
      message: `Syntax error: unexpected '${preview}'`,
      startRow: node.startPosition.row,
      startColumn: node.startPosition.column,
      endRow: node.endPosition.row,
      endColumn: node.endPosition.column,
      isMissing: false,
    });
    // Recurse into ERROR children — nested errors provide more specific locations
    // than the enclosing ERROR alone.
  } else if (node.isMissing) {
    out.push({
      message: `Missing expected '${node.type}'`,
      startRow: node.startPosition.row,
      startColumn: node.startPosition.column,
      endRow: node.endPosition.row,
      endColumn: node.endPosition.column,
      isMissing: true,
    });
  }

  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) walkErrors(c, out);
  }
}

import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import type { SyntaxNode, Tree } from "./parser-utils";
import { nodeRange } from "./parser-utils";
import { collectParseErrors, commentDiagnosticMessage } from "@satsuma/core";

/**
 * Produce LSP diagnostics from a tree-sitter parse tree.
 *
 * - ERROR / MISSING nodes → Error severity (via collectParseErrors from @satsuma/core)
 * - warning_comment (//!) → Warning severity
 * - question_comment (//?…) → Information severity
 *
 * Rule: questions are Information, never Hint. VS Code's Problems panel lists
 * Error, Warning and Information only, and an open question is meant to be
 * seen there (Feature 16 PRD). A Hint with the Unnecessary tag hid questions
 * and greyed them out until gh-542 / sl-0j8b restored this.
 */
export function computeDiagnostics(tree: Tree): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Map core's ParseErrorEntry[] to LSP Diagnostic[].
  for (const e of collectParseErrors(tree)) {
    diagnostics.push({
      range: {
        start: { line: e.startRow, character: e.startColumn },
        end: { line: e.endRow, character: e.endColumn },
      },
      severity: DiagnosticSeverity.Error,
      source: "satsuma",
      message: e.message,
    });
  }

  walkComments(tree.rootNode, diagnostics);
  return diagnostics;
}

/**
 * Safety net applied at the publish boundary (see server.ts): returns the
 * diagnostics with every empty or whitespace-only message replaced by a
 * placeholder naming the rule code. No producer should emit an empty message,
 * but if one slips through, this keeps the client's diagnostic pipeline alive
 * instead of freezing all diagnostics for the file (sl-sme1, gh-273).
 */
export function ensureNonEmptyMessages(diags: Diagnostic[]): Diagnostic[] {
  return diags.map((d) =>
    hasNonEmptyMessage(d)
      ? d
      : {
          ...d,
          message: d.code ? `Diagnostic '${d.code}' (no message)` : "Diagnostic (no message)",
        },
  );
}

/**
 * Since LSP 3.18 a diagnostic message may be plain text or MarkupContent
 * (markdown/plaintext with an explicit kind); the markup form carries its
 * text in `.value`. Treat whitespace-only text as empty in both forms.
 */
function hasNonEmptyMessage(d: Diagnostic): boolean {
  const text = typeof d.message === "string" ? d.message : d.message.value;
  return text.trim().length > 0;
}

/** Collect //! and //? comments as diagnostics. */
function walkComments(node: SyntaxNode, out: Diagnostic[]): void {
  // Comments are "extra" nodes in tree-sitter — they can appear at any level.
  // Walk all children (not just named) to find them.
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);

    if (child.type === "warning_comment") {
      out.push({
        range: nodeRange(child),
        severity: DiagnosticSeverity.Warning,
        source: "satsuma",
        message: commentDiagnosticMessage("warning", child.text.replace(/^\/\/!/, "")),
      });
    } else if (child.type === "question_comment") {
      out.push({
        range: nodeRange(child),
        severity: DiagnosticSeverity.Information,
        source: "satsuma",
        message: commentDiagnosticMessage("question", child.text.replace(/^\/\/\?/, "")),
      });
    }

    // Recurse into structural nodes to find nested comments
    if (child.namedChildCount > 0) {
      walkComments(child, out);
    }
  }
}

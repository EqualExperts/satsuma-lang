/**
 * comment-diagnostics.ts — the editor-facing message for a `//!` warning or
 * `//?` question comment.
 *
 * Two consumers turn these comments into editor diagnostics: the LSP, for
 * open documents, and the VS Code "Satsuma: Show Warnings" command, for the
 * whole workspace via `satsuma warnings --json`. Both must word an entry the
 * same way, or one comment would read differently depending on which route
 * reported it. This module owns only the wording; severity and ranges belong
 * to each consumer's own diagnostic type.
 */

/** The two comment kinds that surface as diagnostics. */
export type CommentDiagnosticKind = "warning" | "question";

/**
 * Prefix for a question. Editors show questions at Information severity, and
 * that icon alone does not say what kind of entry a row is, so the message
 * names it, using the spec's word. Warnings need no prefix: their severity
 * already says it.
 */
const QUESTION_MESSAGE_PREFIX = "Question: ";

/**
 * Fallback text for a bare `//!` or `//?` with nothing after the marker.
 * Diagnostics must never ship an empty message: vscode's Diagnostic
 * constructor throws `illegalArgument("message must be set")` on a falsy
 * message, and one bad entry aborts the client's whole diagnostic batch,
 * freezing diagnostics for the file (sl-sme1, gh-273).
 */
const EMPTY_COMMENT_MESSAGE: Record<CommentDiagnosticKind, string> = {
  warning: "Warning comment (no text)",
  question: "Question comment (no text)",
};

/**
 * Build the diagnostic message for a comment, given its text with the `//!`
 * or `//?` marker already stripped. Always returns a non-empty string.
 */
export function commentDiagnosticMessage(kind: CommentDiagnosticKind, text: string): string {
  const body = text.trim();
  if (!body) return EMPTY_COMMENT_MESSAGE[kind];
  return kind === "question" ? QUESTION_MESSAGE_PREFIX + body : body;
}

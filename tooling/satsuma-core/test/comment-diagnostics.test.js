/**
 * comment-diagnostics.test.js — Unit tests for src/comment-diagnostics.ts
 *
 * The LSP (open files) and VS Code's Show Warnings command (whole workspace)
 * both word `//!` and `//?` diagnostics through this one function, so a
 * comment reads the same whichever route reported it (sl-0j8b).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commentDiagnosticMessage } from "@satsuma/core";

describe("commentDiagnosticMessage", () => {
  it("names a question as one, since the Information icon alone does not (gh-542)", () => {
    assert.equal(
      commentDiagnosticMessage("question", " should this be INT?"),
      "Question: should this be INT?",
    );
  });

  it("leaves warning text as written, since Warning severity already says what it is", () => {
    assert.equal(commentDiagnosticMessage("warning", "NULLs in source"), "NULLs in source");
  });

  it("gives a bare marker a descriptive fallback, never an empty message (sl-sme1)", () => {
    // An empty message makes vscode's Diagnostic constructor throw, and a
    // bare "Question: " would read as a truncated question.
    assert.equal(commentDiagnosticMessage("question", "   "), "Question comment (no text)");
    assert.equal(commentDiagnosticMessage("warning", ""), "Warning comment (no text)");
  });
});

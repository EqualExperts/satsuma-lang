---
id: sl-sme1
status: closed
deps: []
links: []
created: 2026-06-10T21:52:14Z
type: bug
priority: 2
assignee: Thorben Louw
external-ref: gh-273
tags: [lsp, vscode, diagnostics]
---
# LSP publishes empty-message diagnostics; VS Code client throws 'message must be set' and stalls the diagnostic queue

GitHub issue #273 (user kiaroa, v0.8.0): the extension host logs '[error] Processing diagnostic queue failed. TypeError: message must be set' from new ProtocolDiagnostic → asDiagnostic → convertBatch in vscode-languageclient.

Root cause: vscode.Diagnostic's constructor throws illegalArgument('message must be set') when message is falsy — including the empty string. The Satsuma LSP can publish such a diagnostic: tooling/satsuma-lsp/src/diagnostics.ts:50 maps a warning_comment to message: child.text.replace(/^\/\/!\s*/, ''), so a bare '//!' comment (no text after it) yields message: ''. When the client converts that batch, the constructor throws and the entire diagnostic queue processing fails — diagnostics for the file stop updating, not just the one entry. (The //? path is safe — it always prefixes 'TODO: '.)

The issue title mentions Copilot chat because an AI edit introduced the bare '//!'; any user typing '//!' mid-comment hits it too.

Fix direction: never publish an empty message. Give bare '//!' a sensible fallback message (e.g. 'Warning comment'), and add a defensive guard/assertion at the publishDiagnostics boundary so no diagnostic source can ship message: ''. Add a regression test with a bare '//!' fixture, and audit other diagnostic producers (parse errors, semantic, validate-diagnostics) for empty-message paths.

## Acceptance Criteria

A file containing a bare '//!' produces a non-empty-message warning diagnostic and no client-side TypeError. Test covers the empty-suffix warning_comment case. No diagnostic publish path can emit an empty message.


## Notes

**2026-06-10T22:17:34Z**

Cause: a bare '//!' warning comment produced an LSP diagnostic with message: '' (diagnostics.ts walkComments). vscode.Diagnostic's constructor throws illegalArgument('message must be set') on a falsy message, and vscode-languageclient's batch conversion aborts on the throw, freezing all diagnostics for the file (gh-273).
Fix: bare '//!' now falls back to 'Warning comment (no text)', and sendMergedDiagnostics applies ensureNonEmptyMessages() as a publish-boundary guard so no producer can ship an empty message. Regression tests added in satsuma-lsp/test/diagnostics.test.js.

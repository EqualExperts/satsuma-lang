---
id: sl-w9zz
status: closed
deps: []
links: []
created: 2026-06-11T21:46:46Z
type: chore
priority: 2
assignee: Thorben Louw
external-ref: gh-297
---
# Migrate satsuma-lsp to vscode-languageserver 10 (dependabot #297)

Dependabot PR #297 bumps vscode-languageserver 9.0.1 -> 10.0.0 in tooling/satsuma-lsp. v10 (LSP spec 3.18) ships an exports map that the legacy moduleResolution 'node' cannot resolve, so tsc fails with TS2307 across the LSP sources. The VS Code extension already uses vscode-languageclient ^10.0.0, so client/server libs are straddling major versions; aligning on 10 is the intended state.

## Acceptance Criteria

vscode-languageserver bumped to ^10.0.0 in tooling/satsuma-lsp; tsconfig updated to node16 module resolution; LSP test suite passes locally; vscode-satsuma extension compiles and its tests pass; dependabot PR #297 superseded/closed


## Notes

**2026-06-11T21:54:50Z**

Cause: vscode-languageserver 10 (LSP 3.18) ships an exports map invisible to the legacy 'node' moduleResolution, so every import failed with TS2307; two real type changes (Diagnostic.message widened to string | MarkupContent, stricter onRequest generics exposing a partial ActionContext fallback) also surfaced.
Fix: bumped to ^10.0.0, switched tsconfig to nodenext (retiring the @satsuma/* paths workarounds), handled both message forms in ensureNonEmptyMessages, and completed the actionContext fallback object (commit 86abc15).

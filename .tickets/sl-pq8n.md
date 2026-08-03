---
id: sl-pq8n
status: closed
deps: [sl-1f8o]
links: []
created: 2026-08-03T16:59:36Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r7, lsp]
---
# lsp: apply type-aware ESLint and CST-narrowing rules

PRD 39 R7. satsuma-lsp (tooling/satsuma-lsp/src, ~4600 lines) already has the narrowed CST type from R2 (tcc-yb3z, closed). Add a tseslint.configs.recommendedTypeChecked block for tooling/satsuma-lsp/src/**/*.ts, then additionally enable @typescript-eslint/no-unnecessary-condition and @typescript-eslint/switch-exhaustiveness-check now that node.type is SatsumaCstType. Follow the same exhaustiveness scoping decided in the satsuma-core R7 ticket (domain discriminated unions must be exhaustive; the 100-value CST union may stay intentionally partial). Fix every finding at its boundary; no package-wide suppressions.

## Acceptance Criteria

recommendedTypeChecked plus no-unnecessary-condition and switch-exhaustiveness-check apply to tooling/satsuma-lsp/src/**/*.ts; lint passes with zero package-wide rule disables; full satsuma-lsp test suite (299 tests) and npm run lint pass; LSP protocol responses (semantic tokens, diagnostics, hover, etc.) are unchanged, matching PRD acceptance test 15's protocol-snapshot-stability intent.


## Notes

**2026-08-03T17:51:59Z**

Cause: satsuma-lsp had no type-aware ESLint coverage despite R2 narrowing its CST type (tcc-yb3z).
Fix: added recommendedTypeChecked + no-unnecessary-condition + switch-exhaustiveness-check for tooling/satsuma-lsp/src/**/*.ts, then fixed all 37 findings across codelens.ts, definition.ts, diagnostics.ts, hover.ts, parser-utils.ts, rename.ts, semantic-diagnostics.ts, semantic-tokens.ts, and server.ts. Two switch findings were genuine intentional-partiality (a top-level CST-kind switch in codelens.ts, a "namespace" definition-kind case in semantic-diagnostics.ts) — added explicit default/case branches with comments rather than suppressing. server.ts's three no-unsafe-* findings on `initializationOptions` were fixed with a real type guard (hasCliPath) instead of a cast; its three no-floating-promises findings on connection.sendDiagnostics were marked with `void` since diagnostic publishes are genuinely fire-and-forget.

This package's local SyntaxNode type (parser-utils.ts) redeclares several web-tree-sitter navigation methods (child(index), descendantForPosition, childForFieldName) as non-nullable, even though the underlying library's own .d.ts types them as nullable — the same "type promises more than the library guarantees" shape as core's cst-utils.ts. Rather than assume either way, empirically verified each case against the real WASM parser before deciding: childForFieldName("name") on a namespace_block is safe to simplify (malformed input never produces a namespace_block missing that field — it falls back to a whole ERROR node instead), and descendantForPosition never returns null even for wildly out-of-range positions (confirmed with negative columns, huge rows/columns, and an empty document) — so parser-utils.ts's nodeAtPosition was simplified to match. All 300 lsp tests, 607 core tests, 1003 cli tests, 34 vscode-satsuma unit tests, full-repo lint, and tsc pass. (commit immediately after 367e7fc6)

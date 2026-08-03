---
id: sl-pq8n
status: open
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


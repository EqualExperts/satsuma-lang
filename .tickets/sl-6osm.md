---
id: sl-6osm
status: open
deps: [sl-0dy0]
links: []
created: 2026-08-03T16:59:55Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r7, vscode]
---
# vscode-satsuma: apply type-aware ESLint

PRD 39 R7. vscode-satsuma (tooling/vscode-satsuma/src, ~3300 lines) has no CST dependency (it delegates language intelligence to satsuma-lsp) and is the last package in the R7 rollout, landing after its lsp/core/viz dependencies are already clean. Add a tseslint.configs.recommendedTypeChecked block for tooling/vscode-satsuma/src/**/*.ts (parserOptions.projectService against tooling/vscode-satsuma/src/tsconfig.json). Fix every finding at its boundary; no package-wide suppressions. This completes PRD 39 R7 across core, LSP, viz-backend, viz-model, viz, and VS Code.

## Acceptance Criteria

recommendedTypeChecked applies to tooling/vscode-satsuma/src/**/*.ts; lint passes with zero package-wide rule disables; full vscode-satsuma test suite (34 tests) and npm run lint pass; webview message-guard behaviour (sl-b90g) is unaffected.


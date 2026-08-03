---
id: sl-0dy0
status: open
deps: [sl-fqj2]
links: []
created: 2026-08-03T16:59:48Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r7, viz]
---
# viz: apply type-aware ESLint and noUncheckedIndexedAccess

PRD 39 R7. satsuma-viz (tooling/satsuma-viz/src, ~7700 lines, the Lit web component) has no CST dependency, so it needs only the base recommendedTypeChecked rollout, not the CST-narrowing rules. Add a tseslint.configs.recommendedTypeChecked block for tooling/satsuma-viz/src/**/*.ts (parserOptions.projectService against tooling/satsuma-viz/tsconfig.json), and add noUncheckedIndexedAccess: true to that tsconfig.json — the one package missing it (every other TS package already has it). Fix every finding from both changes at its boundary; no package-wide suppressions.

## Acceptance Criteria

recommendedTypeChecked applies to tooling/satsuma-viz/src/**/*.ts; tooling/satsuma-viz/tsconfig.json has noUncheckedIndexedAccess: true; lint and tsc both pass with zero package-wide rule disables; full satsuma-viz test suite (128 tests) and npm run lint pass; overview graph and per-mapping detail rendering are visually unchanged (spot-check via the viz harness).


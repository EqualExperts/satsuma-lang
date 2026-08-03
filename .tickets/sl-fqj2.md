---
id: sl-fqj2
status: open
deps: [sl-pq8n]
links: []
created: 2026-08-03T16:59:41Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r7, viz-backend]
---
# viz-backend: apply type-aware ESLint and CST-narrowing rules

PRD 39 R7. satsuma-viz-backend (tooling/satsuma-viz-backend/src, ~3500 lines) already has the narrowed CST type from R2 (tcc-chls, closed). Add a tseslint.configs.recommendedTypeChecked block for tooling/satsuma-viz-backend/src/**/*.ts, then additionally enable @typescript-eslint/no-unnecessary-condition and @typescript-eslint/switch-exhaustiveness-check now that node.type is SatsumaCstType. Follow the same exhaustiveness scoping decided in the satsuma-core R7 ticket. Fix every finding at its boundary; no package-wide suppressions.

## Acceptance Criteria

recommendedTypeChecked plus no-unnecessary-condition and switch-exhaustiveness-check apply to tooling/satsuma-viz-backend/src/**/*.ts; lint passes with zero package-wide rule disables; full satsuma-viz-backend test suite (182 tests) and npm run lint pass; VizModel assembly output and coverage computation (ADR-042) are unchanged.


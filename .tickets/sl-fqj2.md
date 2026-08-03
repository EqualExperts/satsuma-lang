---
id: sl-fqj2
status: closed
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


## Notes

**2026-08-03T17:58:44Z**

Cause: satsuma-viz-backend had no type-aware ESLint coverage despite R2 narrowing its CST type (tcc-chls).
Fix: added recommendedTypeChecked + no-unnecessary-condition + switch-exhaustiveness-check for tooling/satsuma-viz-backend/src/**/*.ts, then fixed all 11 findings across viz-model.ts and workspace-index.ts. Two switch findings were the same genuine intentional-partiality pattern seen in core/lsp (a top-level CST-kind switch building VizModel cards, and a mapping-body-child switch) — added explicit default branches with comments. The rest were non-null assertions on array indices already proven in-bounds by their enclosing loop/guard (for-loop bounds, length===1/0 checks, split()/pop() on strings), rewritten as destructuring or explicit undefined checks instead of `!`. One case (mergeVizModels) needed the actual npm run build (not a raw npx tsc invocation, which hits an unrelated pre-existing tsconfig moduleResolution deprecation warning that blocks real typechecking) to catch a genuine type error from an initial fix attempt. All 186 viz-backend tests, 300 lsp tests, 130 viz tests, full-repo lint, and tsc pass. (commit immediately after 315c0b9e)

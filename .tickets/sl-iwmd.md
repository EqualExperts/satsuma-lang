---
id: sl-iwmd
status: closed
deps: []
links: []
created: 2026-08-03T16:59:12Z
type: task
priority: 1
assignee: Thorben Louw
parent: gcsc-qka8
tags: [feature-39, r7, viz-model]
---
# viz-model: apply type-aware ESLint (recommendedTypeChecked)

PRD 39 R7. satsuma-viz-model (tooling/satsuma-viz-model/src/index.ts, ~390 lines) has no CST dependency and no type-aware linting today. Add a tseslint.configs.recommendedTypeChecked block for tooling/satsuma-viz-model/src/**/*.ts in the root eslint.config.mjs (parserOptions.projectService + tsconfigRootDir, matching the existing satsuma-cli/src block), fix every finding at its boundary, and land no package-wide rule suppressions. This is the smallest package in the R7 rollout and is scheduled first to prove the per-package pattern before tackling the larger CST-using packages.

## Acceptance Criteria

recommendedTypeChecked applies to tooling/satsuma-viz-model/src/**/*.ts; lint passes with zero package-wide rule disables (targeted inline suppressions only, each with a justification comment); no-unsafe-* findings (bundled in recommendedTypeChecked) are fixed, not suppressed; existing satsuma-viz-model test suite and npm run lint both pass; VizModel protocol snapshots (satsuma-viz-viz-backend/satsuma-viz consumers) are unchanged.


## Notes

**2026-08-03T17:08:32Z**

Cause: satsuma-viz-model had no type-aware ESLint coverage — PRD 39 R7 rolls recommendedTypeChecked out package by package, starting with this one since it is smallest and has no CST dependency.
Fix: added a recommendedTypeChecked block for tooling/satsuma-viz-model/src/**/*.ts to eslint.config.mjs (projectService against the package's existing tsconfig.json), mirroring the satsuma-cli block. Zero findings — the package is pure type declarations plus one Set constant. (commit immediately after b03aeeb4)

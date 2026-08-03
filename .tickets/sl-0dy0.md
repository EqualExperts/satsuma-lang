---
id: sl-0dy0
status: closed
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


## Notes

**2026-08-03T18:18:41Z**

Cause: satsuma-viz was the one TS package without noUncheckedIndexedAccess and had no type-aware ESLint coverage.
Fix: added noUncheckedIndexedAccess to tsconfig.json and recommendedTypeChecked (no CST-narrowing rules — this package has no CST dependency) to eslint.config.mjs, then fixed all resulting findings: 78 real tsc errors from noUncheckedIndexedAccess across sz-edge-layer.ts, sz-overview-edge-layer.ts, markdown.ts, and elk-layout.ts (array-index/tuple-destructure guards, all provably in-bounds by their enclosing loop/length-check), plus 71 eslint findings across 5 files.

Two notable false-positive classes surfaced and required care rather than blind fixes:
- 35 `unbound-method` findings are Lit's `@event=${this.method}` template-binding idiom used throughout ~15 components. Verified against lit-html's own source (EventPart.handleEvent calls `this._$committedValue.call(this.options?.host ?? this.element, event)`) that Lit deliberately binds `this` to the component instance for every template event listener — a real, documented framework guarantee, not a coincidence. Disabled unbound-method for the package with a comment citing the exact mechanism, rather than converting ~15 methods to arrow-function class fields for a binding guarantee the framework already provides.
- 9 `no-unnecessary-type-assertion` findings on `renderRoot?.querySelector?.(...) as HTMLElement | null` were themselves false positives — confirmed by actually applying eslint's own --fix and watching tsc fail (querySelector's generic defaults to Element, which lacks offsetLeft/clientWidth/etc). Consolidated into two small typed helpers (queryHtml, queryHtmlAll) instead of scattering 9 per-line suppressions.

Also found and fixed a real latent bug while removing a non-null assertion: _buildMergedModel() returned `this.model!` when `this.model` was falsy (one arm of an OR condition), which would have returned null cast as VizModel; rewrote to return a real empty model in that case.

All 130 viz tests, full pretest (tsc + esbuild), and full-repo lint pass. (commit immediately after 207f53cd)

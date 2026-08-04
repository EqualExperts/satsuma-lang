---
id: mbt-45v2
status: open
deps: [mbt-npy0]
links: []
created: 2026-08-04T11:08:48Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R5: Wire Turborepo into CI

Route CI's existing per-package job/matrix steps in .github/workflows/ci.yml through turbo run <task> --filter=... so a package whose inputs are unchanged is skipped (cache hit) rather than always re-executed. Persist .turbo via actions/cache. Measure and record the before/after CI wall-clock delta against the R1 baseline. Keep the existing per-package job/matrix structure -- do not restructure the job graph in this ticket unless investigation shows it's required.

## Acceptance Criteria

- CI steps use turbo run --filter for build/test/lint tasks
- .turbo cache is persisted across CI runs via actions/cache
- A scoped test (no-op change under one package only, e.g. tooling/satsuma-viz) demonstrates turbo reports other packages as cached/skipped in CI
- Before/after CI wall-clock time recorded and compared against the R1 baseline
- All existing CI checks (Tree-sitter parser, VS Code extension, etc.) still pass and gate PRs as before


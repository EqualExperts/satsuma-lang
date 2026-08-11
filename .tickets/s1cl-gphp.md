---
id: s1cl-gphp
status: closed
deps: []
links: []
created: 2026-08-11T08:53:58Z
type: bug
priority: 0
assignee: Thorben Louw
tags: [ci, lint, release, versioning]
---
# Generate build-version modules before clean-checkout lint

CI type-aware ESLint fails after sl-13p5 because the ignored LSP build-version module exists locally after a build but is absent in a clean checkout. Centralize generated module writing in release-metadata and run it before lint.

## Acceptance Criteria

A clean checkout with both ignored build-version modules absent passes npm run lint:js; CLI and LSP builds use the same central generator; regression tests cover generation and the lint prerequisite; full repo checks pass.


## Notes

**2026-08-11T08:59:25Z**

Cause: The LSP imported a gitignored generated build-version module, but root lint did not generate it. Local checks passed only because an earlier build had left the module in place, while clean CI type-aware ESLint resolved the import as an error-typed value. Fix: Centralized CLI/LSP build-version module generation in release-metadata, made it an explicit prelint:js prerequisite, routed both package prebuilds through the same writer, and added clean-checkout regression coverage. (commit immediately after 7afba92c)

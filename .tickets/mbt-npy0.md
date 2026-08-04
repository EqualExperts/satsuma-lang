---
id: mbt-npy0
status: open
deps: [mbt-0f7t]
links: []
created: 2026-08-04T11:08:48Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R4: Introduce Turborepo pipeline for build/test/lint

Add a root turbo.json defining per-package build, test, test:coverage, and lint tasks with dependsOn: ["^build"] wiring that expresses the cross-package build order (core -> viz-model/viz-backend -> tree-sitter WASM -> cli/viz/lsp/vscode) exactly once. This replaces the two hand-maintained copies of that order: the root package.json script chain and the install job in .github/workflows/ci.yml. Adopt Turborepo's local content-hash cache (.turbo) -- no remote/hosted cache per ADR-049.

## Acceptance Criteria

- turbo.json defines build/test/test:coverage/lint pipelines with correct dependsOn wiring
- Running turbo run build from a clean workspace produces the same build order/outputs as the current hand-sequenced install:all chain
- The --ignore-scripts workaround for satsuma-cli's install is no longer needed (Turborepo topologically builds dependencies first)
- .turbo local cache demonstrably skips a re-build/re-test of a package whose inputs are unchanged
- All existing tests pass unchanged


## Notes

**2026-08-04T13:26:29Z**

R1 handoff: Turborepo orders tasks only after npm install and therefore cannot itself prevent install-time prepare hooks from firing. Before R4 removes --ignore-scripts, move or neutralize the package build work currently run by prepare so the install succeeds independently and Turbo owns the subsequent build graph. See features/42-monorepo-build-tooling/R1-FINDINGS.md.

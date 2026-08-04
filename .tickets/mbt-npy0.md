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

**2026-08-04T17:04:02Z**

**2026-08-04T17:12:00Z**

R2/R3 handoff, plus a design decision taken with the user (2026-08-04).

**Blocked until PR #478 merges.** R4-R6 start from a clean `main`, not stacked on
the R2/R3 branch — user's call, so R5's CI measurement is a like-for-like
main-vs-main comparison and there is no rebase churn.

**Decision: put the grammar in the dependency graph, don't special-case it.**
Four packages copy `tree-sitter-satsuma.wasm` into their own output — satsuma-cli,
satsuma-lsp, satsuma-viz-harness, vscode-satsuma — and none of them declares
`tree-sitter-satsuma`. Turborepo's `dependsOn: ["^build"]` derives order from the
manifests, so it cannot order the grammar build for them as things stand. Add
`tree-sitter-satsuma` as a devDependency of those four rather than writing
explicit `dependsOn: ["tree-sitter-satsuma#build"]` entries: the relationship is
real, and declaring it keeps the ordering derivable instead of a special case.

**Already done by R2, so R4 does not need to:**
- The `--ignore-scripts` workaround is gone. The install-time `prepare` hooks on
  core, viz-model, viz-backend and satsuma-cli were deleted, so a clean root
  install only links and a plain `npm install` succeeds. R1's warning that
  Turborepo cannot order npm's install-time hooks is therefore already satisfied.
- `tree-sitter-satsuma` gained `build:wasm` (WASM only, no `generate`) and
  `test:corpus` scripts. Note `build` is still `generate && build:wasm`, so a
  turbo task that runs `build` will regenerate the committed parser sources —
  idempotent, but consider whether the graph should depend on `build:wasm`.

**What R4 still has to remove** — the cross-package rebuild chains that turbo's
`^build` replaces. `scripts/build-workspace.sh` is the transitional single copy of
the build order and is what R4 deletes; these per-package chains are the rest:
- satsuma-cli: `prebuild` -> `build:core && build:viz-backend`, and `build:core`/
  `build:viz-backend` themselves
- satsuma-viz-model: `prebuild` -> `build:core`; `pretest` -> `build:core && tsc`
- satsuma-viz-backend: `prebuild` -> `build:core && build:viz-model`; `pretest`
- satsuma-lsp: `prebuild` and `pretest` both rebuild core and viz-backend
- satsuma-viz-harness: `prebuild` -> rebuilds core, viz-backend and viz
- vscode-satsuma: `prebuild` -> `build:core`; `build:server` -> `cd ../satsuma-lsp`

Deleting them means `npm test` in one package no longer builds its dependencies,
so `scripts/run-repo-checks.sh` must route through `turbo run` in the same change
— it currently invokes each package with `npm --prefix`.

**Also add `.turbo` to .gitignore.**

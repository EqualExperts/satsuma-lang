---
id: mbt-npy0
status: closed
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

**2026-08-04T18:05:13Z**

Cause: the cross-package build order was written down in three places at once — the root package.json chain (via scripts/build-workspace.sh), the install job in ci.yml, and a `prebuild`/`pretest` hook in almost every package that shelled out to `npm --prefix ../sibling run build` — with nothing enforcing that they agreed.
Fix: added turbo.json and made the order derivable from the manifests instead of written anywhere. Deleted scripts/build-workspace.sh and every cross-package prebuild/pretest chain; declared the eight real-but-undeclared edges (tree-sitter-satsuma on the seven packages that load or copy the grammar WASM, @satsuma/viz on the harness that copies its bundle, @satsuma/viz-backend on the extension that bundles its sources, and satsuma-cli on the LSP, whose suite runs the CLI's built entry point); routed run-repo-checks.sh and ci.yml through `turbo run`; and replaced the CLI-local prebuild-wiring guard with scripts/workspace-build-graph.test.mjs, which asserts the same property against the new mechanism for every package. (commit immediately after 7c7fbd74)

Measured, all in this worktree:
- Cold build (`turbo run build --force`, every dist/ and the WASM deleted): 9 tasks, 6.4s, all artifacts present, no tracked file dirtied by the grammar's `generate`.
- Re-build with no changes: 9/9 cached, 16ms.
- Full test sweep (`npm run test:all` = test + test:typecheck over 9 packages): 58s cold; 23/24 cached and 670ms on a no-change re-run. The one always-uncached task is @satsuma/lsp#compile, by design.
- Scoped invalidation: a comment appended to tooling/satsuma-viz/src/satsuma-viz.ts re-ran only @satsuma/viz's build/test/typecheck plus vscode-satsuma's build and test — a genuine dependent, since the extension bundles the viz component. 18/24 cached, 4.2s. The CLI's 1056 tests, core's 697 and the LSP's 300 were all skipped.
- `./scripts/run-repo-checks.sh` end to end: green in 1m24s, and test-stats.json regenerated to the same numbers the tee-based collection produced (minus the one test deleted with prebuild-wiring.test.ts: 1057 -> 1056).

Four things worth knowing for R5/R6:

1. **The grammar had to enter the graph, and it belongs before core, not after.** build-workspace.sh built the WASM in tier 3, after viz-backend. It is now tier 0, because satsuma-core's parser-backed suites load the WASM *and* the grammar's `generate` step writes satsuma-core/src/generated/cst-types.ts. That write is also why the build-graph test carries one documented exemption: tree-sitter-satsuma reaches into @satsuma/core, but declaring it would invert an edge that already exists and turbo would reject the cycle.

2. **The build-graph test found a real ordering gap, not just a mechanism change.** @satsuma/lsp's test suite runs `../../satsuma-cli/dist/index.js` and nothing ordered that build; ci.yml compensated with a step literally named "Build satsuma-cli (needed by LSP formatting provider)". Declaring the dependency removes the workaround. The test distinguishes reaching a sibling's *output* from reaching its committed source — three packages read satsuma-cli's test/fixtures/ for coverage parity and need nothing built, so a coarser rule would have demanded two cyclic declarations.

3. **@satsuma/lsp#compile is `cache: false`, and that is a symptom.** `build` (esbuild bundle) and `compile` (tsc) both write dist/server.js, so the task cannot declare dist/** as an output without a cache restore silently choosing which server.js survives. It also had to be given `dependsOn: ["build"]` so the two never race — turbo would otherwise have run them concurrently. Raised mbt-oy6n to separate the output trees, after which it becomes a normal cached task.

4. **Turborepo needs `packageManager` in the root manifest, and its cache is shared across git worktrees.** `devEngines.packageManager` was tried first and rejected: turbo refuses any range spanning more than one npm major, which a range covering both a contributor's npm and CI's Node image must. Separately, from a linked worktree turbo uses the *primary* worktree's .turbo ("using shared worktree cache"), so `clean:all`'s `.turbo` entry is a no-op there — `turbo run build --force` is how to prove a cold build. Both are documented in the root manifest's `//scripts` note.

ci.yml scope note: R4 changed only what it had to. `npm run test:release` -> `test:scripts`, `npm run lint` -> `npx turbo run lint`, the CLI job's deleted `pretest` -> `test:typecheck`, the tooling-modules typecheck step's hardcoded shard list -> `--if-present` (R4 gave satsuma-viz a test:typecheck of its own, which the list would have skipped), and the vscode job's four hand-ordered build steps -> one `turbo run build compile --filter`. An earlier draft added `turbo run build` to four more jobs for robustness and was reverted: each would have rebuilt the grammar and re-downloaded the 119MB wasi-sdk, and those jobs already, correctly, trust the install job's SHA-keyed workspace blob. Persisting .turbo via actions/cache and the --filter wiring are R5's.

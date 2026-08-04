# Feature 42 — npm Workspaces + Turborepo Task Orchestration

> **Status: PROPOSED** (raised 2026-08-04) — raised while investigating CI and
> local full-suite execution time.
>
> **State this PRD was checked against:** `main` at `b95cae5a`
> (branch `fix/wasi-sdk-ci-cache`).
>
> **Recommendation.** Proceed in two phases that are each independently
> shippable: consolidate the ten `tooling/*` packages onto npm workspaces
> first (R1–R3), then layer Turborepo's dependency graph and content-hash
> cache on top (R4–R6). Phase one alone already fixes a real, measured cost
> (lockfile sprawl); phase two is where the CI/local wall-clock win actually
> lands.
>
> **What this feature is not.** It changes no Satsuma language syntax, no CLI
> output, no test assertions, and no published package's runtime behavior.
> It does not adopt a remote/hosted cache (see Non-goals) and does not
> replace npm with pnpm or yarn.

## Goal

Cut CI wall-clock time and local full-suite execution time by removing two
sources of unnecessary, repeated work:

1. Ten packages are installed independently (separate `node_modules`,
   separate lockfiles) instead of once with hoisted, deduplicated
   dependencies.
2. Cross-package builds are ordered by hand-written npm script chains
   instead of a dependency graph, and every push re-runs every package's
   full test suite regardless of what changed.

## Background — measured state

### Ten packages, ten lockfiles, one hand-rolled linking scheme

Every `tooling/*` package that depends on another already declares it via
`file:../<package>` in its own `package.json` — this repo is manually
emulating what workspaces do natively:

| Package | Depends on (via `file:../X`) |
|---|---|
| `@satsuma/core` | `@satsuma/scenario-gen` |
| `@satsuma/viz-model` | `@satsuma/core` |
| `@satsuma/viz-backend` | `@satsuma/core`, `@satsuma/viz-model`, `@satsuma/scenario-gen` |
| `@satsuma/viz` | `@satsuma/core`, `@satsuma/viz-model`, `@satsuma/viz-backend`, `@satsuma/scenario-gen` |
| `@satsuma/viz-harness` | `@satsuma/core`, `@satsuma/viz-model`, `@satsuma/viz-backend` |
| `@satsuma/lsp` | `@satsuma/core`, `@satsuma/viz-model`, `@satsuma/viz-backend` |
| `satsuma-cli` | `@satsuma/core`, `@satsuma/scenario-gen`, `@satsuma/viz-backend` |
| `vscode-satsuma` | `@satsuma/core`, `@satsuma/lsp` |

Each package also carries its own `package-lock.json` — 11 in total
(`.` root, `site/`, and 9 of the 10 `tooling/*` packages), plus a 12th
inside `.worktrees/gcsc-qka8/`. A dependency shared across packages
(`typescript`, `eslint`, `c8`, …) is bumped independently in each lockfile,
which is the most likely explanation for why prior dependabot cleanup
rounds needed 8–25 separate PRs per batch (see memory:
`dependabot-batch-2026-07-13`, `-07-22`, `-07-31`) rather than one PR per
shared dependency.

### Build order is hand-sequenced, and the sequencing is fragile enough to need a workaround

`ci:all` in the root `package.json` installs the CLI with
`npm ci --ignore-scripts --prefix tooling/satsuma-cli` — deliberately, because
`satsuma-cli`'s own `prepare` script runs `build:core && build:viz-backend`
(`tooling/satsuma-cli/package.json`), which would otherwise fire mid-install,
before `@satsuma/core` and `@satsuma/viz-backend` have their own dependencies
installed. The correct order is instead re-derived by hand in two places that
must be kept in sync:

- `install:all` / `ci:all` (root `package.json`): install → build core →
  build viz-backend → build tree-sitter WASM → copy WASM into CLI dist +
  `tsc` → build viz → …
- the `install` job in `.github/workflows/ci.yml` (lines 23–44): the same
  sequence, repeated.

Nothing enforces that these two copies of the build order stay identical;
they have already needed independent maintenance (see the `prebuild ran
before WASM existed` comment on `ci.yml:38`).

### CI caching restores everything, for every job, keyed on nothing reusable

Every job in `ci.yml` (`lint`, `satsuma-cli`, `parser`, `vscode-extension`,
`cli-pack-smoke-test`, `smoke-tests`, `stm-to-excel-skill`, the
`tooling-modules` matrix) restores the *same* full cache blob — all ten
packages' `node_modules` plus every build output — via
`actions/cache/restore` keyed on `workspace-${{ github.sha }}`, with no
`restore-keys` fallback. Two consequences:

1. Every commit is a guaranteed cache miss in the `install` job (the key
   never matches a prior run), so `ci:all`'s nine separate `npm ci` calls
   run from scratch on every push.
2. Jobs that only need a subset of packages (e.g. `parser` needs none of
   `vscode-satsuma`'s dependencies) still pay to restore the entire blob.

### No affected-only execution, locally or in CI

A commit that only touches `tooling/satsuma-viz` still runs the full
`tooling-modules` matrix, the full CLI suite (1031 tests), the full parser
corpus (318 tests), and the full LSP suite (300 tests) — there is no
mechanism, locally or in CI, that skips a package whose inputs did not
change.

## Non-goals

- No change to Satsuma language semantics, CLI/LSP/viz output, or any test
  assertion — this feature must not "make CI green" by weakening a check.
- No migration off npm (staying on npm workspaces; pnpm/yarn are out of
  scope unless R1 surfaces a concrete blocker only they solve).
- No remote/hosted Turborepo cache (Vercel Remote Cache or self-hosted) in
  this iteration — confirmed out of scope for now. Local `.turbo` cache,
  persisted across CI runs via `actions/cache`, is in scope and is expected
  to deliver most of the win without adding a third-party service or new
  infra to operate. Revisit as a follow-on feature if local caching proves
  insufficient.
- No change to how `tooling/tree-sitter-satsuma` skips its native/node-gyp
  build (ADR-002) — R1 must confirm hoisting doesn't reintroduce a native
  build attempt, not change the existing skip.

## Success criteria

- A single root lockfile replaces the current 11 (excluding `site/`, which
  is a separate deployable and stays independent).
- `install:all` / `ci:all` collapse from nine sequential `npm ci`/`npm
  install --prefix` calls to one workspace-aware install.
- The hand-sequenced build order (core → viz-backend → WASM → CLI → viz)
  is expressed once, as a Turborepo `dependsOn` graph, and deleted from
  both `package.json` scripts and `ci.yml` — no second copy to drift out of
  sync.
- CI's `install` job cache is keyed on the (now single) lockfile hash with
  `restore-keys`, so an unrelated commit hits a warm cache instead of a
  guaranteed miss.
- A commit touching only one package's source does not re-run another,
  unaffected package's test suite in CI — verified by a scoped test (make a
  no-op change under `tooling/satsuma-viz` only, confirm `turbo run test`
  reports the other packages as cached/skipped).
- `vscode-satsuma` still builds and packages correctly (`vsce package` or
  equivalent, plus the existing `cli-pack-smoke-test`-style install smoke
  check) after the `node_modules` layout changes — this is the specific
  regression risk flagged during scoping.
- `tooling/tree-sitter-satsuma`'s WASM-only build path (no native/node-gyp
  build, per ADR-002) is unchanged after hoisting.
- Baseline CI wall-clock time (`install` job + total pipeline) is captured
  before R2 lands, so the improvement from R2 and again from R4–R5 is a
  measured delta, not a claim.
- All existing tests pass unchanged; no test is skipped, weakened, or
  deleted to make this migration land.

## Proposed rollout

Each ticket should be independently mergeable and independently valuable —
R1–R3 (workspaces) must not be blocked on R4–R6 (Turborepo) being ready.

1. **R1 — Investigation spike.** Audit shared-dependency versions across all
   ten `package.json` files for hoisting conflicts (`typescript`, `eslint`,
   `c8`, `web-tree-sitter`, …); inventory every install-order-sensitive
   script (`satsuma-cli`'s `prepare` → `build:core`/`build:viz-backend`,
   `tree-sitter-satsuma`'s node-gyp skip); capture the CI baseline timing
   named in Success criteria. Output: a short findings note and, since
   adopting workspaces is an architectural decision, an ADR draft (see
   `/adr-draft`).
2. **R2 — Migrate to npm workspaces.** Add `"workspaces"` to the root
   `package.json`; replace `file:../X` cross-package deps with
   workspace-resolved version ranges; consolidate to one root lockfile;
   rewrite `install:all`/`ci:all`/`clean:all`; update `ci.yml`'s cache
   step(s) to key on the root lockfile hash with `restore-keys`.
3. **R3 — Verify `vscode-satsuma` packaging.** Confirm the extension still
   builds and packages correctly under hoisted `node_modules` before
   treating R2 as done; this is the one package where layout-sensitivity is
   a known risk, not a hypothetical.
4. **R4 — Introduce Turborepo.** Add `turbo.json` with per-package
   `build`/`test`/`test:coverage`/`lint` pipeline entries and `dependsOn:
   ["^build"]` wiring that replaces the hand-sequenced chain from
   Background; adopt Turborepo's local content-hash cache.
5. **R5 — Wire Turborepo into CI.** Replace or augment the existing
   per-package job/matrix structure in `ci.yml` with `turbo run test
   --filter=...`-style invocations (exact shape TBD in R4/R5 — may keep the
   existing matrix and let Turborepo's cache short-circuit unaffected
   packages within each job, rather than restructuring the workflow's job
   graph); persist `.turbo` via `actions/cache`; measure and record the
   before/after wall-clock delta against the R1 baseline.
6. **R6 — Docs.** Update `AGENTS.md`, `HOW-DO-I.md`, and the worktree setup
   instructions (`npm run install:all` references) to match the new
   single-command install and Turborepo-driven build/test flow.

## Risks

- **`vscode-satsuma` packaging** is sensitive to `node_modules` layout
  (hoisted vs. nested); explicitly gated by R3 rather than assumed safe.
- **Migration review surface** touches every package's `package.json` plus
  the root CI workflow in one logical change — recommend a dedicated
  worktree per this repo's convention, and landing R1–R3 as their own PR
  before starting R4.
- **`tree-sitter-satsuma`'s deliberate native-build skip** (ADR-002) must
  survive hoisting; R1 confirms this before R2 changes anything.
- **Two copies of the build order** (`package.json` scripts and `ci.yml`)
  currently exist because nothing enforces they match; until R4 lands, R2
  still has to keep both in sync manually — R2 does not fix this on its
  own, only R4 does.

## Open questions

- Exact CI restructuring in R5 (replace the job/matrix structure vs. keep
  it and let Turborepo's cache do the skipping within existing jobs) is
  left to be decided once R4's pipeline shape is concrete, rather than
  fixed here.
- Whether local-only Turborepo caching (this iteration's scope) delivers
  enough of the win to make a future remote-cache feature unnecessary, or
  whether it becomes a follow-on ask once R5's measurements are in.

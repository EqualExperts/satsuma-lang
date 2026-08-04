# ADR-049 — npm Workspaces + Turborepo for Monorepo Build Orchestration

**Status:** Accepted
**Date:** 2026-08-04 (feature 42)

## Context

The repository's ten `tooling/*` packages are each installed independently:
every package that depends on another declares it via
`"@satsuma/core": "file:../satsuma-core"`-style references in its own
`package.json`, and each package carries its own `package-lock.json` — 11
lockfiles in total across the root, `site/`, and nine of the ten `tooling/*`
packages. This is a hand-rolled emulation of what workspaces do natively: one
package manually re-declares a local sibling as a dependency instead of the
tool resolving it by name.

The manual scheme is fragile in a way that has already required its own
workaround. `satsuma-cli`'s `prepare` script runs `build:core &&
build:viz-backend`, which would fire mid-install — before `@satsuma/core` and
`@satsuma/viz-backend` have their own dependencies installed — if not for
`ci:all` explicitly installing the CLI with `--ignore-scripts`. The correct
build order (install → build core → build viz-model/viz-backend → build
tree-sitter WASM → build cli/viz/lsp/vscode) is instead re-derived by hand in
two places that must be kept in sync: the root `package.json`'s
`install:all`/`ci:all` scripts, and the `install` job in
`.github/workflows/ci.yml`. Nothing enforces they match; they have already
needed independent fixes (see the "prebuild ran before WASM existed" comment
on `ci.yml`).

The lockfile sprawl has a measurable cost: a dependency shared across
packages (`typescript`, `eslint`, `c8`, …) must be bumped independently in
each lockfile, which is the most plausible explanation for why prior
dependabot cleanup rounds needed 8–25 separate PRs per batch rather than one
PR per shared dependency. Separately, CI's cache step
(`actions/cache/restore`, keyed on `workspace-${{ github.sha }}` with no
`restore-keys`) is a guaranteed miss on every commit, and every job restores
the full cache blob for all ten packages regardless of which subset it
actually needs. There is also no mechanism, locally or in CI, that skips a
package whose inputs haven't changed — a commit touching only
`tooling/satsuma-viz` still runs the full CLI, parser, and LSP suites.

Two alternatives were considered and set aside. Switching package managers
(pnpm or yarn workspaces) was rejected: no blocker specific to npm was found
during investigation that a package-manager switch would solve and npm
workspaces would not, and a package-manager migration is strictly larger and
riskier than the problem requires. Nx was considered as the task-orchestration
layer instead of Turborepo: Nx's project-graph visualization and generator
tooling solve problems this repository doesn't have, whereas the actual need
— topological build ordering plus content-hash task caching — is exactly
Turborepo's `dependsOn` pipeline model. A hosted/remote Turborepo cache
(Vercel Remote Cache or a self-hosted equivalent) was also considered and
deferred: it would improve cross-run and cross-contributor cache-hit rates
further, but introduces a new external service (or infrastructure to
operate) that isn't justified until local caching is measured and found
insufficient.

## Decision

Adopt npm workspaces for the ten `tooling/*` packages. The root
`package.json` declares `"workspaces": ["tooling/*"]`; the `file:../X`
cross-package references are replaced with workspace-resolved version
ranges that npm links automatically by package name; one root
`package-lock.json` replaces the current 11 for these packages. `site/` is a
separate deployable and is explicitly excluded from the workspaces array —
it keeps its own lockfile.

Adopt Turborepo on top of the workspaces tree. A root `turbo.json` defines
per-package `build`, `test`, `test:coverage`, and `lint` tasks, with
`dependsOn: ["^build"]` wiring that expresses the cross-package build order
exactly once — replacing both hand-maintained copies (the root
`package.json` script chain and the `install` job in `ci.yml`). Turborepo's
cache is local-only for this iteration: results are cached by content hash
in `.turbo`, persisted across CI runs via `actions/cache`, with no
remote/hosted cache service introduced. CI's existing per-package job/matrix
structure in `ci.yml` is retained; individual steps are routed through
`turbo run <task> --filter=...` so that a package whose inputs are unchanged
is skipped (cache hit) rather than always re-executed, both in CI and
locally.

## Consequences

**Positive:**

- One lockfile replaces 11 for the `tooling/*` packages; a shared-dependency
  bump becomes one PR instead of a batch spread across many lockfiles.
- Cross-package build order is expressed once, as data (`turbo.json`'s
  `dependsOn` graph), rather than as two hand-written script chains that can
  silently drift apart.
- A commit touching only one package's source no longer forces every other
  package's full test suite to re-run, in CI or locally.
- The `--ignore-scripts` workaround for `satsuma-cli`'s install, and the
  class of ordering bug behind the "prebuild ran before WASM existed"
  comment, are eliminated by construction: Turborepo topologically runs a
  dependency's `build` before a dependent's task, so there is no window
  where a `prepare`/`postinstall` script can fire out of order.

**Negative:**

- The migration touches every package's `package.json` plus the CI workflow
  in one logical change; this is mitigated by landing the workspaces
  consolidation (R1–R3) and the Turborepo introduction (R4–R6) as separate
  PRs rather than one.
- `vscode-satsuma`'s extension packaging (`vsce`) is known to be sensitive to
  `node_modules` layout; hoisting must be verified not to break it before the
  migration is considered complete — this is tracked as its own gating step
  (feature 42, R3), not assumed safe.
- Local-only caching means CI runners get a weaker cache-hit rate than a
  remote cache would provide, since GitHub-hosted runners are ephemeral
  beyond what `actions/cache` persists. This is an accepted tradeoff for this
  iteration, not a limitation of Turborepo itself — a remote cache remains
  available as a future addition if measurements show local caching is
  insufficient.
- `tooling/tree-sitter-satsuma`'s deliberate skip of a native/node-gyp build
  (ADR-002) must be re-verified under the hoisted `node_modules` layout, to
  confirm hoisting does not reintroduce a native build attempt.

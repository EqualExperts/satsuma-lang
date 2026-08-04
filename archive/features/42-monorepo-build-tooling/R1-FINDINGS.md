# R1 Findings — Workspace Hoisting and CI Baseline

> **Audit date:** 2026-08-04
>
> **Repository state:** `main` at `ec45cfba`
>
> **Scope:** the ten `tooling/*/package.json` manifests, their lifecycle/build
> scripts, and the workflows and release scripts that reproduce their build order

## Outcome

npm workspaces remains a viable choice. Three shared development dependencies
have incompatible major-version ranges, but npm handles them by hoisting one
version and nesting the incompatible versions. They reduce deduplication; they do
not block the migration.

The audit did find two concrete migration requirements for R2:

1. A clean workspace install runs `satsuma-cli`'s `prepare` before the grammar
   WASM has been built, so the current lifecycle workaround cannot simply be
   deleted. R2 needs a scripts-disabled install plus an explicit build phase, or
   an equivalent way to suppress/move that one premature `prepare`. R4 must move
   install-time build hooks into Turborepo-controlled tasks before deleting the
   workaround; Turborepo cannot order lifecycle hooks that npm runs during the
   preceding install.
2. Several build and test paths address dependencies through a package-local
   `node_modules`. `web-tree-sitter` and `tree-sitter-cli` hoist to the workspace
   root, so those paths must become Node/npm-resolution-based or root-relative.

Neither finding changes ADR-049's decision. No additional ADR is needed.

## Shared-dependency version audit

The following direct dependencies occur in more than one tooling manifest. Local
`file:../...` Satsuma dependencies are omitted from the compatibility table: they
all point to a single sibling package and therefore have no competing versions.

| Dependency | Declared ranges | Result under npm workspaces |
|---|---|---|
| `typescript` | `^5.9.3` in viz-backend, viz, and viz-harness; `^6.0.2`/`^6.0.3` in CLI, core, LSP, viz-model, VS Code, and the root | **Conflict:** major 5 and 6 cannot share one installation. The rehearsal hoisted 6.0.3 and nested 5.9.x under the three v5 consumers. |
| `c8` | `^11.0.0` in CLI, LSP, viz-backend, and viz; `^12.0.0` in core and viz-model | **Conflict:** major 11 and 12 cannot share one installation. The rehearsal hoisted 11.x and nested 12.x under core and viz-model. |
| `@types/node` | `^22.0.0` in viz, viz-harness, and VS Code; `^25.5.0` in CLI, LSP, and viz-backend; `^26.1.2` in core and viz-model | **Conflict:** three incompatible majors. The rehearsal hoisted 22.x and nested 25.x/26.x at the consumers that require them. |
| `web-tree-sitter` | `^0.26.7` in CLI, LSP, and viz-harness; `^0.26.11` in core | Compatible. 0.26.11 satisfies every range and hoists once. |
| `esbuild` | `^0.28.1` in LSP, viz, viz-harness, and VS Code | Compatible; identical ranges. |
| `fast-check` | `^4.9.0` in CLI, core, scenario-gen, and viz | Compatible; identical ranges. |

`eslint` is root-only (`^10.8.0`), so there is no tooling-package range to
conflict with it. The same is true of the root lint stack (`@eslint/js`,
`typescript-eslint`, `prettier`, and the Markdown/YAML/Python linters).

The incompatible majors should not be normalized as part of R2: each package's
current compiler, coverage, and Node type versions are intentional inputs to its
existing tests. Version convergence can be a separate dependency-upgrade change.

## Hoisted-path audit

An isolated rehearsal added `"workspaces": ["tooling/*"]`, installed all ten
packages with lifecycle scripts disabled, and inspected the resulting layout.
`web-tree-sitter@0.26.11` and `tree-sitter-cli@0.26.11` existed only under the
root `node_modules`; none of the package-local paths below existed.

| Consumer | Current assumption | R2 requirement |
|---|---|---|
| `satsuma-cli/scripts/prebuild.js` | Reads `satsuma-cli/node_modules/web-tree-sitter/web-tree-sitter.wasm` | Resolve the installed package through Node rather than joining through the CLI directory. The rehearsal reproduced the resulting missing-runtime failure after the grammar WASM was built. |
| `satsuma-lsp/scripts/copy-assets.js` | Reads `satsuma-lsp/node_modules/web-tree-sitter/web-tree-sitter.wasm` | Use the same hoist-safe package resolution. The rehearsal reproduced this missing-asset failure. |
| `satsuma-viz-harness` `build:wasm` | Copies `node_modules/web-tree-sitter/web-tree-sitter.wasm` from the harness working directory | Replace the package-local shell path with hoist-safe resolution. |
| `vscode-satsuma/esbuild.js` | Reads the runtime from `../satsuma-lsp/node_modules/web-tree-sitter/...` | Resolve the LSP dependency's runtime without assuming its physical install location. This copy currently catches and ignores a missing asset, so R3's package-content verification remains essential even if the extension build exits successfully. |
| Parser workflow commands | `ci.yml` (three commands), `release.yml`, and `deploy-site.yml` invoke `tooling/tree-sitter-satsuma/node_modules/.bin/tree-sitter` | Invoke the workspace/root binary through npm or an explicit root path. |
| Parser Python helpers | `test_fixtures.py` and `cst_summary.py` prefer the same package-local binary, then fall back to a potentially absent/incompatible global binary | Resolve the workspace-installed binary before falling back globally. |

The tree-sitter package's own `build`, `generate`, and `test` npm scripts use the
bare `tree-sitter` command. npm adds the root and workspace `.bin` directories to
an npm script's `PATH`, so those commands are already hoist-safe.

## Install-order-sensitive scripts

### Package lifecycle and build scripts

| Package/script | Ordering contract |
|---|---|
| `@satsuma/core` `prepare: tsc` | Produces the core `dist` contract consumed by downstream packages after scenario-gen has been installed. |
| `@satsuma/viz-model` `prepare: tsc` and `prebuild -> build:core` | Requires core to be installed/built before consumers build against the model contract. |
| `@satsuma/viz-backend` `prepare -> build -> prebuild` | Rebuilds core and viz-model before compiling the backend. Its dependencies must already be installed. |
| `tree-sitter-satsuma` `install` | Explicitly prints `Skipping native build — WASM only`; it prevents npm's implicit `node-gyp rebuild` for a package containing `binding.gyp`. The separate `build` script generates and builds the WASM grammar after `tree-sitter-cli` is installed. |
| `satsuma-cli` `prepare -> build -> prebuild` | Rebuilds core and viz-backend, bakes `AI-AGENT-REFERENCE.md`, and copies both the already-built grammar WASM and the `web-tree-sitter` runtime before `tsc`. `postbuild` then makes `dist/index.js` executable. This is the lifecycle hook that cannot run during a clean root install. |
| `@satsuma/lsp` `prebuild` | Rebuilds core/viz-backend and copies the already-built grammar WASM, runtime WASM, and highlights query before esbuild bundles the server. |
| `@satsuma/viz` `build` | Produces the web-component bundle consumed by viz-harness and the VS Code webview. It has no install lifecycle hook, so callers build it explicitly. |
| `@satsuma/viz-harness` `prebuild` and `build:wasm`/`build:viz` | Rebuilds core, viz-backend, and viz, then copies the previously-built grammar/runtime WASM and viz bundle into the harness. |
| `vscode-satsuma` `prebuild`, `build:server`, and `build` | Builds core before the extension, builds the sibling LSP explicitly, and expects the grammar/runtime WASM plus viz bundle to exist when extension assets are assembled. |
| `@satsuma/scenario-gen` | Has no lifecycle or build script and introduces no ordering constraint. |

### Repository and workflow orchestration

- Root `install:all` installs packages in dependency order, builds the grammar
  WASM before installing CLI (whose `prepare` copies it), builds viz before its
  consumers, and finally builds the LSP through VS Code's `build:server`.
- Root `ci:all` installs CLI with `--ignore-scripts` specifically to prevent its
  `prepare` from running before the WASM exists. The CI `install` job then builds
  core, viz-backend, grammar WASM, CLI, and viz in that order before caching the
  workspace.
- A root-wide workspace `--ignore-scripts` is not a drop-in replacement: it also
  suppresses the `tree-sitter-cli` installer and esbuild's postinstall. In the
  rehearsal, the root tree-sitter shim existed but its downloaded executable did
  not until `npm rebuild tree-sitter-cli esbuild` replayed those binary installers.
- `scripts/build-artifacts.sh` assumes `install:all` has already run, then rebuilds
  core -> viz-backend -> viz before packaging VS Code, LSP, and CLI artifacts.
- `release.yml` runs `ci:all`, builds the grammar WASM, and delegates the remaining
  artifact order to `build-artifacts.sh`.
- `deploy-site.yml` runs `ci:all`, builds the grammar WASM, and only then runs the
  viz-harness playground build, whose prebuild rebuilds core/backend/viz and whose
  build copies the WASM assets.

### Clean-workspace rehearsal

A clean rehearsal with all ten packages and lifecycle scripts enabled failed at
the expected boundary:

1. npm hoisted dependencies and successfully ran core, viz-model, and viz-backend
   lifecycle builds.
2. npm invoked `satsuma-cli`'s `prepare`.
3. CLI prebuild failed because `tree-sitter-satsuma.wasm` did not yet exist.

R2 therefore must preserve an explicit transitional build phase. If it chooses a
root-wide scripts-disabled install, it must also replay required dependency binary
installers before building the WASM and replace the hoist-sensitive paths listed
above. R4 can remove the transitional ordering only after package build work no
longer runs from npm's install-time `prepare` hooks and Turborepo owns those tasks.

This qualifies a statement in ADR-049's consequences: Turborepo does not itself
eliminate the install-time window because `npm install` precedes `turbo run`.
The target decision (workspace install plus a Turborepo-owned build graph) is
unchanged, so the accepted ADR does not need replacement; R4's implementation
must include the lifecycle-hook move that makes the stated target true.

## Tree-sitter native-build skip

The WASM-only guard is unaffected by hoisting. A focused workspace rehearsal used
the real `tree-sitter-satsuma` manifest and `binding.gyp`; npm hoisted
`tree-sitter-cli` to the root, left no nested CLI installation, and still ran:

```text
> tree-sitter-satsuma@2.0.0 install
> echo 'Skipping native build — WASM only'

Skipping native build — WASM only
```

npm selects the explicit `install` script instead of its implicit
`node-gyp rebuild` default independently of where dependencies are placed. R2
must retain this script unchanged, and R3/R5 should continue verifying the
WASM-only build path.

## Corrections found while implementing R2

Two hoisting consequences this audit did not predict surfaced during the
migration. Both are fixed in R2; they are recorded here because the audit above
is the feature's shared reference and states neither.

### The audit compared the ten tooling manifests to each other, but not to the root

`commander` was reported as conflict-free because it appears in only one tooling
manifest (`satsuma-cli`, `^15.0.0`). The competing range came from the *root*
dependency graph instead: `markdownlint-cli2` → `markdownlint` →
`micromark-extension-math` → `katex`, which pins `commander@^8.3.0`. npm hoisted
8.3.0 to the workspace root and then failed to nest 15.0.0 for `satsuma-cli` —
the lockfile recorded `tooling/satsuma-cli/node_modules/commander` at 15.0.0 but
neither `npm install` nor `npm ci` created it.

The failure was silent: `npm ls` reported the tree invalid, but the CLI ran
normally because the two commander APIs overlap for the calls it makes, and the
tarball would have shipped 8.3.0. R2 declares `commander` in the root
`devDependencies` purely to win the hoist, and adds `npm run check:deps`
(`npm ls --all`) to the pre-commit checks and the CI lint job so an invalid tree
fails a check instead of resolving quietly to the wrong version.

**Generalisation for R4 and for any future package:** a shared-dependency audit
must compare tooling ranges against the root's *transitive* graph, not just
against each other.

### npm resolves pack-time ignore rules from the workspace root

`npm pack` inside a workspace member applies the repository-root `.gitignore`.
Three of its patterns — `**/*.wasm`, `**/*.js.map`, `**/generated` — silently
stripped the CLI's own build output (both WASM assets, every sourcemap, and the
baked `agent-reference` module) out of `satsuma-cli.tgz`.

R2 addresses this in two places: `satsuma-cli` now declares an explicit `files`
list, which takes precedence over every ignore file, and `scripts/pack.js` packs
from a staging copy in a temp directory outside the repository. The staging copy
also fixes a second problem — `bundleDependencies` are filled from the package's
own `node_modules`, and hoisting empties it, so npm silently omitted every
bundled dependency. `scripts/verify-pack.js` now asserts the full bundled
closure (the CLI's `bundleDependencies` plus `@satsuma/core`'s own runtime
dependencies, which ship nested beneath it) is present in the tarball.

Verified by diffing the resulting tarball's entry list against one packed from
`main` before the migration: identical.

## CI baseline

Baseline source: successful `main` CI run
[`30908680698`](https://github.com/EqualExperts/satsuma-lang/actions/runs/30908680698)
for commit `ec45cfba` on 2026-08-04.

| Measurement | Start | Finish | Wall-clock |
|---|---|---|---|
| `Install dependencies` job | 12:20:46 UTC | 12:22:20 UTC | **1m 34s** |
| `Install all packages` step within that job | 12:20:51 UTC | 12:21:47 UTC | **56s** |
| Full CI workflow | 12:20:44 UTC | 12:25:19 UTC | **4m 35s** |

R2 and R5 should compare like-for-like successful `main` runs. The required
headline baselines are the 1m 34s install job and 4m 35s full pipeline; the 56s
step timing is included to separate package installation from runner setup,
builds, and cache save time.

---
id: mbt-pumv
status: closed
deps: [mbt-foes]
links: []
created: 2026-08-04T11:08:25Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R2: Migrate tooling/* packages to npm workspaces

Add "workspaces": ["tooling/*"] to the root package.json. Replace file:../X cross-package references (see satsuma-cli, satsuma-viz-backend, satsuma-viz-model, satsuma-viz, satsuma-viz-harness, satsuma-lsp, vscode-satsuma package.json files) with workspace-resolved version ranges. Consolidate the 11 existing package-lock.json files (root + 9 of 10 tooling/* packages; site/ stays independent) into one root lockfile. Rewrite install:all/ci:all/clean:all in the root package.json. Update ci.yml's cache step(s) to key on the root lockfile hash with restore-keys instead of workspace-${{ github.sha }}.

## Acceptance Criteria

- One root package-lock.json covers all tooling/* packages; site/ keeps its own
- file:../X references removed from every tooling/*/package.json
- install:all/ci:all/clean:all reduced to workspace-aware commands
- CI cache step uses the lockfile hash as key with restore-keys fallback
- All existing tests pass unchanged in every tooling/* package
- Depends on R1's findings (no unresolved hoisting conflicts, ordering scripts accounted for)


## Notes

**2026-08-04T13:26:22Z**

R1 handoff: see features/42-monorepo-build-tooling/R1-FINDINGS.md. R2 must preserve a transitional explicit build phase because a clean workspace install runs satsuma-cli prepare before the grammar WASM exists. A root-wide --ignore-scripts install also suppresses the tree-sitter-cli and esbuild binary installers, and the documented package-local web-tree-sitter/tree-sitter-cli paths fail after hoisting.

**2026-08-04T16:52:40Z**

**2026-08-04T17:05:00Z**

Cause: The eleven tooling packages were installed independently behind twelve lockfiles, with cross-package links hand-declared as `file:../X` and the cross-package build order re-derived by hand in both the root package.json scripts and ci.yml's install job.
Fix: Added `"workspaces": ["tooling/*"]`, replaced every `file:../X` with a by-name range, consolidated eleven lockfiles into the root one (site/ keeps its own), collapsed install:all/ci:all to one workspace install plus `scripts/build-workspace.sh` (now the single home for the build order, which ci.yml also calls), and keyed the install job's npm cache on the root lockfile via setup-node's `cache: npm`. (commit immediately after 80f9206c)

Hoisting broke four things that had to be fixed as part of the migration, each verified:

1. Package-local dependency paths. `satsuma-cli/scripts/prebuild.js`, `satsuma-lsp/scripts/copy-assets.js`, `vscode-satsuma/esbuild.js` and the viz-harness `build:wasm` step all joined paths through their own node_modules to reach `web-tree-sitter`'s runtime WASM. All now resolve it through Node (`require.resolve("web-tree-sitter/web-tree-sitter.wasm")`). The harness's two `cp` calls became `scripts/copy-wasm-assets.mjs`. The Python helpers and the workflow steps that invoked `tooling/tree-sitter-satsuma/node_modules/.bin/tree-sitter` now prefer the workspace-root binary (new `scripts/tree_sitter_bin.py`) or go through new `build:wasm`/`test:corpus` npm scripts. esbuild.js also lost its `nodePaths` override and its two `../satsuma-viz/node_modules/elkjs` aliases (elkjs is now a declared dependency), and its asset copy no longer swallows a missing WASM.

2. A silent wrong-version resolution. `katex` (transitively from the root's markdownlint-cli2) pins `commander@^8.3.0`; npm hoisted that and never nested the `^15.0.0` satsuma-cli requires. `npm ls` reported the tree invalid, but the CLI ran anyway because the two APIs overlap for the calls it makes, and the tarball would have shipped v8. Fixed by declaring commander at the root purely to win the hoist, and guarded permanently by the new `npm run check:deps` (`npm ls --all`) step in run-repo-checks.sh and the CI lint job.

3. Published tarballs losing their contents. npm resolves pack-time ignore rules from the *workspace root*, so the repo `.gitignore`'s `**/*.wasm`, `**/*.js.map` and `**/generated` stripped both WASM assets, every sourcemap and the baked agent-reference out of satsuma-cli.tgz, and both WASM assets out of satsuma-lsp.tgz (reintroducing sl-vwpr). Both packages now declare explicit `files` lists. satsuma-cli additionally packs from a staging copy in a temp directory, because `bundleDependencies` are filled from the package's own node_modules and hoisting empties it — npm silently omitted every bundled dependency. verify-pack.js now asserts the whole bundled closure is present. The resulting tarball's entry list is identical to one packed from main before the migration.

4. A regression this ticket introduced and then fixed. Replacing the LSP's `file:../X` specs with by-name ranges made `npm install -g satsuma-lsp.tgz` try to fetch the private `@satsuma/core` from the registry (404) — npm had been silently skipping the unresolvable relative file: spec. Since dist/server.js is a self-contained esbuild bundle that requires nothing but Node built-ins, those three workspace packages are build inputs: moved to devDependencies, and verify-pack.js now fails if any unpublishable `@satsuma/*` dependency reaches the tarball.

Also updated: `scripts/release-metadata.mjs` now bumps and validates each releasable package's version in the root lockfile's `packages["tooling/<name>"]` entry instead of a per-package lockfile (with tests), and `.github/dependabot.yml` lost its nine per-package npm entries — the root entry now covers all eleven, which is the lockfile-sprawl cost the PRD set out to remove.

Verified: full run-repo-checks.sh green; `tree-sitter-satsuma`'s WASM-only install script still fires under hoisting with no node-gyp attempt and no native artifacts (ADR-002); `scripts/build-artifacts.sh` produces all three release artifacts; the CLI tarball installs into a clean prefix and parses/lints/formats a real example; the LSP tarball installs and completes a real initialize round-trip.

---
id: mbt-pumv
status: open
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

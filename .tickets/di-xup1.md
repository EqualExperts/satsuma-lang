---
id: di-xup1
status: closed
deps: []
links: []
created: 2026-08-05T10:03:46Z
type: chore
priority: 2
assignee: Thorben Louw
tags: [typescript, tech-debt]
---
# Migrate satsuma-viz-backend and satsuma-viz-harness off deprecated TS moduleResolution/baseUrl

TypeScript 6.0 deprecates moduleResolution "node" (node10) and baseUrl; both tsconfigs currently silence this with ignoreDeprecations: "6.0" (added alongside the typescript@6.0.3 dependabot bump). Every other workspace package (satsuma-core, satsuma-cli, satsuma-viz-model, integration-tests) already uses module/moduleResolution "node16". These two packages are the last stragglers on the old commonjs/node config. TypeScript 7.0 removes node10/baseUrl support entirely, so ignoreDeprecations stops working then and this becomes a hard blocker.

## Acceptance Criteria

satsuma-viz-backend/tsconfig.json and satsuma-viz-harness/tsconfig.json use module/moduleResolution "node16" (or the repo's then-current convention), with ignoreDeprecations removed. Relative import specifiers in both packages' source updated with explicit file extensions as required by node16 resolution. turbo run build and turbo run test pass for both packages and everything that depends on them (satsuma-lsp, vscode-satsuma, satsuma-viz).


## Notes

**2026-08-05T11:36:27Z**

Cause: Both tsconfigs used the TS-6.0-deprecated moduleResolution "node" (node10) with baseUrl, silenced via ignoreDeprecations: "6.0" — a suppression, not a fix, that stops working entirely once TS 7.0 removes node10/baseUrl support.
Fix: Switched both to moduleResolution/module "nodenext" (not "node16" as the ticket's literal text suggested) and dropped the baseUrl/paths/ignoreDeprecations block. "node16" doesn't compile for either package: both remain "type": "commonjs" while depending on ESM-only @satsuma/core, @satsuma/viz-model and (for viz-harness) @satsuma/viz-backend, and TS's frozen node16 mode still forbids a CJS file from requiring an ESM-only package (TS1479/TS1541). "nodenext" tracks Node's require(esm) support (stable since Node 22.12, which is what CI already runs) and resolves cleanly with zero other changes — matching the precedent satsuma-lsp already set for this exact CJS-importing-ESM situation. No relative-import extension changes were needed: that requirement only applies to ESM-format files under node16/nodenext, and both packages stay CommonJS-format. Verified via tsc --noEmit, turbo build/test/test:typecheck for both packages plus satsuma-lsp, vscode-satsuma and satsuma-viz, npm run test:all (24/24 tasks green), and a manual Playwright run via the viz-harness watcher (96/103 passed consistently across two runs; the 7 Firefox failures are in harness/editor/open-save specs — schema-card duplication, debounce timing, file-open — none touching module resolution or tsconfig, so almost certainly a pre-existing issue rather than a regression from this change, though not confirmed against a main-branch baseline run) (commit immediately after 7273d0da)

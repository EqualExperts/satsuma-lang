---
id: di-xup1
status: open
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


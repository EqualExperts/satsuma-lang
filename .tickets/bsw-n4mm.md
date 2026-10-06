---
id: bsw-n4mm
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, release, vscode, supply-chain]
---
# release: @vscode/vsce is fetched unpinned at packaging time

`tooling/vscode-satsuma/scripts/package.js:50` runs `npx --yes @vscode/vsce package`. `@vscode/vsce` is in no package.json or lockfile, so every Release run fetches the latest vsce, bypassing the lockfile, `npm audit` and Dependabot.

## Acceptance Criteria

- `@vscode/vsce` is a pinned devDependency of vscode-satsuma and package.js uses the local binary.

---
id: bsw-n4mm
status: closed
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

## Notes

**2026-10-06T16:12:13Z**

Cause: `scripts/package.js` ran `npx --yes @vscode/vsce`, so each Release run packaged with whatever vsce was newest, outside the lockfile, `npm audit` and Dependabot.
Fix: Pinned `@vscode/vsce` 4.0.0 as an exact devDependency, ran its installed binary from package.js, and added `test/packaging-pin.test.js` to keep the pin and stop `npx` returning (commit immediately after aa1378df).

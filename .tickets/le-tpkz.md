---
id: le-tpkz
status: closed
deps: []
links: []
created: 2026-06-09T22:01:05Z
type: bug
priority: 1
assignee: Thorben Louw
external-ref: gh-265
---
# CLI won't start on Windows — dynamic import() of raw path (gh-265)

satsuma CLI crashes immediately on Windows with ERR_UNSUPPORTED_ESM_URL_SCHEME (Received protocol 'c:'). Reported in GitHub issue #265 by kiaroa on Node 22.22.3.

## Design

Root cause: tooling/satsuma-cli/src/index.ts:75 does `await import(join(__dirname, cmd))`. __dirname is derived via fileURLToPath(import.meta.url) and is a raw OS path, so join() yields 'C:\...\commands\lineage.js'. Node's ESM loader rejects bare Windows absolute paths in dynamic import() — they must be file:// URLs. POSIX absolute paths are tolerated, which is why macOS/Linux never hit it. Same class of bug as the feature-33 isomorphic resolver work (raw path vs file:// URL) but a different file. Check scripts/postbuild.js and any other dynamic import()/path-as-URL sites for the same pattern.

## Acceptance Criteria

index.ts wraps the command path with pathToFileURL(...).href before await import(); a regression test asserts the resolved import specifier is a file:// URL (so it would fail on the old raw-path form); CLI starts and registers all commands; existing CLI tests still pass. Comment on / close gh-265 when merged.


## Notes

**2026-06-10T02:15:00+01:00**

Cause: Duplicate — this ticket logged gh-265 from the feat/live-editor worktree before sl-2a7k was opened for the same bug on another branch.
Fix: Resolved by sl-2a7k via PR #268 (command-loader.ts pathToFileURL specifier + regression tests, commit 47cc171); gh-265 is closed. Closing as duplicate.

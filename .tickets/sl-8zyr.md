---
id: sl-8zyr
status: closed
deps: []
links: []
created: 2026-06-11T02:40:29Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: same file loaded twice via case-aliased or symlinked imports -> false duplicate-definition

satsuma-cli/src/workspace.ts:51-64 followImports keys the visited set on path.resolve only — no realpath or case canonicalization. On case-insensitive filesystems (macOS/Windows defaults), import from "lib.stm" and "LIB.stm" (or a symlink) load one physical file twice. Repro: entry importing lib.stm and LIB.stm (one file defining schema shared) -> validate reports duplicate-definition (exit 2) and summary counts 3 files (actual 2).

## Acceptance Criteria

Imports resolving to the same physical file (case alias or symlink) load once; validate clean; tests for case alias and symlink.


## Notes

**2026-06-11T22:30:00Z**

Cause: followImports keyed its visited set on path.resolve output only, so case-aliased or symlinked imports of one physical file loaded it twice, causing false duplicate-definition errors from validate and inflated file counts in summary.
Fix: canonicalize the entry and every import path with realpathSync.native (follows symlinks, restores on-disk casing) before the visited check; added case-alias and symlink regression tests (commit 774a29e)

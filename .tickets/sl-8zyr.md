---
id: sl-8zyr
status: open
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


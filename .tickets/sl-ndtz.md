---
id: sl-ndtz
status: open
deps: []
links: []
created: 2026-06-11T02:40:50Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: diff reports phantom changes for anonymous mappings; help claims imports are followed

satsuma-cli/src/index-builder.ts:294 keys anonymous mappings as <anon>@<absolute-path>:<0-based-row>, so two structurally identical files always differ in diff-engine diffBlockMap. Repro: byte-identical v1.stm/v2.stm each with one anonymous mapping -> diff reports + <anon>@.../v2.stm:2 / - <anon>@.../v1.stm:2 instead of "No structural differences." Also leaks the internal synthetic key with 0-based row into user output. Related doc bug: diff --help claims each file is resolved with its imports, but diff.ts:86-87 passes followImports:false.

## Acceptance Criteria

Identical files diff clean including anonymous mappings; user output never shows internal anon keys; help text matches actual import behaviour.


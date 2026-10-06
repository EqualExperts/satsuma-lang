---
id: bsw-t5gr
status: open
deps: []
links: []
created: 2026-10-06T09:57:03Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, docs]
---
# cli/docs: documented usage without a path argument fails, because the default '.' is a directory

`cd examples/db-to-db && satsuma summary` gives "Error resolving path '.': directory arguments are not supported" (exit 2). Every `[path]` defaults to `"."` (`load-workspace.ts:69`, `validate.ts:53`, `graph.ts:73`, `fmt.ts:62`), and ADR-022 rejects directories. Yet SATSUMA-CLI.md shows path-less usage (`satsuma schema hub_customer`, `satsuma find --tag pii`, `satsuma warnings`, the impact and PII workflows), as do the `schema --help` examples.

## Acceptance Criteria

- Decide: make the path required (clear usage error), or keep the docs always passing a file. Docs, help text and behaviour agree; test for the no-path case.

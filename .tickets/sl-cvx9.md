---
id: sl-cvx9
status: open
deps: []
links: []
created: 2026-06-10T23:21:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, core]
---
# core: normalizeMetadataValue truncates mixed metadata values to first quoted string

satsuma-core/src/meta-extract.ts:26-31 — when any nl_string child exists in a value_text, everything else is discarded (namedChildren.find on nl_string). value_text legally mixes tokens (grammar.js:590-610). Repro: (default "unknown" if null) -> value "unknown" (" if null" lost); (default "a" or "b") -> "a". Silent data loss in all extraction JSON and hover output.

## Acceptance Criteria

Mixed value_text round-trips fully (quoted strings plus surrounding tokens); tests for default "x" if null and multi-string values.


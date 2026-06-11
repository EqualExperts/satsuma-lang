---
id: sl-cvx9
status: closed
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


## Notes

**2026-06-11T12:26:18Z**

Cause: normalizeMetadataValue returned only the first nl_string/backtick child of a value_text, discarding every other token in legally mixed values like (default "unknown" if null).
Fix: unwrap delimiters only when a single child spans the entire value_text; mixed values now return the verbatim source text (quotes preserved). The whole-text quote-strip fallback no longer fires on multi-token values. (commit pending on fix/core-bug-batch)

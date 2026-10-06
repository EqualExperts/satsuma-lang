---
id: bsw-hbcb
status: closed
deps: []
links: []
created: 2026-10-06T09:57:03Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, lint, fragments]
---
# lint: unenumerated-record-target is silent when the target record's fields come from a spread

```satsuma
fragment addr_f { line1 STRING }
schema s { full_name STRING }
schema t { addr record { ...addr_f } }
mapping m { source { s } target { t }  full_name -> addr }
```

`satsuma lint --select unenumerated-record-target` prints "no issues found", while `coverage` shows `t` at 0/1. The imported-fragment variant is also silent. `endpointKind` (`tooling/satsuma-cli/src/lint-engine.ts:659`) asks `expandSpreads`, gets "unresolved" (same root cause as the nested-spread validation ticket), and skips the schema. b9f82ea7 (gpt-i1uv) only covered top-level spreads, which fire correctly.

## Acceptance Criteria

- The rule fires for record targets whose fields come from a resolvable spread, local or imported; tests added. Likely fixed by the core nested-spread ticket plus a lint test.

## Notes

**2026-10-06T10:37:02Z**

Cause: `endpointKind` asked core's `expandSpreads` whether the target schema had an unresolved spread, and core answered yes for every schema whose only spreads were nested (bsw-xivc), so the rule skipped it.
Fix: fixed at the root by bsw-xivc's core change; added a lint-engine test for a nested local spread and a two-file lint-command test for an imported fragment, both red before the fix (commit immediately after 914c97c2).

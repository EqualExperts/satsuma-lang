---
id: sl-g6ga
status: open
deps: []
links: []
created: 2026-06-10T23:21:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, core, nl-ref]
---
# core: backtick @refs containing . or :: misclassified and fail to resolve

satsuma-core/src/nl-ref.ts:182 strips backticks (rawRef.replace) and classifyRef:194-200 then keys off . and :: in the flattened string. Backtick names legally contain dots and ::. Repro: @`tax.rate` where the schema has a field literally named tax.rate -> classified dotted-field, resolveRef returns resolved:false -> false unresolved warning. @`legacy::thing` -> classified namespace-qualified-schema.

## Acceptance Criteria

Backtick-quoted refs are treated as literal names regardless of embedded . or ::; resolution tests for field names containing dots and ::.


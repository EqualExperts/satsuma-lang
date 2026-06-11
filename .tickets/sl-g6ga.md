---
id: sl-g6ga
status: closed
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


## Notes

**2026-06-11T12:45:56Z**

Cause: extractAtRefs flattened backtick quoting before classification/resolution, so classifyRef keyed off '.'/'::' embedded in literal names — @`tax.rate` classified dotted-field and failed to resolve.
Fix: AtRef now carries a raw (backtick-preserving) form; a backtick-aware parseRef tokenizer in core nl-ref.ts treats quoted spans as opaque segments, classifyRef/resolveRef derive classification and splitting from separators outside backticks, and all consumers (core validate, CLI lint/schema-graph/graph-builder, viz-model) classify/resolve on the raw form. Literal names match exactly and never as nested paths.

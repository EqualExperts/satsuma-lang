---
id: sl-d7fz
status: closed
deps: []
links: [sl-rj78]
created: 2026-08-05T09:27:33Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, viz, highlighting]
---
# viz: source fields referenced only via @ref inside an NL transform are never highlighted

A computed arrow (`-> tgt = "NL text with @refs"`, e.g. `full_name = "Concat @crm_customers.first_name + ' ' + @crm_customers.last_name... If both are null, use @company_name instead."`) is extracted with `sourceFields: []` by design — viz-backend/src/viz-model.ts:1015-1025 documents this: "the value is produced entirely by the pipe chain... we return an ArrowEntry with an empty sourceFields array".

`_sourceHighlightFields` (sz-mapping-detail.ts:392-419) only ever highlights fields listed in `sourceFields`; it never parses the transform's NL text for @refs the way `highlightAtRefs` (markdown.ts:19) does purely for display styling. So hovering/selecting a computed-arrow row highlights the target field but none of the source fields the NL text actually names via @ref — even though those refs are visibly colored in the transform text itself.

Screenshot: bug-reports/source-nlref-not-highlighted.png. Related to sl-rj78 (nested-field source highlighting) — both are gaps in the same mapping-detail highlighting logic, worth checking together.

## Acceptance Criteria

Hovering/selecting a computed-arrow row highlights every source field named by an @ref in its NL transform text, across every source schema on screen. Regression test using a computed arrow with multiple @-refs spanning more than one source schema.


## Notes

**2026-08-05T11:41:23Z**

Cause: `_sourceHighlightFields` only ever highlighted fields listed in `ArrowEntry.sourceFields`, which is always empty for a computed arrow by design (the value comes from the pipe chain) — nothing parsed the transform's NL text for @refs the way `highlightAtRefs` does for display styling, so a computed arrow's source fields never highlighted.
Fix: `_sourceHighlightFields` now extracts @refs from the hovered arrow's transform text (core's `extractAtRefs`) and resolves each one against every on-screen source schema with the same `resolveSchemaLocalFieldPath` used for declared `sourceFields`. Regression test added in field-coverage.test.js. (commit immediately after 7273d0da)

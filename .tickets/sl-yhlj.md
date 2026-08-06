---
id: sl-yhlj
status: closed
deps: []
links: []
created: 2026-08-05T09:25:20Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, viz, highlighting]
---
# viz: @refs in join/filter descriptions render as plain text, not highlighted like NL transform @refs

In sz-mapping-detail.ts the join and filter description strings are interpolated directly (`${sb.joinDescription}` at ~line 643, `${f}` at ~line 650) instead of going through `unsafeHTML(highlightAtRefs(...))` the way NL transform text (line 763) and arrow notes (line 747) do. As a result, @schema.field references inside a join or filter description render as plain unstyled text while the same style of @ref elsewhere in the mapping detail is colored/styled.

Screenshot: bug-reports/atrefs-in-join-not-highlighted.png

## Acceptance Criteria

Join and filter descriptions render @refs through highlightAtRefs, consistent with NL transform text and arrow notes. Add a fixture/unit test covering a join description containing an @ref.

## Notes

**2026-08-06T13:34:00Z**

Cause: `sz-mapping-detail.ts` interpolated `sb.joinDescription` and each filter
string directly into the Lit template instead of routing them through
`unsafeHTML(highlightAtRefs(...))`, the pipeline every other @ref-bearing
surface (NL transform text, arrow notes) already used.
Fix: wrapped both the join-description and filter render paths in
`unsafeHTML(highlightAtRefs(...))`; added a unit suite
(`mapping-detail-join-filter-refs.test.js`) that resolves the `unsafeHTML`
directive to prove the join/filter markup actually contains
`<span class="at-ref">`, and extended the existing Playwright "completed
orders (multi-source join)" test to assert a rendered `span.at-ref` inside the
join row (commit immediately after 15d143ee).


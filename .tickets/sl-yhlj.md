---
id: sl-yhlj
status: open
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


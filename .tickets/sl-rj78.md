---
id: sl-rj78
status: open
deps: []
links: [sl-d7fz]
created: 2026-08-05T09:26:38Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-hunt, viz, highlighting]
---
# viz: hovering a nested-field arrow row doesn't highlight the matching source fields

`_sourceHighlightFields`'s `_hoveredArrow` branch (sz-mapping-detail.ts:401-410) resolves highlighted fields by calling `resolveSchemaLocalFieldPath(sf, schema, m.sourceRefs)` directly on `this._hoveredArrow.sourceFields` — the RAW AUTHORED paths (e.g. ".adults", ".chicks" as written inside a `flatten`/`each` block), not the absolute paths resolved against the enclosing containers.

`resolveSchemaLocalFieldPath` only matches a raw/relative path against the schema's fully-qualified field paths by coincidence when there is no nesting. For a field nested inside `transects.sightings`, the raw ".adults" never matches the schema's real declared path (`transects.sightings.adults`), so `schemaHasFieldPath` returns false and nothing highlights.

The correct pattern already exists two functions below in the same file: `_findSourceFieldsForTarget` / `_findTargetFieldsForSource` (~450-495) go through `forEachMappingArrow`, which resolves each arrow's fields to their absolute path against the containers it is authored inside (field-coverage.ts's `MappingArrowVisit.sourceFields`) before calling `resolveSchemaLocalFieldPath`. The `_hoveredArrow` branch should do the same instead of reading `ArrowEntry.sourceFields` raw.

Screenshot: bug-reports/nested-field-not-highlighted-in-source.png

## Acceptance Criteria

Hovering/selecting an arrow row inside a flatten/each highlights the correct nested source field(s) in the sources pane, at any nesting depth. Regression test using a nested-iteration fixture (e.g. examples/nested-iteration).


---
id: sl-h0vx
status: open
deps: []
links: []
created: 2026-08-05T09:26:20Z
type: task
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, viz, ux]
---
# viz: nested schema fields have no indentation guide/gutter lines

`_renderField` indents nested fields with `padding-left` only (sz-schema-card.ts:832ish, `.nested` class at 336-337: `padding-left: 20px`). There are no vertical guide lines connecting a parent field to its children, so a deeply nested structure (e.g. transects > sightings > rings > ring_id/condition, four levels deep) is hard to read at a glance once several sibling groups are open — indentation depth alone doesn't show which fields belong to which parent.

Screenshot: bug-reports/need-better-indentation-of-nested-fields-gutter-line-etc.png

## Acceptance Criteria

Nested field rows show a vertical guide line connecting each field to its parent through arbitrary nesting depth. Does not regress the padding-based geometry constants the ELK layout depends on for card height/width estimation.


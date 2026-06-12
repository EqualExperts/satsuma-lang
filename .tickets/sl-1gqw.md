---
id: sl-1gqw
status: closed
deps: []
links: []
created: 2026-06-12T09:14:43Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz]
---
# viz: field note renders twice in detail view (meta pill + note row)

In the mapping detail view, a field with a (note "...") tag renders the note twice: once as a 'note ...' meta pill next to the field name, and once as the shaded italic field-note row below the field. The schema-level metadata pills already exclude note entries (sz-schema-card.ts renderSchema), but _fieldMetaPills does not.

## Acceptance Criteria

Field-level note metadata renders only as the shaded field-note row; no 'note' pill appears in the badges. Other field metadata pills (sensitivity, classification, etc.) and constraint badges are unaffected. Unit test covers the exclusion.


## Notes

**2026-06-12T09:17:09Z**

**2026-06-12T00:00:00Z**

Cause: A field's (note "...") tag reaches the viz model twice — as a NoteBlock in FieldEntry.notes and as a MetadataEntry in FieldEntry.metadata. The schema-level pill renderer excluded note entries but _fieldMetaPills did not, so the detail view showed both a "note ..." pill and the shaded field-note row.
Fix: _fieldMetaPills now filters out note entries, matching the schema-level dedupe; the note renders only as the field-note row. Unit test added in automation.test.js.

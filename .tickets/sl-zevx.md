---
id: sl-zevx
status: closed
deps: []
links: []
created: 2026-10-06T13:19:01Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz]
---
# viz: a schema's note renders twice on the full schema card

Reported from a screenshot: `schema CustomerRecord (note "I am a note")` showed the note as the italic label under the header and again in the Notes section, in the mapping detail view.

## Acceptance Criteria

- A schema-level note appears once on the card, in the Notes section.
- A label with its own text (a metric's display name) still renders.
- Playwright coverage in the mapping detail view.

## Notes

**2026-10-06T13:19:01Z**

Cause: viz-backend deliberately fills both `SchemaCard.label` and `notes` from the schema's `note` tag, and the full card rendered both.
Fix: The card drops its label when it repeats a note's text, the same dedupe it already applies to field note pills. The backend contract is unchanged. (commit immediately after 8fd59973)

---
id: bsw-nju0
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-sweep-2026-10, docs]
---
# HOW-DO-I.md still says parent fields cannot be referenced inside each/flatten

`HOW-DO-I.md:62-63`, "How do I reference a parent field from inside an each or flatten block?", answers "You can't ... Put the arrow outside the block." ADR-053 (caf9dd77) added `^.` and `$.` for exactly this, and the spec (`SATSUMA-V2-SPEC.md` section 4.6, lines 483-488), AI-AGENT-REFERENCE.md and the satsuma-language skill document them.

## Acceptance Criteria

- The HOW-DO-I answer shows `^.field` and `$.field` with a short example and links to the spec section.
- `scripts/check-doc-snippets.mjs` passes.

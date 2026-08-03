---
id: sl-kezo
status: open
deps: []
links: [sl-8vqk]
created: 2026-08-02T21:41:28Z
type: feature
priority: 3
assignee: Thorben Louw
---
# grammar: no way to bind the current element of a scalar list inside each

each iterates a list, and arrows inside address the element's *fields* with a leading dot. A list_of TYPE element has no fields, and there is no notation for the element itself — 'each species_codes -> observations { . -> .species }' is a parse error ('unexpected .').

So a scalar list can only be mapped as a whole (species_codes -> observations.species), which is expressive enough for coverage but says nothing about per-element transforms: 'trim and uppercase each tag' has nowhere structural to live and must be prose.

Candidate notations to weigh (none chosen): a bare 'value'/'element' keyword, '.' as an element reference where a path is expected, or 'each tag in tags -> ...' naming the binding. Any of these would also give the zip case (see the linked ticket) something to iterate over.

## Acceptance Criteria

- Decide whether scalar-list iteration is in scope for the language at all, and record the outcome (ADR if yes, roadmap note if no).
- If yes: grammar rule, corpus fixtures, extraction paths, and coverage semantics for the bound element.
- docs/nested-data/README.md §9 'known sharp edges' updated either way.


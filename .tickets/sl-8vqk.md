---
id: sl-8vqk
status: open
deps: []
links: [sl-kezo]
created: 2026-08-02T21:42:17Z
type: feature
priority: 3
assignee: Thorben Louw
---
# grammar: no notation to reference an ancestor field from inside an each/flatten block

Every path inside a container is prefixed with the container's path, so a parent field referenced from inside a block resolves to a path that does not exist:

  flatten transects.sightings -> rows {
    transects.transect_ref -> transect_ref   // becomes transects.sightings.transects.transect_ref
  }

  warning [field-not-in-schema] Arrow source 'transects.sightings.transects.transect_ref' not declared in schema 'colony_survey'

For flatten there is a clean workaround: write the arrow outside the block, where fields are row context repeated on every output row. For a *nested each* there is none — "the parent transect's ref populates a field on each child element" cannot be stated structurally and has to go in a note, which lineage and coverage cannot follow.

Candidate notations to weigh: a '^.' parent prefix, a '$.' root prefix, or an explicit binding on the each header (each t in transects). Any of them must keep the existing dot semantics untouched — the prefixing rule is relied on by extraction, coverage, viz and the LSP.

## Acceptance Criteria

- Decide whether an escape notation is wanted; ADR if adopted (the prefixing rule is currently an implicit contract across four consumers).
- If adopted: grammar, corpus fixture with a parent-to-child-element arrow, extraction, coverage and lineage all resolve it.
- docs/nested-data/README.md sections 2 and 9 updated.


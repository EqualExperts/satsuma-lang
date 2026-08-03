---
id: sl-3fou
status: open
deps: []
links: [sl-lnbt]
created: 2026-08-02T21:41:28Z
type: bug
priority: 2
assignee: Thorben Louw
---
# lint: unenumerated-record-target proposes a fix that is a parse error for multi-source arrows

The rule's message ends: "Enumerate them (observations { ... }) or map from a record."

For a multi-source arrow neither remedy exists. Spec §4.4 makes a multi-source arrow's body a transform pipeline, not a nesting scope, so

  species_codes, counts -> observations {
    .species -> .species
  }

is a parse error ('unexpected {'). And when the sources are scalar lists (list_of STRING), there is no record to map from either. The only working form is one arrow per target leaf:

  species_codes -> observations.species
  counts -> observations.birds

which coverage reads correctly (3/3). So the author is told to do two things they cannot do, and not told the one they can.

Reproduced against tooling/satsuma-cli 0.11.0.

## Acceptance Criteria

- The message branches on arrow kind: for a multi-source arrow it recommends one arrow per target leaf, not enumeration.
- The single-source wording is unchanged.
- A test covers the multi-source case and asserts the recommended remedy actually parses.
- docs/nested-data/README.md §5 quotes whatever wording ships.


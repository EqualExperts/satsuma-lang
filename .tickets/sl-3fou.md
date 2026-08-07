---
id: sl-3fou
status: closed
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


## Notes

**2026-08-07T11:32:01Z**

Cause: unenumerated-record-target's remedy clause ("Enumerate them (tgt { ... }) or map from a record") was written for single-source arrows only and fired unchanged on multi-source arrows, where neither remedy is writable — spec S4.4 makes a multi-source arrow's body a transform pipeline (an arrow written inside it is a parse error), and scalar-list sources leave no record to map from.
Fix: branch the remedy on arrow.sources.length in checkUnenumeratedRecordTarget so a multi-source arrow's message recommends one arrow per target leaf instead, added a test proving the multi-source message and a separate parse test confirming the recommended fixture actually parses, and updated docs/nested-data/README.md S5's quoted warning to the new wording (commit immediately after 1bf0e046).

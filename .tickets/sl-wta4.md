---
id: sl-wta4
status: open
deps: []
links: []
created: 2026-07-31T15:54:25Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [cli, arrows]
---
# arrows: header count omits intra-target nl-derived arrows that the body then prints

`satsuma arrows <field>` prints a header count and then the arrow rows, and the
two disagree when an @ref derives one target field from another target field of
the same mapping.

    schema tgt { gross_total, final_total }
    mapping load {
      source { src_a, src_b }
      target { tgt }
      -> gross_total { "Add @net_amount and @tax_amount" }
      -> final_total { "@gross_total minus @discount" }
    }

    $ satsuma arrows tgt.gross_total
    tgt.gross_total - 1 arrow (1 as target)

      mapping 'load':
        (computed) -> gross_total { "Add @net_amount and @tax_amount" }  [nl]
        ::tgt.gross_total -> final_total { (NL ref) }  [nl-derived]

Two rows, count of 1. The `asSource` classifier in
`tooling/satsuma-cli/src/commands/arrows.ts:384-389` requires the queried
schema to appear in `mapping.sources`. For an nl-derived arrow whose @ref
points at a target field, the queried schema is on the target side, so the row
is excluded from the count while the printer still emits it.

Intra-target derivation is a legitimate and common idiom — see
`examples/namespaces/ns-merging.stm:142`
(`-> variance { "@budget_amount minus @actual_spend" }`).

Cosmetic only; no lineage data is wrong here. Related to the closed cbh-ekvb,
which fixed a different over-count in the same header.

## Acceptance Criteria

- The header count equals the number of rows printed, for the intra-target
  nl-derived case above.
- The `asSource` / `asTarget` classification recognises a field as a source when
  it is the resolved origin of an nl-derived arrow, regardless of which side of
  the mapping its schema sits on.
- Test covering `arrows tgt.gross_total` on a mapping with intra-target NL
  derivation, asserting both the header string and the row count.
- The cbh-ekvb regression test still passes.


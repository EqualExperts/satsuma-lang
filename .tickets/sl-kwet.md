---
id: sl-kwet
status: open
deps: [sl-hi0z, sl-prlp]
links: []
created: 2026-08-03T16:24:15Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-8f2p
tags: [feature-41, testing, lineage, viz]
---
# cli: cross-consumer lineage parity sweep over the example corpus

Cross-consumer edge agreement is a prose claim: satsuma-viz/src/field-coverage.ts states its arrow walk 'mirrors core's extractArrowRecords' and nothing tests the mirroring. Coverage learned this the expensive way — a consumer deriving its own answer from the model's arrows drifts, and the coverage sweep held on two fixtures then failed on twelve shipped examples. ADR-042 resolved it for coverage; edges are still in the pre-ADR-042 position, with a mirrored arrow walk and a private port resolver.

## Design

Replicate satsuma-cli/test/coverage-viz-parity.test.ts for edges. Over every .stm under examples/ and over generated workspaces, the CLI's field edges, the edges the viz layout would draw, and the arrows in the LSP's merged full-lineage model must agree. Account for scope differences rather than skipping them, exactly as the coverage sweep accounts for workspace-versus-file scope: iterate the narrower side, and treat an edge present only on the narrower side as a failure. Lives in satsuma-cli/test/ for the same reason the coverage sweep does — that is the one place both consumer paths are reachable in a single process.

## Acceptance Criteria

The sweep runs over every .stm in examples/ and reports any disagreement with the file, mapping and edge that differ. A deliberate divergence introduced into any one of the three consumers is reported by the sweep. Where a real disagreement exists on current behaviour, it is recorded against the owning bug ticket rather than accommodated by weakening the assertion.


## Notes

**2026-08-03T16:43:02Z**

Protocol decision this sweep gates (PRD decision 7, recorded 2026-08-03).

Labelling an arrow's declaration kind on the VizModel's `ArrowEntry` was assessed
and deferred pending this sweep's findings. The viz encodes the kind structurally
(`eachBlocks`/`flattenBlocks`/`NestedArrowBlock`, and `sourceFields: []` for a
computed arrow) while core states it as data (`ExtractedArrow.kind`), so the two
agree today only by careful reading.

The field was rejected for now mainly because supplying it would re-arm the
client-side coverage derivation ADR-042 removed: `MappingBlock.coverage`'s
doc-comment records that the client cannot derive coverage partly because it lacks
the arrow's declaration kind.

**What this means for whoever runs this sweep:** if it surfaces a genuine kind
disagreement between the consumers, say so explicitly in the ticket notes rather
than only fixing the symptom — that finding is the trigger to revisit the protocol
decision, and it identifies which side was wrong.

---
id: tced-ninm
status: closed
deps: []
links: [tced-ewd4]
created: 2026-08-07T11:36:28Z
type: task
priority: 2
assignee: Thorben Louw
tags: [viz, testing, harness]
---
# viz: no fixture reaches a top-level dotted each, so hover highlighting on that shape is unproven in a browser

No fixture anywhere in the repo writes a container block whose header target carries the leading dot **at mapping-body level**. The two that exist — `examples/nested-iteration/pipeline.stm:93` and `examples/seabird-colony-lineage/observations.stm:29` — are both nested inside an enclosing `each`.

That matters for the viz specifically. The harness serves `.stm` files it discovers under `examples/` (`tooling/satsuma-viz-harness/src/server.ts`), so the harness fixture set *is* the corpus. With the shape absent from the corpus, no Playwright spec can reach it.

tced-ewd4 changed `qualifyChildArrowPath`, which the viz consumes for coverage lookups, hover highlighting and overview edges. For a top-level dotted `each` the arrow previously resolved to nothing and was dropped from those surfaces; it now resolves. That is a *painted* difference — a coverage dot and a hover highlight that were absent and should now appear — and per AGENTS.md ("Unit tests prove logic; only a browser proves the visual contract") no getter-level test can prove it. The core and viz unit tests added by tced-ewd4 prove the path resolves; they cannot prove the `.hl` class lands on the field row.

Raised rather than silently reaching for the nearest already-wired fixture, which is what that section of AGENTS.md asks for.

## Acceptance Criteria

- A canonical example (or a new one) writes a top-level `each <list> -> .<target>`, so the shape is represented in `examples/` and therefore reachable by the harness.
- A Playwright case in `harness.test.ts` hovers an arrow row on that mapping and asserts the `.hl` class lands on the expected source and target field rows — extending the existing "Hover highlighting between arrows and field rows" describe block rather than adding a parallel one.
- Whatever derived artifacts a new corpus file feeds (test-stats.json, the eval static-compactness outputs) are regenerated in the same change.

## Notes

**2026-08-10T11:50:00Z**

Cause: The corpus only wrote a dotted each target nested inside another each; no top-level form existed, so the harness could not exercise hover highlighting on that shape in a real browser.
Fix: Added `examples/top-level-dotted-each/pipeline.stm` with a top-level `each parties -> .rows`, extended the existing "Hover highlighting between arrows and field rows" Playwright describe block with a case asserting `.hl` lands on `parties.party_role` and `rows.role`, and regenerated static-compactness and test-stats. (commit immediately after 27a6186c)


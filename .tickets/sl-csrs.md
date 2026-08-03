---
id: sl-csrs
status: closed
deps: []
links: [sl-46wr, sl-3de8]
created: 2026-08-02T21:40:38Z
type: bug
priority: 1
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, coverage, viz, core]
---
# viz: coverage ignores whole-structure arrow conferral, so a record-to-record arrow reads as a gap

ADR-037 (R5, closes 3cc-iedv) rules that an arrow whose path resolves to a record or list_of record covers that node's entire declared subtree, when the arrow states a correspondence (kind map or nested) and enumerates no child arrows. Core implements it; the viz's own covered-path derivation (satsuma-viz/src/field-coverage.ts, buildMappingCoveredFields) does not, so the leaves under a whole-structure arrow read as uncovered on the schema card.

Reproduced on a minimal fixture with addr -> address (3 leaves), rows -> lines (list_of record, 2 leaves), bill.city -> billing.city and a leaf-into-record arrow:

  source  cli 7/8  88%   viz 2/8  25%
  target  cli 6/9  67%   viz 1/9  11%

Same divergence for the two conferring forms ADR-037 names explicitly — an empty body (p -> p { }) and a pipe-chain transform body (r -> r { trim }) — while the enumerating form (q -> q { .x -> .x }) agrees, because only the explicit child arrow is counted either way.

Second half of the same root cause as sl-46wr: the viz maintains a third derivation of covered paths, so each coverage rule added to core has to be re-implemented there or the number drifts. The existing parity test (sl-5nsv) only exercises fragment-spread fixtures, which is why both gaps survived.

## Design

Fix with sl-46wr, by having the host pass core's computed FieldCoverageEntry list to the card instead of deriving covered paths from the viz model. If the derivation stays, buildMappingCoveredFields needs the ADR-037 conferral rule — including its two conditions (ExtractedArrow.kind in {map, nested}; enumeratesChildren false) — which requires the viz model to carry the same kind/enumeration signal, and that is itself an argument for deleting the derivation.

## Acceptance Criteria

A viz-path/CLI parity test over a fixture containing a whole-record arrow, a whole-list_of-record arrow, an empty-body arrow and a pipe-chain-body arrow asserts identical leaf verdicts, container states and percentages. The enumerating form still confers only its enumerated children.


## Notes

**2026-08-03T07:08:36Z**

Cause: second half of sl-46wr's root cause. ADR-037's whole-structure conferral is gated on the arrow's declaration kind and on whether its body enumerates children, neither of which survives into a flat set of covered paths, so the viz's own derivation reported every leaf under a record-to-record or list_of-record arrow as uncovered.
Fix: fixed with sl-46wr by deleting the derivation — the viz now consumes core's FieldCoverageEntry list, which already has conferral applied. New fixture tooling/satsuma-cli/test/fixtures/coverage-whole-structure.stm carries all five forms the rule distinguishes on one file (bare record-to-record, list_of record, empty body, pipe-chain body, and the enumerating form that must confer only what it lists) plus ADR-038's scalar-into-record case; satsuma coverage reports src 12/14 and tgt 11/15 on it and the viz parity suite asserts the same figures and the per-leaf verdicts.

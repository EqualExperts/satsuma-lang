---
id: sl-4qvp
status: closed
deps: [sl-gsxu]
links: [3cc-t6uo]
created: 2026-07-31T13:33:31Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-ce11
tags: [feature-35, core]
---
# core: aggregate coverage rollup function (per-schema across mappings, workspace, per-namespace)

PRD 35 R3, core half. Split out of sl-3ms0 after doc review 2026-07-31: sl-3ms0 depended on the CLI command (sl-oqsj), which serialised feature 36's browser-only coverage overlay behind CLI plumbing it never uses. The aggregation is a core concern and depends only on the relocation (sl-gsxu).

Aggregate semantics: a target field counts covered when ANY mapping populates it; a source field counts consumed when ANY mapping reads it. Both roles aggregated and clearly labelled (user-accepted proposal). Produces workspace totals plus per-namespace subtotals.

## Design

Exported from @satsuma/core so both the CLI (sl-3ms0) and satsuma-viz's browser bundle (sl-5m9x) call one function — feature 36 requires overlay numbers identical to CLI output, which only holds if there is a single implementation. The function must take core-level inputs only; no CLI index or LSP WorkspaceIndex types.

## Acceptance Criteria

Aggregation function exported from core with minimal-snippet tests: a field covered by mapping A but not mapping B is uncovered in B's per-mapping result and covered in the aggregate; workspace and per-namespace percentages correct on a namespaced fixture; per-mapping and aggregate results are distinguishable in the returned type (so consumers cannot mislabel them); no dependency on satsuma-cli or satsuma-lsp; core suite passes locally.


## Notes

**2026-07-31T14:03:25Z**

Cause: no workspace-level aggregation existed, so every caller re-implemented the union across mappings — the step PRD 35 P1 identifies as where callers get it wrong.
Fix: added satsuma-core/src/coverage-rollup.ts exporting aggregateCoverage() and summarizeFieldCoverage(). Per-mapping and aggregate figures live in structurally distinct types so a consumer cannot render one under the other's label. Union rule: covered when ANY mapping covers it, per role, keyed by (schemaId, role) so a staging schema counted as both source and target yields two entries counted once each. Namespace attribution follows the schema's own id, not the referencing mapping's namespace.

Counting rule decided here and documented: leaves only, on each leaf's own flag. Records are excluded rather than vouching for their subtree — a record's mapped flag is already true when any single descendant is covered (addPathAndPrefixes registers ancestor prefixes), so inheriting from it would turn 'one of twelve address fields is mapped' into 'all twelve are'. The trade-off (a whole-record arrow under-counts) is recorded as 3cc-iedv; it errs toward reporting a gap that is not there rather than hiding one that is. 466 core tests pass (16 new); no dependency on satsuma-cli or satsuma-lsp.

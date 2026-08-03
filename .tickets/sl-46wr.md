---
id: sl-46wr
status: open
deps: []
links: [sl-csrs, sl-3de8, sl-5nsv]
created: 2026-08-02T21:40:23Z
type: bug
priority: 1
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, coverage, viz, core]
---
# viz: coverage ignores the NL @ref tier, so the schema card disagrees with satsuma coverage

The viz derives its own covered-path set in satsuma-viz/src/field-coverage.ts (buildMappingCoveredFields), walking the viz model's arrows. It counts declared arrows only. ADR-036 added a second coverage tier — a leaf named by a *resolved* NL @ref counts as covered — and that rule lives in core's computeMappingCoverage(), which the viz path does not call. So every field covered only by an @ref reads as uncovered on the schema card while satsuma coverage and the VS Code gutter report it covered.

Reproduced across the shipped corpus by computing both paths over every examples/**.stm. Twelve files disagree; the divergence is NL-tier in every case checked:

  examples/db-to-db/pipeline.stm         source legacy_sqlserver   viz 15/21   cli 21/21
  examples/contracts/buy-to-om-order.stm source buy_order          viz  7/8    cli  8/8
  examples/edi-to-json/pipeline.stm      source edi_desadv         viz  6/16   cli  7/16
  examples/multi-source/multi-source-join.stm source order_transactions  viz 0/10  cli 6/10
  examples/multi-source/multi-source-join.stm source support_tickets     viz 0/8   cli 5/8
  examples/filter-flatten-governance/governance.stm source finance_transactions  viz 0/16  cli 3/16
  (also: filter-flatten-governance.stm, json-api-to-parquet, merge-strategies,
   multi-source-hub, protobuf-to-parquet, sap-po-to-mfcs, xml-to-parquet)

On buy-to-om-order the single differing leaf is tax_amount, which the CLI tags tier=nl and the viz reports uncovered.

This is the failure PRD 38 P3 exists to remove ('one workspace, three completeness figures') and it breaks the epic's acceptance criterion that the CLI, the VS Code status bar and the viz card report identical figures. It also blocks Feature 36 (sl-3de8), whose R2 requires the overlay's numbers to equal coverage --json.

## Design

Root cause is structural: sl-vu22 deleted the duplicate CST walker in core, but the viz kept a third derivation of covered paths over the viz model. Every coverage rule added since — the NL tier (ADR-036), whole-structure conferral (ADR-037) — has to be implemented twice or the viz drifts.

Preferred fix is to stop deriving in the viz: have the host (viz-backend / the VS Code extension) call core's computeMappingCoverage and pass the resulting FieldCoverageEntry list, tiers and all, to the card, which already counts through core's summarizeFieldCoverage/countContainerStates. That subsumes this ticket and 3ct-nlv2's sibling (whole-structure conferral) and prevents the next rule from drifting. If the model-only derivation must stay for the standalone harness, the NL tier must be added to buildMappingCoveredFields and the parity test extended to a fixture that has one.

Note the viz card renders a tier-blind boolean today; ADR-036 requires consumers not to compute their own declared/NL split, so whatever is passed in must carry the tier.

## Acceptance Criteria

The viz path and satsuma coverage --json report identical covered counts, totals and percentages for every file under examples/ — asserted by a sweep-style test or at minimum by extending tooling/satsuma-viz/test/coverage-parity.test.js with a fixture whose coverage includes an nl-tier leaf. examples/contracts/buy-to-om-order.stm reports 8/8 on the source side from the viz path. The parity test fails if the NL tier is removed from either side.


---
id: sl-3ms0
status: closed
deps: [sl-oqsj, sl-4qvp]
links: []
created: 2026-07-31T13:13:05Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ce11
tags: [feature-35, core, cli]
---
# cli: surface aggregate coverage rollups in coverage output

PRD 35 R3, CLI half. Split after doc review 2026-07-31: the core aggregation function moved to sl-4qvp so it is not blocked behind the CLI command, because feature 36's browser-only overlay (sl-5m9x) consumes the core function directly and would otherwise be serialised behind CLI plumbing it never uses. This ticket is the CLI's rendering of that function.

## Design

Consume the core aggregation exported by sl-4qvp — no aggregation logic in the CLI. Surface it in both human and --json output, labelled distinctly from per-mapping numbers: "a field is uncovered by this mapping" and "a field is uncovered by every mapping" are different claims and a reviewer must not be able to confuse them. Include workspace totals and per-namespace subtotals.

## Acceptance Criteria

Aggregate rollups appear in human and --json output with labelling that distinguishes per-mapping from aggregate figures; workspace and per-namespace subtotals render correctly on a namespaced fixture; --json aggregate section matches the shape documented in sl-tdfx; no aggregation logic implemented in the CLI (it delegates to core); CLI suite passes locally.


## Notes

**2026-07-31T14:14:39Z**

Cause: the coverage command reported only per-mapping figures, so the workspace-level question PRD 35 P1 names — which fields does NO mapping populate — still required the caller to union the results.
Fix: the command now calls core's aggregateCoverage over the scoped mappings and renders it in both human and --json output. The aggregate is a sibling section, never merged into the per-mapping one, and its heading states the claim in words ('a field is uncovered here only when NO mapping in scope covers it') rather than relying on a section title a reader can skim past. Namespace subtotals and a workspace total are printed on aligned rows; the single-group namespace row is suppressed because it would duplicate the workspace row exactly. Aggregating over the *scoped* mappings is deliberate — --fail-under (sl-268g) gates whatever scope is active. No aggregation logic in the CLI; it delegates entirely to core. 943 CLI tests pass (9 new); eslint clean.

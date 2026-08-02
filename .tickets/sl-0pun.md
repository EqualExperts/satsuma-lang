---
id: sl-0pun
status: closed
deps: [sl-fmx0]
links: []
created: 2026-07-31T14:43:38Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, core, lsp, cli]
---
# core: container coverage tri-state (covered / partial / uncovered)

PRD 38 R2. Replace the two contradictory boolean definitions of a covered record with one three-valued state: covered when every descendant leaf is covered, partial when at least one but not all are, uncovered when none are. Leaves stay binary.

Today the LSP treats a record as mapped when ANY descendant is covered (buildFieldCoverage, asserted by its own test: items.mapped === true when only items.id is mapped), while the CLI's filterUnmappedFields excludes a record only when ALL children are covered, deliberately and with a comment explaining why. Both are right for their consumer; one boolean cannot carry both claims. Feature 35's sl-oqsj already commits to an acceptance criterion requiring the two to agree.

## Design

The tri-state subsumes both consumers without either changing what it shows: the LSP gutter paints on covered||partial (today's behaviour exactly), the CLI review queue lists anything not covered (today's behaviour exactly). Feature 36 R2 gains the signal it currently lacks — a record with 1 of 12 leaves mapped can render differently from a fully mapped one.

FieldCoverageEntry.mapped is an existing contract, so ADD the state rather than repurposing mapped, and define mapped = state !== 'uncovered' for containers so LSP output stays byte-identical.

## Acceptance Criteria

Tri-state on record and list_of record entries, doc-commented; leaves never report partial; mapped === (state !== 'uncovered') for containers so the VS Code gutter is unchanged; one of three leaves mapped yields partial, three of three covered, zero of three uncovered; partial propagates upward while covered does not (a record { b record { x, y } } with only a.b.x mapped leaves both a.b and a partial); a container referenced with an empty each body (each parcels -> .packed { }) is uncovered, not partial — a container reference must not manufacture leaf coverage; core, LSP and CLI suites pass.


## Notes

**2026-08-02T07:50:46Z**

Cause: coverage carried two contradictory boolean definitions of a covered record — the LSP treated a record as mapped when ANY descendant was covered (ancestor-prefix registration), while the CLI review queue excluded one only when ALL children were. One boolean cannot carry both claims.
Fix: FieldCoverageEntry gains a tri-state `state` (covered/partial/uncovered) computed for containers purely from their descendant leaves, with `mapped` redefined as `state !== "uncovered"` so the VS Code gutter and CLI queue are byte-identical. Leaves stay binary. buildFieldCoverage now recurses bottom-up (coverageForField/rollUpContainer), and aggregateCoverage recomputes container states from unioned leaves rather than OR-ing per-mapping states — two mappings each covering half a record now aggregate to covered. A container reference no longer manufactures leaf coverage: an empty each body and a computed arrow into a record both leave the container uncovered.

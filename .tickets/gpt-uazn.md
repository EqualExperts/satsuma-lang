---
id: gpt-uazn
status: open
deps: []
links: [gpt-pwze, gpt-o0fk]
created: 2026-08-06T13:43:52Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-46, testing, diagnostics, lsp]
---
# Feature 46: generated-input confidence for diagnostics and editor intelligence

Deliver Feature 46 from features/46-generated-property-expansion/PRD.md: close the two structural gaps left by Features 39 and 41. Every generated workspace in the repo is valid by construction, so the whole diagnostic surface (validate, lint, and the LSP's mirror of both) is still fixture-only; and satsuma-lsp has no generated coverage at all, despite three of its features being inverse relations over ground truth the generator already states. Covers a defect-mutator layer in scenario-gen, diagnostic properties in both directions (missed and spurious), an LSP scenario adapter, rename round-trip, diff algebra, and inverse-relation properties for the query commands.

## Acceptance Criteria

R1-R7 are delivered through linked child tickets with their PRD acceptance tests passing; every requirement is accepted by a mutation check that shows the property failing against a deliberately broken implementation, with the counterexample naming the defect; every child records its cause/fix note and passing relevant automated tests before closure; the PRD ticket map and status are reconciled when the epic closes; no diagnostic semantics, rule severities or command output change.


## Notes

**2026-08-06T13:50:27Z**

Project owner decisions, 2026-08-06.

1. R2 asserts diagnostic positions to the mutated construct, not to an exact
   line. Recorded as PRD decision 4; gpt-vq0r's design updated.
2. No bug raised for lint-lineage-cycle / lint-type-mismatch. The claim that they
   were exported from core but unregistered was a false positive: lint-engine.ts
   registers both through the TYPE_MISMATCH_RULE_ID and LINEAGE_CYCLE_RULE_ID
   constants rather than as literal id strings, so a grep for 'id: "..."' misses
   them, and lint-command.test.ts already drives both end to end. All six rules
   are reachable from satsuma lint and all six are in scope for R1's mutators.
   Recorded as PRD decision 3.

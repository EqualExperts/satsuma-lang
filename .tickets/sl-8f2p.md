---
id: sl-8f2p
status: open
deps: []
links: []
created: 2026-08-03T16:23:18Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-41, lineage, graph, tooling]
---
# Feature 41: generated-input confidence for lineage and graph

Deliver Feature 41 from features/41-lineage-graph-confidence/PRD.md: point Feature 39's generated-input machinery at the lineage and graph surfaces, where the generated scenario is itself the ground-truth graph and so needs no independent oracle. Covers the reusable generator package, a workspace-shaped scenario model, structural edge invariants, reachability properties, a cross-consumer parity sweep, and branded endpoints.

## Acceptance Criteria

R1-R6 are delivered through linked child tickets with their PRD acceptance tests passing; every child records its cause/fix note and passing relevant automated tests before closure; the PRD ticket map and status are reconciled when the epic closes; no lineage or graph semantics change and r0-7w76 remains undecided by this epic.


## Notes

**2026-08-03T22:51:42Z**

R1, R2 and R3 delivered in PR #459 (branch feat/lineage-graph-confidence), plus
Feature 40's sl-4871 spike, which unblocks the rest. Not merged. Decision log:
features/41-lineage-graph-confidence/IMPLEMENTATION-NOTES.md.

Closed: sl-puky, sl-dqyu, sl-hi0z. No production behaviour changed — every
deliverable is a test, a test-only generator, or a doc, as the PRD promised.

Remaining: sl-jsyn (R4) and sl-kwet (R5) still blocked on Feature 40's sl-prlp, per
PRD decision 4 — deliberately not overridden, since sl-prlp is a production refactor
with a byte-identical-output requirement across two commands. R4's oracle
(scenarioAncestorsWithin / scenarioDescendantsWithin) shipped early inside R2, so R4
is now a test file that calls one traversal. sl-jyee (R6) still blocked on Feature 39
R5, which has no ticket.

Four bugs found and raised, none fixed here: lgc-3f13 (P1, core — a namespaced
mapping targeting a global schema makes graph, lineage and validate all name a
schema that does not exist), lgc-4bxl (P1, viz — a computed arrow drawn as a phantom
line from a same-named source field), lgc-fu7o (P1, viz — only the first source of a
multi-source arrow drawn, hover points at the wrong card), lgc-wtz1 (P2 — graph
--json spells the same entity two ways). Each has its property already written and
pinned, so fixing it turns a test red with instructions attached.

ADR-049 drafted with Status: Proposed, awaiting user sign-off.

Two PRD corrections worth carrying: Feature 39 R4 shipped after the PRD was written
(the coverage oracle is on main), and acceptance test 6 is not runnable as written —
qualifyField has no guard to revert, so the pinned r0-7w76 test is the executable
form of that claim.

**2026-08-04T00:00:00Z**

Two corrections applied on review of PR #459:

1. ADR-049 dropped — not warranted. Its two rules now live in
   docs/developer/ARCHITECTURE.md and satsuma-scenario-gen's module comments.
2. **sl-jyee (R6) delivered.** It was recorded as blocked on Feature 39 R5 "which
   has no ticket"; R5 had in fact shipped as cbdr-e6ft + cbdr-5r4d (ADR-044) one
   commit after the c93b1130 the PRD was checked against. Feature 39 R4
   (cbdr-da0j) likewise. The PRD's asset table, R6 section, ticket map and
   sequencing decision 6 are corrected.

R6 is the only production change in this feature and the output is byte-identical:
qualifyField is replaced by resolveFieldEndpoint, which reports the r0-7w76 fork
instead of guessing, and the guess now lives at one named CLI site
(field-endpoints.ts, arrowEndpoint) pinned by a test. r0-7w76 remains undecided.

Remaining: sl-jsyn (R4) and sl-kwet (R5) still blocked on Feature 40's sl-prlp
(commit immediately after 2b124725).

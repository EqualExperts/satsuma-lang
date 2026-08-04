---
id: sl-8f2p
status: closed
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

**2026-08-04T15:18:41Z**

Cause: Two children remained open at last update — sl-jsyn (R4) and sl-kwet
(R5) — both blocked on Feature 40's sl-prlp. sl-prlp closed since (PR #471,
merged), and its own re-planning found spr-w98t (the depth-truncation defect
R4 was sequenced behind) was never a real bug: field-lineage's traversal has
always been FIFO BFS, which is depth-exact by construction, so no fix was
needed before R4 could proceed.

Fix: sl-jsyn delivered as generated-scenario properties aimed directly at
core's traceFieldLineage (upstream/downstream depth-exactness, sg-pufq's
diamond-branch completeness with a single-predecessor mutant demonstration,
duality, cyclic termination, and the tie to graph --schema-only). sl-kwet
delivered as a new tooling/integration-tests/ package (ADR-050) sweeping the
CLI's field edges against the VizModel both the webview and LSP consume, over
the full example corpus plus generated workspaces — zero disagreements found.

All six children (sl-puky, sl-dqyu, sl-hi0z, sl-jyee, sl-jsyn, sl-kwet) are
closed. No lineage or graph semantics changed — every deliverable was a test,
a test-only generator/package, or a type, as the PRD promised. r0-7w76 remains
deliberately undecided: sl-kwet's sweep uses the same arrowEndpoint policy on
both sides specifically so it can't accidentally relitigate that question.
ADR-049 (dropped, folded into docs) and ADR-050 (this epic's new package +
narrow CLI test export) are the two architectural decisions this feature
produced. PRD moved to archive/features/41-lineage-graph-confidence/, status
updated to IMPLEMENTED, and item 7's deferred ArrowEntry.kind decision recorded
as unrevisited (R5's trigger condition — a genuine kind disagreement — did not
fire). (commit immediately after a8b10029)

**2026-08-04T15:18:59Z**

Correction to the note above: "ADR-049 (dropped, folded into docs)" refers to
an earlier Feature 41 ADR draft that was assessed and rejected before ever
being written to disk (recorded in this epic's 2026-08-04T00:00:00Z note). It
is unrelated to the current adrs/adr-049-npm-workspaces-and-turborepo.md,
which was assigned that number afterward for Feature 42 — a numbering
coincidence, not the same decision.

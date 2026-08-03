---
id: sl-hysg
status: closed
deps: [sl-npi6]
links: []
created: 2026-07-31T13:14:15Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-iffm
tags: [feature-37, core, cli]
---
# core+cli: lineage-cycle lint rule

PRD 37 R2. Warn when the schema-level mapping graph (source schemas -> target schemas per mapping, same edge semantics as satsuma lineage / graph --compact) contains a cycle. Self-mapping edges (source schema equals target schema) are excluded before detection — recorded product decision in docs/product-owner/ROADMAP.md, cited in the rule doc comment.

## Design

Detector in @satsuma/core; thin lint-engine wrapper. Severity warning, not fixable.

One finding per strongly-connected component, not per elementary cycle (user decision, doc review 2026-07-31 — the PRD originally specified elementary-cycle enumeration with a truncation cap). Compute SCCs with Tarjan; each SCC with more than one node is one finding, reported as one representative cycle through it. Enumerating elementary cycles (Johnson) is output-exponential: a densely cross-linked platform graph can hold combinatorially many cycles that all describe the same tangle of mappings, which is exactly why the original spec needed a cap. SCC-per-finding removes the need for the cap — the count is bounded by the number of schemas — and matches what the reviewer must actually do, which is untangle the component rather than audit each rotation through it.

Canonicalise the representative: enter the SCC at its lexicographically smallest schema id and walk a deterministic shortest cycle from there, so output does not vary with run order or file order. Message shows that path plus the mapping responsible for each edge, and when the component holds more schemas than the representative path shows, names them ("component also includes: ...") so nothing in the tangle is hidden.

## Acceptance Criteria

Minimal-snippet tests in core: two mappings forming a-b-a yield exactly one warning with canonical path and both mapping names; self-mapping yields no warning (regression-locks the roadmap decision); three-schema cycle reported once regardless of declaration order; a densely connected component containing several elementary cycles yields exactly one finding and names the component's other schemas; representative path is identical across shuffled file/mapping orderings; no truncation cap is needed or present; CLI-level tests cover registration and --json shape; all suites pass locally.


## Notes

**2026-08-03T17:52:28Z**

**2026-08-03T17:52:28Z**

Cause: Every traversal in the toolchain is cycle-guarded, so an unintended cycle across distinct schemas showed up only as lineage output that quietly omitted an expected upstream hop — guarding is not reporting, and users had no diagnostic pointing at the cause.
Fix: Added detectLineageCycles() in satsuma-core/src/lint-lineage-cycle.ts — schema-level edges with self-mapping edges dropped per-edge before detection (roadmap decision cited in the module), iterative Tarjan SCCs, one finding per component with a canonical representative path (entry at the smallest id, BFS shortest cycle over sorted adjacency), each hop attributed to its mapping and unvisited members named — plus a thin lineage-cycle wrapper in the CLI's lint-engine. 18 core tests lock it, determinism under shuffled mapping order included. (commit immediately after acbb3b96)

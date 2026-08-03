# ADR-048 — A Graph Finding Reports One Tangle, Not Every Instance of It

**Status:** Accepted
**Date:** 2026-08-03 (sl-hysg)

## Context

`lineage-cycle` reports cycles in the schema-level mapping graph — the same edges
`satsuma lineage` and `graph --compact` draw, from each mapping's source schemas
to its target schemas. The rule exists because every traversal in this toolchain
is cycle-guarded, so an unintended cycle shows up only as lineage output that
quietly omits an expected upstream hop. Guarding is not reporting.

Feature 37's PRD originally specified **elementary-cycle enumeration**: find every
distinct simple cycle and report each one, with a truncation cap to stop the
output running away. That is the obvious reading of "report the cycles", and the
cap is the obvious defence.

The cap is the tell. Elementary-cycle enumeration (Johnson's algorithm) is
*output-exponential* — the number of simple cycles in a graph is not bounded by
any polynomial in its size. Six mappings among three schemas, each pair linked
both ways, already yield cycles `a→b→a`, `a→c→a`, `b→c→b`, `a→b→c→a` and
`a→c→b→a`; a platform entry point pulling in a few dozen cross-linked schemas
yields combinatorially many. Every one of them describes the *same* tangle of
mappings, and the reviewer's task for all of them is identical: work out which
arrow points the wrong way. A cap does not fix that. It caps a list whose entries
were already redundant, and it does so silently — the reviewer sees ten cycles,
fixes them, and has no idea whether the eleventh was the informative one.

The alternative considered and rejected was **enumeration with deduplication** —
enumerate elementary cycles, then collapse ones sharing a mapping. That still pays
the exponential cost before collapsing, and the collapsing rule ("same tangle") is
just a strongly-connected component computed the expensive way.

## Decision

**A finding about graph structure reports one finding per strongly-connected
component, not one per cycle through it.** For `lineage-cycle`
(`tooling/satsuma-core/src/lint-lineage-cycle.ts`): compute the SCCs of the schema
graph with Tarjan's algorithm; every component of two or more nodes is exactly one
finding. No cap, no truncation, and no scale guard — the number of findings is
bounded by the number of schemas.

Because a component is reported by a single *representative* cycle, that
representative must be **canonical**, or the same tangle would be described
differently depending on which file loaded first and a CI diff of lint output
would show phantom changes. The canonicalisation is: enter the component at its
lexicographically smallest schema id, and walk the shortest cycle from there via
breadth-first search over **sorted** adjacency lists. Sorted adjacency plus
first-discovery predecessors makes the walk a function of the graph alone, not of
insertion order. `MIN_CYCLIC_COMPONENT_SIZE = 2` is the threshold, and single-node
components can never qualify because self-mapping edges are dropped at
graph-build time — the recorded product decision that a schema mapped to itself
represents an increment, not a cycle.

A representative hides what it does not traverse, so the finding must say so
explicitly. The message carries the representative path, the mapping responsible
for **each** hop (all of them, when several mappings declare one edge), and — when
the component holds more schemas than the path visits — those schemas by name
("component also includes c, d"). A two-hop representative for a five-schema
tangle must not read as a two-schema problem.

## Consequences

**Positive:**

- Output size is bounded by the number of schemas rather than by the number of
  cycles, so the rule is safe to run on a whole platform graph. The truncation cap
  the PRD needed is not merely unnecessary — there is nothing left to truncate,
  and so nothing is silently dropped.
- One finding matches one unit of work. Untangling the component is what the
  reviewer does; auditing each rotation through it is not.
- Tarjan is linear in nodes and edges, against Johnson's output-exponential
  behaviour.
- The canonical representative makes lint output diffable across runs, which is
  what lets a team review changes to it rather than re-reading it whole.

**Negative:**

- The finding is not a complete description of the graph. A reviewer who wants
  every cycle must derive them from the component, and the rule will not produce
  them. This is deliberate, and it is the main thing a future contributor might
  reasonably want to reverse.
- The message must carry the component's other members, because the path alone
  understates the problem. That is prose doing work the output shape does not do
  on its own, and a consumer rendering only the path would mislead.
- Fixing one arrow inside a large component may leave it cyclic, so the finding
  can reappear with a *different* representative path after a partial fix. The
  reviewer sees a changed message rather than a resolved one, which reads as
  progress being undone unless they understand the component model.
- Tarjan's algorithm is implemented iteratively, with an explicit frame stack, to
  survive a deep graph. That is more code than the recursive form and needs its
  invariants explained in comments rather than being self-evident.

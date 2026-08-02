# ADR-034 — Leaf-Only Coverage Counting on a Field's Own Flag

**Status:** Accepted — amended by ADR-037
**Date:** 2026-07-31 (sl-4qvp, feature 35)

## Context

`computeMappingCoverage()` in `satsuma-core/src/coverage.ts` reports one
`FieldCoverageEntry` per declared field of a mapping's participating schemas,
including record fields, each with a `mapped` boolean. Until feature 35 no
consumer turned those entries into a number: the VS Code gutter decorates
individual fields, so it never needed a denominator.

Feature 35 changed that. `satsuma coverage` prints `covered/total` and a
percentage per schema, per namespace, and per workspace, and `--fail-under`
turns the workspace figure into a CI gate that blocks a merge. Feature 36's viz
overlay will render the same numbers. Once a percentage exists, the population
it is computed over becomes a contract: three consumers must agree, and a gate
must not fail a complete spec or pass an incomplete one.

Counting every entry is not an option — a record and its children describe the
same data, so a nested schema would be counted at two levels, and a schema's
nesting depth alone would move its percentage. Both existing consumers already
recognised this and solved it differently.
`vscode-satsuma/src/commands/coverage-logic.ts:82` counts _top-level_ fields
only, filtering `!f.path.includes(".")`. That avoids double-counting but reports
a twelve-field `address` record as a single unit, so one mapped leaf reads as a
fully covered record.

The apparently correct rule — count leaves, and treat a leaf as covered when it
or any ancestor is covered — was implemented and rejected during sl-4qvp. It
fails because of how the covered-path set is built. `addPathAndPrefixes()`
(`satsuma-core/src/coverage-paths.ts`) registers every ancestor prefix of a
referenced path, precisely so a parent record shows as touched in the gutter
when one child is mapped. A record's `mapped` flag therefore cannot distinguish
the two cases that matter for counting: `address -> address` copying the whole
record, and `address.city -> city` covering exactly one of its twelve leaves.
Both set `mapped: true` on `address`. Inheriting from it would report "1 of 12
address fields mapped" as "all 12 mapped" — a large, silent overstatement in
the direction that hides work.

## Decision

Coverage counts **leaf fields only, using each leaf's own `mapped` flag**.
Record fields — any entry with at least one descendant entry — are excluded from
both `covered` and `total`, and never vouch for their descendants.

The rule lives in exactly one place: `summarizeFieldCoverage()` in
`satsuma-core/src/coverage-rollup.ts`, which every per-mapping table, aggregate
rollup, namespace subtotal, workspace total, and `--fail-under` comparison calls.
The leaf predicate is exported separately as `leafFieldEntries()` so that a
rendered list of field paths and the count printed beside it are derived from the
same definition; a consumer that filtered fields itself could otherwise show
three paths under a count of two.

Consumers must not compute their own coverage denominators. A consumer needing a
percentage calls `summarizeFieldCoverage()`; one needing the fields behind a
percentage calls `leafFieldEntries()`.

The known cost is accepted deliberately: a whole-record arrow under-reports,
because its leaves are never individually referenced. Correcting it requires
`computeMappingCoverage()` to track directly-covered paths separately from
prefix-registered ancestors, which changes the per-mapping contract the VS Code
gutter consumes. That work is tracked as `3cc-iedv` and was kept out of feature 35.

## Consequences

**Positive:**

- One rule, one implementation. A CLI percentage, a `--fail-under` verdict, and a
  viz overlay figure cannot disagree, because none of them computes its own.
- Percentages measure data, not structure. Re-nesting a schema's fields into
  records without changing a single arrow leaves every percentage unchanged.
- The error direction is safe. A whole-record arrow makes coverage look _worse_
  than it is, so the failure mode is a reviewer investigating a gap that turns
  out to be filled — not a gate passing a spec with twelve unmapped fields.
- Field lists and counts are guaranteed consistent, because both derive from
  `leafFieldEntries()`.

**Negative:**

- A whole-record arrow (`address -> address`) reports all of that record's leaves
  as uncovered. Workspaces relying on record-level copies will see understated
  coverage until `3cc-iedv` lands, and `--fail-under` thresholds on them must be
  set with that in mind.
- The VS Code status bar remains on its own top-level-field rule
  (`coverage-logic.ts:82`), so its percentage and `satsuma coverage`'s disagree
  for any schema with nested records. This ADR does not change that behaviour;
  reconciling it is tracked as `3cc-t6uo`. The divergence is confined to the
  percentage — the gutter decorations are per-field and already come from core.
- The rule is not inferable from `FieldCoverageEntry` alone. A reader who sees
  `mapped: true` on a record and assumes it counts will get a different number,
  which is why the rationale is documented on the `CoverageTotals` type as well
  as here.

# ADR-037 — Container Coverage Is Derived From Leaves, and a Whole-Structure Arrow Covers Its Subtree

**Status:** Accepted
**Date:** 2026-08-02 (sl-0pun, sl-r6b0; feature 38, closes 3cc-iedv)

## Context

Coverage reports one `FieldCoverageEntry` per declared field of a mapping's
participating schemas — leaves _and_ the records that contain them — each with a
`mapped` boolean. Two questions about the record entries had never been settled
in one place, and both were blocking feature 38's goal of a coverage number that
can gate a merge.

**What does `mapped` mean on a record?** Two consumers had answered differently
and each was right for itself. The LSP gutter treated a record as mapped when
_any_ descendant was covered, because `buildCoveredFieldPaths` registers every
ancestor prefix of a referenced path — so `address.city -> city` marks `address`
touched, which is what a gutter should show. The CLI's `filterUnmappedFields`
(`satsuma-cli/src/commands/fields.ts`) did the opposite, keeping a record in the
review queue until _all_ of its children were covered, with a comment explaining
why: a record whose path is registered merely as an ancestor would otherwise hide
its remaining gaps. One boolean cannot carry both claims, and feature 35's
`sl-oqsj` had already committed to an acceptance criterion requiring the two
views to agree.

**What does an arrow onto a record assert about the record's contents?** Before
this change, nothing: `address -> address` between two record-typed fields
registered the single path `address`, so all of that record's leaves reported as
gaps and the percentage under-counted a spec the author had completed
(`3cc-iedv`). ADR-034 accepted that under-count deliberately and explained the
alternative it rejected — "a leaf inherits coverage from any covered ancestor" —
which fails precisely because ancestor registration makes a record's flag true
when a _single_ descendant is covered. Inheriting from it would turn "one of
twelve address fields is mapped" into "all twelve are".

Iteration 1 of feature 38 (`sl-fmx0`, PR #414) built the model that makes the
distinction expressible: `CoveredFieldPaths` keeps _direct_ paths (an arrow named
exactly this) apart from _ancestor_ paths (a proper prefix of one). It stopped
short of using it, because the direct set was **kind-blind**. Extraction emits a
record for every container, so an `each items -> lines { }` header registers
`items` as a direct path — indistinguishable from a plain `items -> items` arrow.
Turning subtree inheritance on over that set would have manufactured coverage for
every leaf under every `each` header, which is exactly the failure the tri-state
was meant to prevent.

## Decision

**A container's coverage is computed from its descendant leaves and nothing
else**, and is reported as a three-valued `state` on `FieldCoverageEntry`:
`covered` when every descendant leaf is covered, `partial` when at least one but
not all are, `uncovered` when none are. Leaves stay binary and never report
`partial`. `mapped` is retained and _defined_ as `state !== "uncovered"`, so both
existing consumers keep the exact output they had — the gutter paints on
`covered || partial`, the review queue lists anything not `covered`. The rule
lives in `coverageForField`/`rollUpContainer` in `satsuma-core/src/coverage.ts`,
and `aggregateCoverage` re-derives container states from the _unioned_ leaves
(`recomputeContainerStates` in `coverage-rollup.ts`) rather than combining
per-mapping states, because two mappings that each cover half a record must
aggregate to `covered`.

Because a container is judged only on its leaves, **a container reference can no
longer manufacture coverage for its contents**. `each parcels -> packed { }` with
an empty body leaves `packed` uncovered, as does a computed arrow whose body is
prose describing a data gap.

**A whole-structure arrow covers its entire declared subtree.** An arrow
reference confers subtree coverage when both conditions hold:

1. **The declaration is a record-to-record correspondence** — `ExtractedArrow.kind`
   is `map` or `nested`. `each`/`flatten` headers open an iteration and assert no
   field-by-field correspondence; a `computed` arrow has no source at all, and
   inheriting from prose is what ADR-036 forbids.
2. **Its body enumerates no child arrows** — `ExtractedArrow.enumeratesChildren`
   is false. A header that lists child arrows is claiming those and no others, so
   `addr -> address { .street -> .line }` covers `street` and leaves `zip` a gap
   (the invariant `sl-qzy3` established). `addr -> address` and
   `addr -> address { }` both confer; a pipe-chain transform body does not count
   as enumeration, because spec §4.4 makes it a pipeline rather than a nesting
   scope.

`ExtractedArrow` carries `kind` and `enumeratesChildren` so that consumers read
these properties from extraction rather than re-deriving them from the CST —
ADR-020's principle, and the same split PRD 38 R4 recorded for arrow paths.
Expansion happens at **set-build time** (`expandWholeStructureRefs` in
`coverage.ts`), walking the resolver's declared field tree and adding the
subtree's paths before `buildCoveredFieldPaths` runs. It is deliberately not a
probe-time wildcard: the covered set stays a plain set of paths, so every
existing query over it, and every consumer holding the flat `Set<string>` view,
keeps working without learning a new rule. A record that is merely the _ancestor_
of a covered leaf still confers nothing downward.

This **amends ADR-034**, whose Decision says record fields "never vouch for their
descendants". They still never vouch for them _on the strength of being an
ancestor_ — the vouching now happens earlier, when a whole-structure arrow is
expanded, and only for arrows that assert it. ADR-034's counting rule is
unchanged: percentages still count leaf fields only, on each leaf's own flag.

## Consequences

**Positive:**

- The two contradictory definitions of a covered record are gone, replaced by one
  the consumers threshold differently. Cross-consumer parity (`sl-5nsv`) becomes
  testable rather than aspirational.
- Feature 36 gains the signal it needs: a record with 1 of 12 leaves mapped can
  render differently from a fully mapped one.
- The under-count ADR-034 accepted is closed. A workspace built on record-level
  copies no longer needs its `--fail-under` threshold set around a known
  understatement.
- Coverage gets _stricter_ where it was previously generous: an `each` header
  with an empty body, and a computed arrow into a record, no longer light up the
  gutter for containers nothing populates.
- The conferring kinds are listed positively, so a declaration kind added to the
  grammar defaults to asserting nothing about a subtree.

**Negative:**

- Figures move in both directions on real files, and neither direction is
  detectable from the diff of a `.stm` file — nothing in the source changed. The
  example corpus happens to contain no whole-structure arrow onto a record, so
  every shipped percentage is unchanged, which means the corpus does not
  demonstrate the change and cannot regress-test its headline case; the
  acceptance tests in `coverage.test.js` carry that load instead.
- The empty-body condition makes coverage sensitive to a distinction authors do
  not currently think about. Adding the first child arrow to `addr -> address`
  _reduces_ its coverage, from the whole subtree to that one field. That is the
  correct reading of what the author wrote, but it will surprise someone.
- `FieldCoverageEntry` grows a field that is redundant for leaves, and consumers
  now have two ways to ask "is this covered?". `mapped` is kept as the wider,
  older contract; a consumer that wants the container distinction must know to
  read `state`.
- `satsuma-viz`'s own `field-coverage.ts` still mirrors extraction rather than
  calling core, so the viz card's ratio does not yet reflect either change. That
  divergence is `sl-hcan`.

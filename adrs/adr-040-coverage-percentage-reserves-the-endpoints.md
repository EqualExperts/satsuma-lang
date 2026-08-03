# ADR-040 — A Coverage Percentage Reserves 100% and 0% for the Exact Endpoints

**Status:** Accepted
**Date:** 2026-08-03 (sl-8ba4)

## Context

ADR-034 settled _what_ a coverage percentage counts: leaf fields only, on each
leaf's own flag, computed in one place so that a CLI table, a `--fail-under`
verdict, a VS Code status bar and a viz overlay cannot disagree. It did not
address how the resulting ratio becomes the whole number every one of those
surfaces prints, and the answer inherited from the original implementation was
`Math.round`.

Rounding to nearest is the one reduction a merge gate cannot survive. Any
population large enough for a single leaf to be worth under half a percent
rounds up to 100:

    $ satsuma coverage rounding.stm --uncovered
      source  big_s  200/201  100%
      target  big_t  200/201  100%
        uncovered in big_t (target): 1 field
          f200
    $ satsuma coverage rounding.stm --fail-under 100 ; echo $?
    0

`--fail-under` exists so an incomplete spec blocks a merge, and 100 is precisely
the threshold a team writes once a spec is meant to be finished — so the defect
sat on the most-used setting, in the only direction that matters. The report was
independently wrong: `200/201 100%` claims completeness beside the field list
that contradicts it.

The failure is not in the gate. `evaluateGate` compares `totals.pct` deliberately,
because ADR-034's whole point is that the number a reviewer reads is the number CI
enforces. The failure is that `pct` was a figure no longer supported by the counts
it came from.

Nested schemas are where this bites, which is why it surfaced with feature 38: a
flat schema rarely has 200 leaves, and a four-level one reaches that easily.

## Decision

**The two endpoints are decided by the counts, not by arithmetic on them, and
everything between them floors.** `coveragePercentage(covered, total)` in
`satsuma-core/src/coverage-rollup.ts`:

- `covered === total` → **100**. The only way to print 100.
- `covered === 0`, or `total === 0` → **0**. The only way to print 0.
- otherwise → `floor(covered / total * 100)`, **clamped up to 1**.

Each clause answers a distinct failure. Reserving 100 is the fix: a gate at 100
now means every leaf. Flooring in between keeps every printed figure a claim the
counts support, so a threshold can be read as a floor rather than as a rounding
target. The clamp to 1 exists because flooring alone introduces the mirror-image
lie at the bottom — 1 of 201 floors to 0, and 0% is the review queue's strongest
claim, the one that reads as "nothing here is mapped". Partial work must stay
visible. `total === 0` reports 0 rather than 100 because a schema with no leaves
has nothing to cover, and calling that complete would let an empty schema satisfy
any threshold.

The rule is **exported**, not private, so a consumer that needs a percentage from
counts it holds shares this definition instead of reimplementing it — the same
reasoning that made `leafFieldEntries()` public in ADR-034. Every current
consumer reads `totals.pct` and therefore inherited the change without knowing
about it.

**The rejected alternative was to keep `Math.round` for display and gate on the
exact ratio** (`covered / total * 100 >= threshold`). It fixes the fail-open bug
without moving a single existing percentage, which is a real advantage. It was
rejected because it makes the report and the verdict disagree by construction:
`200/201 100%` printed directly above `--fail-under: target coverage 100% vs
threshold 100% — NOT met`. A reviewer investigating that has to know which of two
numbers to trust, and ADR-034 exists specifically so that question never arises.
Preserving a figure that overstates the spec is not worth the contradiction.

**Plain flooring with no special cases** was also considered and rejected for the
1/201 → 0% case above.

This **amends ADR-034**, whose counting rule is unchanged: leaves only, each on
its own flag, one implementation. This ADR fixes how that count is reduced to a
whole number and what its extreme values assert.

## Consequences

**Positive:**

- `--fail-under 100` means every leaf, and no threshold can be satisfied by a
  figure the counts do not support. The gate can only be passed by declaring what
  maps.
- The reviewer and CI still read one number. The alternative would have bought
  stability at the cost of that property.
- 0% and 100% become meaningful claims rather than buckets: seeing either tells
  you something exact about the schema.
- The rule is stated where the contract is read — `coverage --help` beside the
  exit codes, and SATSUMA-CLI.md — rather than only in code.

**Negative:**

- **Percentages move.** Any figure that was rounded up drops a point: `8/9` now
  reports 88% instead of 89%, `2/3` reports 66% instead of 67%. A threshold set
  just under a rounded-up figure (`--fail-under 89` against an 8/9 schema) starts
  failing. It was passing on an overstatement, but the break lands on the user,
  not on the author of the arrow, and no `.stm` diff explains it. The CHANGELOG
  entry carries the warning.
- Six test expectations across core, the CLI and the VS Code extension moved with
  the rule. Each carries a comment naming this decision, because a bare `66`
  where a reader expects `67` looks like a bug.
- The rule is three clauses where it was one expression, and two of them exist to
  prevent a misreading rather than to compute anything. A future reader may
  simplify it back to a floor without knowing what the clamp is for; the
  doc-comment and the boundary tests are the defence.
- Asymmetry remains between the endpoints: 100 requires exactness, while 1 is
  reachable by clamping from below. That is deliberate — overstatement and
  understatement are not symmetric risks for a gate — but it means the function
  is not a pure rounding rule and cannot be described as one.
- A percentage still cannot distinguish 200/201 from 198/201; both print 99%. The
  ratio beside it can, and every surface prints both, so the loss is confined to
  the number gated.

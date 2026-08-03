---
id: sl-8ba4
status: open
deps: []
links: []
created: 2026-08-02T21:40:55Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [feature-35, coverage, cli]
---
# coverage: --fail-under gates a rounded percentage, so 200/201 passes --fail-under 100

CoverageTotals.pct is Math.round((covered/total)*100) (satsuma-core/src/coverage-rollup.ts:220) and evaluateGate compares that rounded figure (satsuma-cli/src/commands/coverage.ts:499). Any schema large enough for one leaf to be worth less than half a percent therefore passes a 100% gate while a field is unmapped.

Reproduced with a 201-leaf schema, 200 leaves mapped:

  $ satsuma coverage rounding.stm --uncovered
    source  big_s  200/201  100%
    target  big_t  200/201  100%
      uncovered in big_t (target): 1 field
        f200
  $ satsuma coverage rounding.stm --fail-under 100 ; echo $?
  0

The report prints '100%' next to '200/201' and the gate agrees. --fail-under exists so a spec gap blocks a merge; this is the one direction that must not fail open. The threshold 100 is the case a team actually writes for a finished spec, and it is exactly where the rounding bites.

The report itself is also wrong independently of the gate: '200/201  100%' claims completeness. The symmetric case rounds the other way — 1/201 prints '0%' — which is misleading but errs safe.

Verified on the 8/9 case too: --fail-under 89 passes on examples/nested-iteration/pipeline.stm at 88.9%. That direction is defensible if documented; the 100% one is not.

## Design

Two candidate rules, and the choice belongs to the user:

(a) Floor the displayed percentage, except that covered === total reports 100 and covered === 0 reports 0. 200/201 then prints 99% and fails --fail-under 100, and 1/201 prints 0% only when nothing is covered — matching how coverage tools conventionally report.
(b) Keep Math.round for display but gate on the exact ratio: met = covered/total*100 >= threshold. Fixes the gate, leaves the display claiming 100% for an incomplete spec.

(a) is preferred: the number a reviewer reads and the number CI gates should be the same number, which is why the gate reads pct in the first place. Whichever is chosen, state the rounding rule in the command's help text next to the exit codes — it is part of the gate contract — and note the change in CHANGELOG.md, since existing percentages will move by a point.

The rule belongs in core's percentage() so the CLI, the LSP status bar and the viz card cannot disagree about it.

## Acceptance Criteria

A 201-leaf fixture with 200 leaves mapped reports below 100% and exits 3 under --fail-under 100. A fully-mapped schema reports 100% and exits 0. A schema with no covered leaf reports 0%. The rounding rule is documented in coverage --help and in SATSUMA-CLI.md, and tested at the boundary in core (percentage()) rather than only through the CLI.


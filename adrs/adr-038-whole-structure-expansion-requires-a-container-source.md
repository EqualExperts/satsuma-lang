# ADR-038 — Target-Side Whole-Structure Expansion Requires a Container Source

**Status:** Accepted
**Date:** 2026-08-02 (3ct-cs4y; feature 38)

## Context

ADR-037 gave a whole-structure arrow the power to cover its entire declared
subtree, gated on two properties of the declaration: its kind is `map` or
`nested`, and its body enumerates no child arrows. Its Decision text also said
the arrow must be a "record-to-record correspondence" — but the shipped code
never checked the field on the other side of the arrow, and could not:
`coverageForSchema` reports on one schema at a time and holds no field tree but
its own. The PR #421 review caught the mismatch and corrected the documentation
to describe what shipped, deferring the behavioural question to this ADR.

What shipped therefore expands whichever endpoint resolves to a container in the
schema being reported on, with no view of the other end. That produces two
readings of very different quality:

- **Source side.** `addr -> out`, a record into a scalar, credits every leaf of
  `addr` as consumed. This is correct. Source coverage asks "was this field
  read?", and a whole record was read whatever happens downstream.
- **Target side.** `full_name -> address`, a scalar into a twelve-leaf record,
  credits all twelve as populated. One scalar cannot fill twelve leaves, and the
  declaration says nothing about which one it would fill.

The second is an overstatement on the number `coverage --fail-under` gates, in
precisely the direction ADR-034 refused to risk when it chose to under-count the
whole-record arrow rather than over-count an ambiguous one. A spec with twelve
unmapped fields could pass a gate set at 100%.

A scan of the example corpus found the shape does not occur: of 270 arrows
eligible for expansion, every one is scalar-to-scalar — no arrow touches a
container on either side. So neither the risk nor ADR-037's feature is visible in
the corpus today, and any choice here is free of measurable consequence. That
cuts both ways, and it is why the decision is worth making now rather than after
someone has built a threshold on top of the generous reading.

The exposure is latent rather than hypothetical. Flat-source-into-nested-target
is a first-class use case for this language — `cobol-to-avro` and `edi-to-json`
are both that shape. Those examples avoid the problem by writing the enumerated
form, which coverage already reads correctly. The author who takes the shortcut
and writes the bare arrow is the exposed one, so the failure mode is *the author
skipped the detail and coverage rewarded them with 100%*.

## Decision

**Target-side whole-structure expansion additionally requires that at least one
of the arrow's source paths names a declared container.** Source-side expansion
is unchanged and keeps its own two conditions only.

Three sub-rules, each a decision rather than an implementation detail:

1. **Any one container source suffices.** A multi-source arrow
   (`addr, tag -> address`) asserts a single correspondence assembled from
   several inputs; a record among them makes the whole-structure reading
   plausible. Requiring every source to be a container would turn a mixed arrow
   into a gap.
2. **It fails closed.** A source path naming nothing declared, or naming a schema
   the resolver could not resolve, is not evidence of a record and does not
   confer. Under-counting is the safe direction (ADR-034), and a source path that
   resolves to nothing is already reported by `validate`'s `field-not-in-schema`.
3. **Resolved NL `@refs` are untouched.** They never expanded (ADR-036) and still
   do not.

This is **not a new kind of judgement.** The code already refuses to expand
unless the path resolves to a declared container — that is what makes
`descendantPathsOf` return nothing for a leaf. This decision applies the same
structural question to the other endpoint. Coverage still interprets no prose,
checks no types, and asks nothing it was not already asking.

**The arrow is not wrong, merely under-specified, and saying so is `lint`'s
job.** A new rule, `unenumerated-record-target`, warns when a `map`/`nested`
arrow with no enumerated children targets a container but carries no container.
It is the explanation for the gap coverage now reports: without it the author
sees twelve uncovered fields and no indication that one arrow is nearly
responsible for them. That split is the one SATSUMA-CLI.md already draws when it
says policy judgements about which gaps are acceptable remain `lint`'s.

The shared question — "what does this authored path name in this schema?" — is
answered once, by `declaredFieldKind` in `satsuma-core/src/coverage.ts`, which
both coverage and the lint rule call. Two implementations would let the number
and the explanation for it drift apart.

This **amends ADR-037**. Its two conditions still hold; this adds a third that
applies to the target side only, and replaces the "record-to-record
correspondence" wording its Decision used with a rule the code actually
implements.

## Consequences

**Positive:**

- The gated number can no longer be inflated by an under-specified arrow. The one
  remaining way to reach 100% is to declare what maps.
- The source side keeps the reading that is correct for it. Requiring containers
  on both ends would have made every `record -> scalar` arrow report its source
  leaves as unconsumed — false gaps in the review queue.
- The author gets told. The coverage drop and the lint warning arrive together
  and name the same arrow.
- Coverage and lint cannot disagree about what a path names, because they share
  `declaredFieldKind`.

**Negative:**

- Coverage now depends on the *source* schema resolving, so an unresolvable
  source silently costs a target record its subtree credit. That is the
  fail-closed direction, but it means a broken import can move a percentage
  without any arrow changing. `validate` reports the broken reference; coverage
  does not explain the interaction.
- A third condition is a third thing to explain, on a rule that already needed
  two. The asymmetry between the sides is principled but not obvious, and the
  ADR is now the only place it is set out in full.
- `computeMappingCoverage` resolves participating schemas before building its
  reference lists rather than inside the report loops. Equivalent work, but the
  ordering is now load-bearing and a future refactor could break the target-side
  test by moving it.
- Every percentage in the example corpus is unchanged (verified by diffing
  `coverage --json` across every example before and after), so the corpus again
  neither demonstrates the change nor regression-tests it. The acceptance tests
  in `coverage.test.js` carry that load, as they did for ADR-037.

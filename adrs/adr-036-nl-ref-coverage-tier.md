# ADR-036 — Resolved @refs Count Toward Coverage, as a Distinct Tier

**Status:** Accepted
**Date:** 2026-07-31 (sl-qxyl)

## Context

ADR-013 settled what an NL `@ref` means: "an NL `@ref` mention in a mapping
transform string carries the same lineage weight as a declared source field to
the left of an arrow", and such refs "are not second-class — they participate
fully in depth traversal, direction filtering, and reachability analysis". It
bound "all lineage-aware tools" to follow them, naming `arrows`, `graph`,
`lineage`, `field-lineage` and the VS Code field-lineage panel. Every one of
those does, marking the result `nl-derived`. `lint`'s `hidden-source-in-nl` rule
goes further: it treats an `@ref` to an undeclared schema as an *error*, and its
auto-fix edits the mapping's `source {}` block to match.

Feature 35 then introduced `satsuma coverage`, and excluded `@refs` from it —
"NL interpretation: a field populated *implicitly* by prose in a note block is
uncovered by definition" (`features/35-coverage-command/PRD.md:233`), restated
in `features/38-hierarchical-coverage/PRD.md:576`, in the `coverage.ts` module
comment ("deliberately *structural only*"), in `coverage --help`, and in
`SATSUMA-CLI.md:126`. That carve-out was never recorded as an amendment to
ADR-013, which remains Accepted and unsuperseded.

The reasoning behind the carve-out does not hold. It rests on equating "follows
an `@ref`" with "interprets natural language", and those are different acts.
Resolving `@net_amount` to a declared field is structural resolution of an
explicit reference: the author wrote `@` as a sigil meaning *this is a
reference*, and `resolveRef` in `satsuma-core/src/nl-ref.ts` resolves it against
the workspace index with no reading of the surrounding prose. The CLI's stated
position — "extracts structural facts and delivers NL content verbatim, does not
interpret natural language" — survives counting a resolved ref intact, exactly as
it survives ADR-013.

The cost of the carve-out is not marginal, because `-> target { "... @a and @b" }`
is a first-class way to declare a mapping, not an aside in a note block. For a
mapping whose sources appear only in NL, `coverage` reports every source field
uncovered:

    mapping load {
      source { src_a, src_b }
      target { tgt }
      -> gross_total { "Add @net_amount and @tax_amount" }
      -> final_total  { "@gross_total minus @discount" }
    }

    source  src_a   0/3   0%
    source  src_b   0/2   0%

`--uncovered` lists all five fields as the review queue, and the aggregate
"covered by no mapping" section — which `coverage --help` calls "the claim worth
acting on" — names fields that `field-lineage` traces without difficulty. A
reader who trusts that section will delete live fields.
`coverage --fail-under --role source` cannot be used at all on such a spec.

Two alternatives were rejected. Folding `@ref` coverage into an undifferentiated
`mapped: true` is the smallest change, but Feature 36 requires that NL-derived
hops be "visibly differentiated (they are inferred from prose, not declared —
reviewers must be able to tell)", and a single flag destroys that distinction at
the source rather than in the renderer. Gating the new behaviour behind
`--include-nl` preserves every existing number, but leaves the misleading
report as the default, which is the failure this ADR exists to remove.

## Decision

A leaf field counts as covered when a declared arrow in the mapping references
it **or** when a resolved `@ref` in that mapping names it. The two are reported
as distinct tiers over one denominator: `covered` is the sum, `covered_declared`
and `covered_nl` are its parts, and `total` is unchanged. A field covered both
ways counts once, in the `declared` tier — declared coverage is the stronger
claim and takes precedence.

ADR-034 is untouched and continues to govern the denominator: leaves only, on
each leaf's own flag, records excluded from both sides. This decision splits the
numerator; it does not change what is counted.

Only *resolved* refs count. An unresolved `@ref` contributes nothing — reporting
it is `lint`'s `unresolved-nl-ref`, and letting it count would make coverage
rise when a spec breaks. A ref carrying `context: "source_block"` counts toward
**source** coverage only: the mapping demonstrably reads that field to join or
filter on it, but the ref names no target field and so can never contribute
target coverage.

The rule lives in two places and nowhere else. `computeMappingCoverage()` in
`satsuma-core/src/coverage.ts` gains the resolved-ref paths alongside the
declared arrow paths it already collects, tagging each with its origin; and
`summarizeFieldCoverage()` in `satsuma-core/src/coverage-rollup.ts` derives every
count from those tags. Per ADR-034, consumers do not compute their own
denominators — and they must not compute their own declared/NL split either. Each
`FieldCoverageEntry` carries the tier that covered it, so a rendered field list
and the counts printed beside it cannot disagree.

`coverage --fail-under` gates the combined figure. The gate answers "is this
spec complete", and under ADR-013 an `@ref` is a declaration of intent, not a
hint.

## Consequences

**Positive:**

- Coverage stops contradicting an accepted ADR. Following a resolved `@ref` is
  now uniform across `arrows`, `graph`, `lineage`, `field-lineage`, `lint` and
  `coverage`, rather than five tools agreeing and one dissenting.
- `--fail-under --role source` becomes usable on prose-heavy specs, which is the
  population it matters most for.
- The aggregate "covered by no mapping" list becomes safe to act on. Its entire
  value is that a reader can delete or investigate what it names.
- The tier split preserves what the carve-out was protecting. A reviewer can
  still tell a declared arrow from an inferred one — in the numbers, not only by
  cross-referencing `nl-refs` — and Feature 36's overlay gets the distinction
  from core instead of reconstructing it.
- Requiring resolution, not mention, keeps the count honest: coverage cannot be
  raised by writing prose that refers to nothing.

**Negative:**

- ADR-013's acknowledged false-positive risk now reaches a merge gate. An `@ref`
  written purely as documentation inflates coverage, and ADR-013 records that
  there is no opt-out mechanism. Coverage previously could not be gamed by
  editing prose; it now can.
- Existing `--fail-under` thresholds need re-baselining. Percentages can only
  rise, so a threshold tuned against structural-only figures becomes weaker
  rather than failing loudly — the unsafe direction for a gate.
- The per-mapping JSON contract widens (`covered_declared`, `covered_nl`, and a
  per-field tier), which the VS Code gutter and the Feature 36 overlay both
  consume. `3cc-t6uo` — the status bar computing its own percentage — must be
  reconciled rather than carried, since a consumer with its own rule will now
  disagree on two axes instead of one.
- Coverage acquires a dependency on `@ref` resolution, so a resolution defect
  becomes a coverage defect. `sl-hrql` and `sl-ez36` must land first: until they
  do, refs inside `each` / `flatten` / `nested_arrow` resolve to fabricated field
  paths, and coverage would attribute coverage to fields that do not exist.
- Coverage is no longer derivable from the CST alone. It now needs the workspace
  index to resolve refs, the same departure ADR-013 recorded for `graph-builder`
  and `arrows`.

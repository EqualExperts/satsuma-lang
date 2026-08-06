---
id: gpt-ocmp
status: closed
deps: [gpt-pwze]
links: []
created: 2026-08-06T13:44:45Z
type: task
priority: 1
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, diff]
---
# cli: diff algebra and mutation oracle (R5)

diff has no generated coverage, and its failure modes are exactly the ones a property catches cheaply: reporting a change where none exists (comparing text rather than structure) and missing one that does.

## Design

Three properties over generated workspaces: diff(w, w) is empty; diff is empty across every R1 null mutation (reordering and reformatting are not changes); after one R1 defect mutation, diff reports that change and nothing else. Reuses R1's mutators, which is why this follows R2 rather than leading.

## Acceptance Criteria

Mutation check: making diff compare formatted text rather than structure produces a non-empty diff for a reformat null mutation, and the property fails naming it. Run and recorded in the closing note.


## Notes

**2026-08-06T16:19:34Z**

**2026-08-06T00:00:00Z** — handover note, written when R1 landed. Not a closing note.

R1 (`gpt-pwze`) is **done and merged into this branch** (commit `0bbdcab3`), so this ticket is unblocked.

## The gap in this ticket's own acceptance criteria — resolve it before starting

The PRD asks for three properties, and the second is *"`diff` is empty across every null mutation from R1 — reordering and reformatting are not changes."* Its mutation check is *"make `diff` compare formatted text rather than structure — a non-empty diff for a reformat null mutation."*

**R1 ships no reformat null mutator.** The three delivered are `reverse-declaration-order`, `split-across-files` and `rename-entity-consistently`. So the mutation check as written has nothing to fire on. Two ways out, and this ticket should pick one and say why:

- Add a `reformat` null mutator to `tooling/satsuma-scenario-gen/src/mutators.js`, rendering each file through core's `format()`. **But** `scenario-gen` may not depend on `@satsuma/core` — that edge is a build cycle — so the mutator cannot call the formatter. It would have to take already-formatted sources from the consumer, which is a different shape from every other mutator.
- Keep the reformat step in the CLI's adapter instead: render the workspace, run each file through `format()` there, and treat that as the reformat null mutation. This respects the dependency rule and is probably the right answer, but it means the reformat case is a *property-local* transformation rather than a `NULL_MUTATORS` entry — worth a comment saying so.

Note that R7 (`a3252a66`) already proved formatting preserves the extracted semantic index, so a reformat that changed `diff` would be a `diff` defect, not a formatter one.

## What `diff` already does — check before assuming a defect

`diffIndex(indexA, indexB): Delta` in `tooling/satsuma-cli/src/diff-engine.ts` is **already structural**, not textual. Two things it already handles, both from closed tickets:

- Transforms compare `canonicalBody`, the layout-independent pipe-chain serialization, not raw `body` (`sl-dxjh`).
- Anonymous mappings are re-keyed to position-independent structural ids by `normalizeAnonMappingKeys` before comparison, so byte-identical files at different paths diff clean (`sl-ndtz`).

So the mutation for the check has to be a real edit that makes `diff` textual — replacing a structural comparison with a source-text one — not merely disabling a normalisation.

## Contract facts from R1 you need

The same six that `gpt-vq0r`'s handover note lists — read that note, it is the fuller version. The ones that bite here specifically:

- `mutationNotApplicable` is a skip-this-sample, not a pass.
- `workspaceHasSchemaCycle` must exclude `cyclicWorkspaceArbitrary` from any property asserting a clean baseline.
- Four mutators have 8-19% applicability over the generated domain, so do not reduce `numRuns`.

## Adapters

`tooling/satsuma-cli/test/support/generated-workspace.ts` — `loadGeneratedWorkspace` into a temp dir, `disposeGeneratedWorkspace` after. R5 needs **two** loaded workspaces per sample (base and mutated), so dispose both; a property running 100 times leaks two directories per run otherwise.

## Third property is the sharp one

*"After one R1 mutation, `diff` reports that change and nothing else."* The "and nothing else" half is what catches a `diff` that over-reports, which is the failure mode a human reading a diff would never notice. Assert both directions.

**2026-08-06T18:59:07Z**

Cause: not a defect — R5 delivers the diff properties the PRD asks for. `diff`
had no generated coverage, and its failure modes are a false positive a reader
believes and a missing entry a reader cannot see.
Fix: added `tooling/satsuma-cli/test/generated-diff-algebra.test.ts` (18 cases,
CLI 1139 -> 1157) and `scenarioChangedDeclarations` to scenario-gen's
`ground-truth.js` (+5 cases, 42 -> 47). (commit immediately after 4c7ac5a2)

## Mutation check: run and recorded

The criterion asks that making `diff` compare formatted text rather than
structure produce a non-empty diff for a reformat null mutation. Replacing
`diffTransform`'s `canonicalBody ?? body` with `body` — the `sl-dxjh` defect —
fails exactly one case, the reformat property, naming the transform:

    diff reported a pipe chain's layout as a change (sl-dxjh):
    transforms.changed: [{ name: "clean_string", changes: [{
      kind: "body-changed",
      from: "trim\n     | uppercase\n       | md5",
      to:   "trim | uppercase | md5" }]}]

Reverted. **Finding it took measuring what the index actually carries.** An
`ExtractedWorkspace` has almost no layout in it — no whitespace, no raw source
— so most candidate "make diff textual" edits have nothing to bite on:
declaration rows do not move under the formatter (measured: 0 of 54 files), and
`normalizeAnonMappingKeys` already removes file paths. `TransformRecord.body` is
the **only** layout-bearing string in the whole index, which is why `sl-dxjh`
exists and why it is the only place this mutation could aim.

## Two corrections to the ticket's own design, both measured, both in the header

**`diff` must NOT be empty across every R1 null mutation.** The PRD says it
should be. It holds for `reverse-declaration-order` and `split-across-files`,
and it is false for `rename-entity-consistently` in 50 of 50 samples — correctly,
because a rename *is* a structural change and `diff` reports the old name
removed, the new added, and every referrer changed. The null mutators preserve
meaning for the **diagnostic** surface, which was R2's subject; they do not
preserve entity identity. The emptiness property therefore names the two
identity-preserving mutators, and rename is asserted through containment.

**The reformat step is property-local**, as this ticket's handover predicted:
R1 ships no reformat mutator and cannot, since `scenario-gen` may not depend on
core to reach a formatter. The property renders, formats through the CLI's own
`format`, and diffs. Not vacuous — measured, the formatter changes 50 of 54
generated files, aligning field types into columns — and the property asserts
that count is non-zero so it cannot become vacuous later.

## The oracle, and why it moved to scenario-gen

`scenarioChangedDeclarations(before, after)` answers "which entities may this
delta legitimately mention", from the two scenarios alone. It went into
`ground-truth.js` for the same reason `gpt-l9rp` moved the usage-site oracle
there an hour earlier: it is ground truth that follows from a scenario by
construction, and deriving it from `diff`'s output would compare `diff` with
itself. Keying is by kind and **authored ref** (`ns::name`); a first draft keyed
by bare name and produced six spurious "extra entity" reports across four
mutators, every one of them the oracle's fault rather than diff's.

## Four mutation kinds produce no delta, and that is correct

Named in `MUTATIONS_INVISIBLE_TO_DIFF` so the other eight stay honest: the two
duplicate mutators (every extractor merges a duplicate declaration, so the
structures are identical — 50/50 clean), `withhold-spread-import` (`Delta` has
no block type for imports) and `conflict-namespace-note` (nor for namespace
metadata). If `delete-mapped-field` ever went silent it is not on that list and
the property fails.

## One gap filed rather than left unsaid

No generated workspace declares a `transform` block — `scenario-gen` has no
transform in its model at all, measured as 0 of 54 rendered files containing a
pipe chain. Since that is the only shape that can distinguish a structural
comparison from a textual one, the reformat property takes a **literal fixture**
for it through `loadRenderedFiles`, and the domain gap is `gpt-l0nz`.

## Bonus property the ticket did not ask for

Antisymmetry: `diff(a, b)` and `diff(b, a)` must name the same entities and
agree on emptiness. Free, since every property already loads the pair, and it
catches an argument-order dependence no single-direction property can. Zero
violations over the whole domain.

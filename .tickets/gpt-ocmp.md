---
id: gpt-ocmp
status: open
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

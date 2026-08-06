---
id: gpt-vq0r
status: closed
deps: [gpt-pwze]
links: []
created: 2026-08-06T13:44:29Z
type: task
priority: 1
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, validate, lint]
---
# cli: validate and lint properties over mutated workspaces (R2)

The diagnostic surface is proved only in the direction someone thought to write a fixture for. Missed diagnostics are found by users; spurious diagnostics on legal-but-unusual input are found by users too, and more often, because a fixture author writes cases asking 'does it catch this?' and rarely 'does it stay quiet on this?'.

## Design

Properties in satsuma-cli driven through the existing test/support/generated-workspace.ts adapter, which writes to disk and loads through the entry file's import graph. For each R1 defect mutator: assert the pre-mutation workspace validates clean, apply the mutation, then compare the diagnostic set against expected as sets of (rule, file, entity) — both directions, so a missing entry is a missed diagnostic and an extra entry is a spurious one. Reported positions must land inside the mutated construct, NOT on an exact line — decided by the project owner 2026-08-06 (PRD decision 4), because an exact line couples the property to renderer layout choices scenario-gen deliberately owns. WorkspaceDefect.expected carries a position only as a hint for failure messages. Every null mutation must leave the diagnostic set unchanged. Separately: lint --select and --ignore partition the findings, so selecting a rule yields exactly that rule's findings from the unfiltered run. This ticket changes no diagnostic semantics, no rule severities and no output; a property that fails against current behaviour is a bug ticket.

## Acceptance Criteria

Mutation check 1: suppressing the duplicate-definition push in validate.ts checkDuplicates makes the property fail, naming the missing rule and the duplicated entity. Mutation check 2: making checkDuplicates fire on same-name entities in unrelated entry files makes a null-mutation property fail with a spurious diagnostic. Both are run and recorded in the closing note. Every property carries a purpose comment naming the invariant or defect class it defends, and failures report seed, mutation and shrunk Satsuma source.


## Notes

**2026-08-06T16:18:44Z**

**2026-08-06T00:00:00Z** — handover note, written when R1 landed. Not a closing note.

R1 (`gpt-pwze`) is **done and merged into this branch** (commit `0bbdcab3`), so this ticket is unblocked. Read `tooling/satsuma-scenario-gen/src/mutators.js`'s module header before writing a line — it states the contract, and the header is the spec.

## The exported surface you consume

`DEFECT_MUTATORS` and `NULL_MUTATORS` (arrays of `{ kind, mutate }`), the 15 mutators individually, `DIAGNOSTIC_RULES`, `expectedForSurface(defect, "validate" | "lint")`, `isWorkspaceDefect`, `workspaceHasSchemaCycle`, and the `WorkspaceDefect` / `PredictedDiagnostic` / `MutationNotApplicable` / `MutationResult` typedefs. All re-exported from `@satsuma/scenario-gen`.

## Six facts that will cost you a day each if you rediscover them

1. **Compare multisets, not sets.** One mutation can predict two diagnostics agreeing on `(rule, file, entity)` and differing only in which arrow raised them — deleting a mid-chain field is reported once as a target and once as a source. Set semantics silently stops checking the cascade the contract exists to state. This was verified empirically: the R1 oracle only passes under multiset comparison.
2. **`file` is workspace-relative** (`entry.stm`), not the absolute path a loaded diagnostic carries. Compare basenames.
3. **`entity` is only observable as a substring of the message.** Neither `SemanticDiagnostic` nor `LintFinding` carries an entity field — both are `(file, line, column, severity, rule, message)`. Each mutator documents the exact spelling it predicts, and it is always the spelling the *source text* uses.
4. **`validate --json` carries no `rule` field.** Go through `collectSemanticWarnings(index)` (what `test/support/generated-workspace.ts`'s `semanticProblems` already does), not the command's JSON.
5. **Do not reduce fast-check's run count.** Four mutators have low applicability over the generated domain — `point-nl-ref-outside-source-list` and `target-record-without-children` about 8%, `conflict-namespace-note` about 14%, `break-nl-ref-target` about 19%. Cutting `numRuns` would make those properties pass vacuously.
6. **`cyclicWorkspaceArbitrary` is not lint-clean to begin with** — it declares a real lineage cycle, about 4 samples in 60. Exclude it with the exported `workspaceHasSchemaCycle`, or you will read a pre-existing finding as a mutation's.

## Preconditions the property must assert

Assert the **pre-mutation** workspace produces no diagnostic before applying the mutation, and treat `mutationNotApplicable` as a skip-this-sample, not a pass. A vacuous mutation that looked like a mutation is the one failure mode this whole design guards against.

Positions are asserted by **containment in the mutated construct**, never equality with a line number (PRD decision 4). `expected[].line` is a hint for the failure message only.

## Adapters that already exist — do not write new ones

- `tooling/satsuma-cli/test/support/generated-workspace.ts` — `loadGeneratedWorkspace`, `semanticProblems`, `disposeGeneratedWorkspace`. Always dispose; a property runs this 100 times and will fill `tmpdir` otherwise.
- `tooling/satsuma-cli/test/support/run-cli-command.ts` — added by R6 (`6a5db6dc`) for in-process command runs. This is what the `lint --select` / `--ignore` partition property wants.
- `tooling/satsuma-cli/test/generated-inverse-relations.test.ts` — the house style for a generated CLI property, including how failure messages carry the shrunk source.

## Mutation checks this ticket must run and record

Both from the PRD's acceptance table. Run them **serially, with nothing else running against this worktree**, and revert before committing:

1. Suppress the `duplicate-definition` push in `validate.ts`'s `checkDuplicates` — the property must fail naming the missing rule and the duplicated entity.
2. Make `checkDuplicates` fire on same-name entities in unrelated entry files — the property must report a *spurious* diagnostic on a **null** mutation. This is the direction fixtures under-sample and the reason `sl-rw3e` existed.

## Known limitation, already filed

`unenumerated-record-target` is unreachable for spread-bearing schemas (`gpt-i1uv`) — `endpointKind` skips any schema whose `hasSpreads` is set rather than one whose spreads failed to resolve. `targetRecordWithoutChildren` declines that shape deliberately. Do not "fix" the mutator to predict a diagnostic the rule cannot emit.

**2026-08-06T18:32:58Z**

Cause: not a defect — R2 delivers the diagnostic properties the PRD asks for.
Every generated workspace in the repo was valid by construction, so `validate`
and `lint` were proved only by hand-written fixtures, in the "does it catch
this?" direction alone.
Fix: added `tooling/satsuma-cli/test/generated-diagnostic-properties.test.ts`
(55 cases, CLI 1084 -> 1139) — four properties over `workspaceScenarioArbitrary`:
the diagnostic set a defect predicts in both directions, position containment,
null mutations staying silent, and the `--select`/`--ignore` partition.
(commit immediately after c980a99e)

**Both mutation checks were run serially and recorded.**

1. Suppressing the `duplicate-definition` push in core `validate.ts`
   `checkDuplicates`: property 1 failed after 1 test on
   `duplicate-entity-within-file` and `duplicate-entity-across-files`, naming
   the missing rule and the duplicated entity —
   `missed: duplicate-definition/s0`. Property 2 failed with it. Reverted.
2. Keying `checkDuplicates` on "this name is visible from more than one file"
   rather than "declared twice" (the sl-rw3e shape): the *null*-mutation
   property `validate stays quiet after split-across-files` failed with two
   spurious `duplicate-definition` findings on a workspace whose declarations
   had merely been reorganised, and printed the whole rendered source. Reverted.

## Four things a later reader needs

**Comparison is a maximum bipartite matching, not a sorted-list compare.**
`entity` is only observable as a *substring* of the message, and substring
containment is not one-to-one: a message naming `s0.field_0` also contains the
entity `field_0`. A greedy pass can therefore consume the only observation
another prediction could have used and report a missed *and* a spurious
diagnostic where a valid pairing exists. Kuhn's algorithm pairs them exactly.
This is not theoretical — a probe over 60 workspaces produced 13 such
cross-pairings, all from `delete-mapped-field` and `retype-bare-arrow-target`
predicting the same rule and entity in two different mappings.

**Positions are asserted by containment in a top-level declaration, read from
the CST.** The prediction's `line` is never compared for equality — it is
routinely 3 lines off, exactly as PRD decision 4 anticipated. No extracted
record carries a declaration *end* row (`SchemaRecord.row` and friends are
start rows only), so `LoadedGeneratedWorkspace` now also exposes `parsed`, and
the property reads spans from `tree.rootNode.namedChildren`. Two relaxations,
both documented at the call site: an identical header line counts as the same
construct (the duplicate mutators add a second declaration with the same
header, and the rule reports against the copy while the hint locates the
original), and `lineage-cycle` compares declaration *kind* only — its anchor is
"the mapping declaring the first hop of a representative path", which is a
property of the rule's own traversal and not of the mutation.

**The baseline collapses to empty, which is why the precondition is an
assertion.** With `cyclicWorkspaceArbitrary` excluded via
`workspaceHasSchemaCycle` on the lint surface only (it is semantically valid,
so validate keeps the domain), every pre-mutation workspace is clean on both
surfaces — measured, 0/40 dirty under validate and 5/40 under lint, all five
cyclic. So `diagnostics(mutated) = diagnostics(base) + expected` collapses to
`diagnostics(mutated) = expected`, and the base's cleanliness is asserted
rather than assumed.

**The `--select`/`--ignore` property needed a vacuity guard.** Drawn uniformly
over all twelve mutators it ran in 65ms, because most defect mutators predict
only *validate* diagnostics and the run skipped with nothing to partition — a
green case asserting almost nothing. It now draws from
`LINT_PREDICTING_MUTATORS` (derived from the predictions, not hand-listed),
counts non-vacuous runs, and asserts a floor of a quarter of the run budget.

## Two contract fixes landed in R1's `mutators.js`

R2 is the first *TypeScript* consumer of the mutator contract, and it could not
type-check against it: the two result shapes are plain object literals, so
`applicable` was inferred as `boolean`, the union was not discriminated, and
`.workspace` was unreachable even after `isWorkspaceDefect`. Fixed by
annotating `mutationNotApplicable`, `finishDefect` and `nullMutation` with
their return types and declaring `isWorkspaceDefect` as a type predicate;
`expectedForSurface` also gained its parameter and return types. Behaviour
unchanged — scenario-gen's own suite still passes.

## Not done here

No diagnostic semantics, rule severity or command output changed, and no
property failed against current behaviour, so this ticket raises no bug.

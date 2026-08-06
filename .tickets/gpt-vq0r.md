---
id: gpt-vq0r
status: open
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

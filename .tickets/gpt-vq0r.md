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

Properties in satsuma-cli driven through the existing test/support/generated-workspace.ts adapter, which writes to disk and loads through the entry file's import graph. For each R1 defect mutator: assert the pre-mutation workspace validates clean, apply the mutation, then compare the diagnostic set against expected as sets of (rule, file, entity) — both directions, so a missing entry is a missed diagnostic and an extra entry is a spurious one. Reported positions must land inside the mutated construct (see the PRD's open question — do not tighten this to an exact line without the owner's answer). Every null mutation must leave the diagnostic set unchanged. Separately: lint --select and --ignore partition the findings, so selecting a rule yields exactly that rule's findings from the unfiltered run. This ticket changes no diagnostic semantics, no rule severities and no output; a property that fails against current behaviour is a bug ticket.

## Acceptance Criteria

Mutation check 1: suppressing the duplicate-definition push in validate.ts checkDuplicates makes the property fail, naming the missing rule and the duplicated entity. Mutation check 2: making checkDuplicates fire on same-name entities in unrelated entry files makes a null-mutation property fail with a spurious diagnostic. Both are run and recorded in the closing note. Every property carries a purpose comment naming the invariant or defect class it defends, and failures report seed, mutation and shrunk Satsuma source.


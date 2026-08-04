---
id: gcsc-qka8
status: closed
deps: []
links: []
created: 2026-08-03T14:12:53Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-39, tooling]
---
# Feature 39: correctness by default

Deliver Feature 39 from archive/features/39-correctness-by-default/PRD.md: move stable CST, path/ref, coverage, typecheck, lint, and FieldDecl invariants from prose and string conventions into compiler- and test-enforced contracts. This epic tracks the independently valuable roadmap stages; optional investigations I1 and I2 are not completion gates.

## Acceptance Criteria

R1-R8 are delivered through linked child tickets with their PRD acceptance tests passing; every child records its cause/fix note and passing relevant automated tests before closure; the feature PRD ticket map and status are reconciled when the epic closes; optional I1/I2 investigations do not block completion.

## Notes

**2026-08-04T10:50:29Z**

Cause: All R1–R8 delivery tickets were closed, but the epic and PRD still said in progress, the PRD remained under active features, and the product roadmap still described Feature 39 as an unscheduled proposal without preserving its two optional research follow-ons.
Fix: Marked Feature 39 implemented, archived its PRD, moved the shipped outcome into the roadmap, and recorded I1/I2 as explicitly deferred research; the complete repository check suite passes (commit immediately after 08cf0d9d).

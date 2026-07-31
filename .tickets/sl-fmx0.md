---
id: sl-fmx0
status: open
deps: [sl-joeq]
links: []
created: 2026-07-31T14:43:17Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, core]
---
# core: separate directly-covered paths from prefix-derived coverage

PRD 38 R1. Replace the flat Set<string> covered-path model with one that records WHY a path is covered: a set of directly-covered paths (an arrow wrote exactly this) kept separate from the ancestor relation, which is recomputable from it. This is the structural change the rest of the feature rests on — it is what makes the container tri-state (R2) and whole-subtree arrows (R5) expressible at all, and it is the fix 3cc-iedv independently identified as necessary.

## Design

Derive rather than store the answers consumers need: a leaf is covered iff its qualified path is directly covered OR it descends from a directly-covered container (R5); a container's state is computed from its descendant leaves (R2). Keep isCoveredFieldPath(path, set) working for consumers that only need the boolean so the change is additive at call sites that do not care. Note ticket 3cc-iedv (on branch feat/35-coverage-command, arrives on main when feature 35 merges) records the same requirement from the whole-record-arrow angle; close it under R5.

## Acceptance Criteria

Covered-path model distinguishes direct from derived coverage, with the distinction doc-commented as the public contract; isCoveredFieldPath retains its current signature and behaviour for direct+ancestor queries; a leaf beneath a directly-covered record reports covered while a leaf beneath a record that is merely an ancestor of a covered descendant does not; core coverage tests cover both; no consumer needs to change to keep working.


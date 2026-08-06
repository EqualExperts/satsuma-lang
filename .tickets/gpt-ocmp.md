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


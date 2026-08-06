---
id: gpt-clpj
status: open
deps: []
links: []
created: 2026-08-06T13:44:45Z
type: task
priority: 2
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, cli]
---
# cli: inverse-relation properties for where-used, find and arrows (R6)

where-used, find and arrows answer questions scenarioFieldEdges already states the answer to, but none of them has generated coverage. Cheapest requirement in the feature; listed last because the commands are read-only and their blast radius is the smallest.

## Design

For every declared field in a generated workspace, where-used returns exactly the arrows scenarioFieldEdges says touch it — both directions. find resolves every declared entity and nothing it does not declare. arrows emits every declared arrow of a mapping exactly once. Follows the pattern R3 establishes; uses the CLI's existing test/support/generated-workspace.ts adapter.

## Acceptance Criteria

Mutation check: dropping NL-derived edges from where-used makes the property fail with a declared arrow missing for an @ref-touched field. Run and recorded in the closing note.


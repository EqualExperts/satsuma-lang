---
id: gpt-idmq
status: open
deps: []
links: []
created: 2026-08-06T15:22:14Z
type: task
priority: 3
assignee: Thorben Louw
tags: [scenario-gen, testing]
---
# scenario-gen: arbitraries for a transform block and a namespaced metric

Feature 46 R6 (gpt-clpj) could only assert half of 'find and where-used report nothing the workspace does not declare', because the generated domain cannot produce two shapes:

- No arbitrary declares a `transform` block, so where-used's `transform_call` ref kind is only ever asserted EMPTY — the property proves nothing about it.
- No arbitrary declares a namespaced metric, so find.ts's `findBlockNode(root, "schema_block", "ns::name")` path is untested.

Both need new arbitraries in tooling/satsuma-scenario-gen/src/workspace-arbitraries.js. The model may need a transform-block shape too — workspace-model.js has no transform declaration today, only NL transform BODIES on arrows.

A related cost note, not correctness: nlRefWorkspaceArbitrary (workspace-arbitraries.js:360) and metricWorkspaceArbitrary (:436) are `fc.constant(null).map(...)`, so every property driven by them runs 100 identical samples. Four R6 properties do, costing roughly 500 redundant CLI invocations and temp-dir round-trips per run. Consistent with existing usage in tooling/satsuma-viz/test/generated-edge-completeness.test.js:179, so it is a deliberate convention to revisit, not a bug — either give them a real generated axis or run them with a reduced numRuns.

## Acceptance Criteria

A transform-block arbitrary and a namespaced-metric arbitrary exist, are documented per-axis the way the file's others are, and are wired into workspaceScenarioArbitrary. R6's where-used property asserts transform_call refs positively rather than only asserting the empty set. Decide the single-sample cost question explicitly and record the choice.


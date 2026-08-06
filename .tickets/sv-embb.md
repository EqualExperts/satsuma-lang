---
id: sv-embb
status: open
deps: []
links: []
created: 2026-08-06T13:20:10Z
type: task
priority: 2
assignee: Thorben Louw
tags: [viz, field-lineage, chain-view]
---
# sz-chain-view: distinguish unknown-field from no-lineage; add cycle + theme coverage

buildFieldChainFromWorkspace (tooling/satsuma-viz-backend/src/field-chain.ts) returns the same empty {upstream: [], downstream: []} FieldChainModel for a field that cannot be resolved at all as it does for a field that resolves fine but genuinely has no lineage. The CLI's field-lineage.ts (lines 95/107) distinguishes this case today: an unresolvable schema or field throws "Field '<x>' not found" with EXIT_NOT_FOUND. This is a residual gap identified while assessing Feature 40 (features/40-shared-field-lineage-view/PRD.md), which is being closed as superseded by Feature 36's sz-chain-view (see sl-iwlv, sl-nswc) -- that component already delivers the shared, browser-portable, Playwright-tested lineage view Feature 40 asked for, but never picked up two of its acceptance criteria: a distinct unknown-field render state, and proof (above the core traversal layer) that a cyclic chain renders without infinite recursion.

## Acceptance Criteria

buildFieldChainFromWorkspace/buildFieldChainFromSources distinguish an unresolvable field from a resolved field with empty upstream/downstream, matching the CLI's field-lineage.ts not-found behaviour, so FieldChainModel carries enough information for a host to render a different state.
sz-chain-view renders a defined unknown-field state, with a unit test in sz-chain-view.test.js.
A unit test feeds sz-chain-view a cyclic FieldChainModel and asserts it renders without infinite recursion or duplicate hop cards.
A Playwright spec in harness.test.ts opens the chain view against a cyclic fixture (reuse/adapt tooling/satsuma-cli/test/fixtures/lineage-cycle.stm) and asserts the rendered chain terminates and matches the CLI's cycle-truncated shape.
The chain view is captured light and dark in screenshots.spec.ts.
Full harness Playwright suite green via the watch-and-test.sh sentinel protocol; run-repo-checks.sh green.


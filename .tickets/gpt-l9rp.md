---
id: gpt-l9rp
status: open
deps: []
links: []
created: 2026-08-06T15:22:01Z
type: task
priority: 2
assignee: Thorben Louw
tags: [scenario-gen, lsp, refactor]
---
# scenario-gen: move the LSP's declared-usage-site oracle into ground-truth.js

Feature 46 R3 added tooling/satsuma-lsp/test/support/scenario-usage-sites.js — 'every place a generated workspace references an entity', computed from scenario data alone. That is ground truth that follows from a scenario by construction, which CLAUDE.md and @satsuma/scenario-gen's own index.js assign to that package; ground-truth.js already does exactly this for field paths and edges (scenarioDeclaredFieldPaths, scenarioFieldEdges).

Leaving it in the LSP guarantees the CLI duplicates it the moment it grows a references or rename property — and R4 (gpt-8izj) is the first consumer that will want it.

Note the boundary carefully. The ADAPTER (test/support/generated-workspace.js) must stay in the LSP and must NOT be shared with the CLI's: the CLI writes to disk and loads an import graph, the LSP indexes in-memory documents, and sl-rw3e exists precisely because those two scope duplicates differently (Feature 46 PRD decision 2). Only the scenario-derived expectation moves.

The oracle also restates the renderer's import derivation, including the withheldImports hole the R1 mutators added — moving it beside workspace-render.js is what stops those two drifting.

Also in scope, same argument: bareNamespacedWorkspaceArbitrary at tooling/satsuma-lsp/test/generated-reference-duality.test.js:157 is a scenario shape no other package can reach. Adding an arbitrary to workspace-arbitraries.js changes nobody's existing expectations.

## Acceptance Criteria

declaredUsageSites (and whatever it needs) lives in tooling/satsuma-scenario-gen/src/ground-truth.js, is exported from that package's index.js, and is covered by that package's own tests. The LSP's suite imports it and stays green with no change in test count. The LSP adapter itself does not move, and the reason is stated in its module comment. bareNamespacedWorkspaceArbitrary moves to workspace-arbitraries.js with the per-axis documentation the file's other arbitraries carry.


---
id: gpt-l9rp
status: closed
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


## Notes

**2026-08-06T18:39:46Z**

Cause: Feature 46 R3 put the declared-usage-site oracle in the LSP's test tree,
but "every place a generated workspace references an entity" follows from the
scenario by construction — the same class of thing `scenarioFieldEdges` and
`scenarioDeclaredFieldPaths` already are. Leaving it there guaranteed the CLI
would copy it the moment it grew a references or rename property, and R4
(gpt-8izj) is that consumer.
Fix: moved it into `tooling/satsuma-scenario-gen/src/ground-truth.js` under a
new section, exported from the package index, and gave it 11 hand-written cases
of its own (scenario-gen 31 -> 42). LSP suite unchanged at 317, as the
acceptance criterion requires. (commit immediately after 1ea2e638)

## Three decisions a later reader should know about

**The exports were renamed to the file's convention.** `declaredEntities`,
`declaredUsageSites` and `entityKeyForRef` became `scenarioDeclaredEntities`,
`scenarioDeclaredUsageSites` and `scenarioEntityKeyForRef`. Every other export
of `ground-truth.js` carries the `scenario` prefix, and it earns its keep in a
consumer: at a call site the prefix is what says "this came from the input, not
from the toolchain". `USAGE_KIND` moved unrenamed.

**`RESOLVABLE_USAGE_KINDS` did not move**, even though it lived in the same
file. It lists the usage kinds the LSP's definition provider resolves *today* —
a statement about that server's current behaviour, not ground truth a scenario
declares — so it now sits in `generated-reference-duality.test.js` beside the
pinned tests for the two kinds it excludes, with a comment saying why it stayed.

**`bareNamespacedWorkspaceArbitrary` moved but stays out of the default
domain.** R3's comment argued it should not be shared, because the arbitraries
are consumed by other packages' ground truth, "which reads an authored ref as
canonical". That argument is against *changing an existing* arbitrary or folding
this one into `workspaceScenarioArbitrary` — which would silently move other
packages' expectations, since `canonicalEntityRef` reads a bare ref as
file-scope unconditionally. Adding it as a separate export changes nobody's
expectations, and the reasoning is now recorded on the arbitrary itself rather
than in a test file no other package reads.

## What deliberately did not move

The **adapter** (`tooling/satsuma-lsp/test/support/generated-workspace.js`)
stays in the LSP, and its module comment now says why: the CLI's equivalent
writes to disk and loads an import graph, this one indexes in-memory documents,
and `sl-rw3e` exists precisely because those two scope duplicates differently
(Feature 46 PRD decision 2). A shared adapter would erase the distinction the
properties exist to test.

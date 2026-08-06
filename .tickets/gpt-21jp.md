---
id: gpt-21jp
status: closed
deps: []
links: []
created: 2026-08-06T13:44:29Z
type: task
priority: 1
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, lsp]
---
# lsp: scenario adapter, and definition/references duality (R3)

satsuma-lsp is the only consumer package with no dependency on @satsuma/scenario-gen; its 26 test files are all fixture-driven. Three of its features are inverse relations over ground truth the generator already states, so they need no new oracle — only an adapter. references.ts and rename.ts both delegate to workspace-index.ts (resolveDefinition, findReferences, resolveReferenceKey), so one adapter reaches all three.

## Design

Add tooling/satsuma-lsp/test/support/generated-workspace.ts: render a generated workspace to in-memory documents, build a WorkspaceIndex, expose position lookup for a declared entity or a usage site. The adapter is as much the deliverable as the properties — it is the first generated suite in the LSP. Deliberately NOT reused from the CLI: the CLI adapter writes to disk and loads an import graph, the LSP indexes a folder of in-memory documents, and sl-rw3e exists precisely because those two scope duplicates differently — a shared adapter would hide the defect class this feature targets. Properties over workspaceScenarioArbitrary, including the namespaced and multi-file domains where the reference key is not the authored spelling: references(decl) is exactly the declared usage sites; definition(usage) is the declaration for every usage; duality (x in references(d) iff definition(x) = d); includeDeclaration toggles exactly the declaration site.

## Acceptance Criteria

Mutation check: making resolveReferenceKey return the authored spelling instead of the canonical name makes the duality property fail, and the counterexample names a namespaced usage site missing from references. Run and recorded in the closing note. The adapter is documented with a module comment stating what it owns and why it is not shared with the CLI's.


## Notes

**2026-08-06T15:29:04Z**

**2026-08-06T00:00:00Z**

Cause: `satsuma-lsp` was the only consumer package with no `@satsuma/scenario-gen` dependency; all 26 of its test files were fixture-driven, even though references/definition/rename are inverse relations over ground truth the generator already states.
Fix: added `test/support/generated-workspace.js` (in-memory documents plus a `WorkspaceIndex` and position lookup), `test/support/scenario-usage-sites.js` (the declared-usage-site oracle) and `test/generated-reference-duality.test.js` — 14 properties. LSP suite 303 -> 317. (commit immediately after fb2d406e)

Mutation check run as the acceptance criteria require. `resolveReferenceKey` lives in `@satsuma/viz-backend/src/workspace-index.ts:445`, not the LSP (the LSP module is a thin re-export). Making it return the authored spelling — deleting the `::` and namespace-local branches so it returns `name` unchanged — fails two properties, including the duality one, with exactly the predicted counterexample:

    entry.stm:10:13 "s0" (source) resolves to ns_a::s0
      but is missing from references(ns_a::s0)

on a shrunk two-schema workspace inside `namespace ns_a`. Reverted; `viz-backend/src` is byte-identical to `main`.

The adapter is deliberately not shared with the CLI's, and its module comment says why: the CLI writes to disk and loads through the entry file's import graph while the LSP indexes in-memory documents, and sl-rw3e exists because those two scope duplicates differently.

Two corrections to the ticket's own assumptions:

- The ticket asked for `test/support/generated-workspace.ts`. The LSP's test script is `node --test test/**/*.test.js` — plain JS against compiled `dist/`, no tsx loader — so a `.ts` support module would not load. Written as `.js`, matching every existing file in that tree.
- The properties initially asked the whole-folder index, but every real request goes through `server.ts`'s per-document `scopeIndex(uri)`. A probe over a three-file generated chain showed find-references from `schema s1`'s declaration in `part1.stm` returns 1 of its 3 declared sites once scoping is applied: imports point one way only, so the entry file's `target { s1 }` and `import { s1 }` both vanish. That is pinned as its own property over `multiFileWorkspaceArbitrary` rather than left as an invisible exclusion.

Four gaps this suite found are pinned as falsifiable tests asserting today's behaviour, each filed:

- `gpt-jwek` — three go-to-definition gaps (metric `source` token, the schema prefix of a qualified arrow path, a `namespace` name). One cause seen three times: `findNodeContext`'s case list is narrower than what `workspace-index` indexes.
- `gpt-bc1x` — the import-scope gap, which is a **rename correctness** bug rather than a navigation one. Rename is scoped identically, so renaming from a downstream declaration leaves an upstream import naming a symbol that no longer exists. **R4 (`gpt-8izj`) must state which index it asks**: a round-trip property built on the whole-folder index would prove a round-trip the real server does not achieve.

Deferred as `gpt-l9rp`, not done here: `scenario-usage-sites.js` is ground truth that follows from a scenario by construction, which CLAUDE.md and this package's own index.js assign to `@satsuma/scenario-gen` beside `scenarioFieldEdges`. Leaving it in the LSP guarantees the CLI duplicates it as soon as it grows a references property. `bareNamespacedWorkspaceArbitrary` belongs in `workspace-arbitraries.js` for the same reason. Both were blocked at the time because a parallel agent held `scenario-gen/src`; the ticket records the boundary (the adapter stays, only the expectation moves).

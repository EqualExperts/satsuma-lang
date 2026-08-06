---
id: gpt-8izj
status: open
deps: [gpt-21jp]
links: []
created: 2026-08-06T13:44:45Z
type: task
priority: 1
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, lsp]
---
# lsp: rename round-trip over generated workspaces (R4)

Rename is the one LSP feature that writes. It is currently proved by fixtures only, and a rename that misses a cross-file edit corrupts a workspace silently — the result still parses.

## Design

For every entity in a generated workspace, rename it to a name the workspace does not use, apply the WorkspaceEdit, reparse, and assert: the workspace still validates clean; the declared edge set is identical modulo the rename; no occurrence of the old name survives; no occurrence of an unrelated entity's name changed. The fresh-name choice belongs to the property, not to the arbitrary — renaming onto an existing name is a legitimate collision the editor may reject, and is a separate case rather than part of the round-trip. Reuses R3's adapter.

## Acceptance Criteria

Mutation check: dropping the cross-file edits from the rename WorkspaceEdit makes the round-trip fail with either a surviving old-name occurrence or a broken edge. Run and recorded in the closing note. The collision case is either covered by its own assertion or explicitly deferred with a reason.


## Notes

**2026-08-06T16:19:08Z**

**2026-08-06T00:00:00Z** — handover note, written when R3 landed. Not a closing note.

R3 (`gpt-21jp`) is **done and merged into this branch** (commit `711dcb7c`), so this ticket is unblocked.

## Read this first: the ticket as written can produce a worthless property

R3 found that **every real references / definition / rename request goes through `server.ts`'s per-document `scopeIndex(uri)`** = `createScopedIndex(wsIndex, getImportReachableUris(uri, wsIndex))` (`src/server.ts:536-538`, applied to rename at `:347-359`). Import reachability points one way — from an importing file to what it imports — so a rename driven from a **declaration in a downstream file cannot see the upstream files that import it**.

Measured over a three-file generated chain: find-references from `schema s1`'s declaration in `part1.stm` returns **1 of its 3** declared usage sites once scoping is applied. The entry file's `target { s1 }` and `import { s1 }` are both dropped. A rename from that position therefore leaves the upstream import naming a schema nothing declares — the workspace no longer validates.

That is filed as **`gpt-bc1x`** and is a genuine rename-correctness bug, not a test artefact.

**So this ticket must state which index it asks, out loud, in the property's purpose comment.** A round-trip property built on the whole-folder index would prove a round-trip the real server does not achieve — green, and meaningless. Two defensible options, and the choice belongs to this ticket:

- Assert the round-trip against the **whole-folder** index and pin the scoped behaviour as a known gap (what R3 did for references), noting `gpt-bc1x` as the fix that will turn the pin red; or
- Assert the round-trip against the **scoped** index and expect it to fail today, which makes this ticket blocked on `gpt-bc1x`.

Pick one deliberately. Do not pick one by accident.

## What already exists — reuse, do not rebuild

- `tooling/satsuma-lsp/test/support/generated-workspace.js` — the adapter: renders a workspace to in-memory documents, builds a `WorkspaceIndex`, and exposes `findReferenceSites` (whole-folder), `findReferenceSitesInImportScope` (what the server actually asks), `definitionSites`, `declarationSite`, and `textAt`. The module header documents which index each accessor uses.
- `tooling/satsuma-lsp/test/support/scenario-usage-sites.js` — `declaredUsageSites`, the oracle: every place a generated workspace references an entity, computed from scenario data alone. (Filed to move into `@satsuma/scenario-gen` as `gpt-l9rp`; if that lands first, import it from there instead.)
- `tooling/satsuma-lsp/test/generated-reference-duality.test.js` — the house style, including the pinned-gaps pattern for behaviour you are recording rather than endorsing.
- `@satsuma/scenario-gen`'s `renameEntityConsistently` null mutator already states the invariant "the edge set is identical modulo the rename", and lists the five places a reference can hide (mapping source and target lists, arrow endpoints, NL `@ref`s, metric `source` tokens). Use it as the expected-shape oracle rather than deriving one.

`computeRename(tree, line, character, uri, index, newName)` and `prepareRename(...)` are in `src/rename.ts`; both delegate to `workspace-index`'s `resolveDefinition` / `findReferences` / `resolveReferenceKey`, which live in `@satsuma/viz-backend/src/workspace-index.ts`, **not** in the LSP (the LSP module is a thin re-export — this surprised R3 and will surprise you).

## Design points the PRD is explicit about

The **fresh-name choice belongs to the property, not the arbitrary**. Renaming onto a name the workspace already uses is a legitimate collision the editor may reject, and is a separate case rather than part of the round-trip.

Assert all four: the workspace still validates clean; the declared edge set is identical modulo the rename; no occurrence of the old name survives; and no occurrence of an *unrelated* entity's name changed. The last one is the half a naive property omits.

## Mutation check this ticket must run and record

Drop the cross-file edits from the rename `WorkspaceEdit` — the property must fail with a surviving old-name occurrence or a broken edge. Run it serially with nothing else running against this worktree, and revert before committing.

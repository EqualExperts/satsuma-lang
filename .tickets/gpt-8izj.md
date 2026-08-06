---
id: gpt-8izj
status: closed
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

**2026-08-06T18:49:57Z**

Cause: not a defect — R4 delivers the rename round-trip the PRD asks for. Rename
is the only LSP feature that writes and the only one whose failure is silent: a
missed occurrence leaves a workspace that still parses.
Fix: added `tooling/satsuma-lsp/test/generated-rename-roundtrip.test.js` (6
cases, LSP 317 -> 323) — three round-trip properties, the collision case, and
two pinned gaps. (commit immediately after b314445a)

## The index question, answered deliberately

**The properties compute the rename against the whole-folder index, and the
scoped behaviour is pinned instead.** Both defensible options were on the table
(see this ticket's handover note). This one was chosen because the properties
then state what a correct rename must achieve, while the pin states what today's
server achieves — and `gpt-bc1x`'s own acceptance criterion is satisfied either
way, since it asks that R4 *state which index it asks* and that the real
server's behaviour be held to something falsifiable. Asserting the round trip
against the scoped index today would have made the whole file fail for one known
reason, which is a worse way to record one known reason. The file's header says
all of this out loud, as the handover demanded.

The pin measures it rather than describing it: over a two-file chain where `s0`
is declared downstream and used upstream, the scoped rename produces strictly
fewer edits than the whole-folder one, and applying what the server would
actually send leaves `import { s0 } from "./part1.stm"` naming a schema nothing
declares.

## Mutation check: run and recorded

Dropping every edit outside the invoking file (`delete changes[key]` for
`key !== _uri` at the end of `computeRename`) fails two of the three round-trip
properties immediately, with the surviving old name in the message:

    renaming schema 's1' to 'renamed_s1' broke the workspace:
    -- entry.stm
    import { s1 } from "./part1.stm"
    ...
      target { s1 }

Reverted. **A trap worth recording: `npm run build` in satsuma-lsp is esbuild's
bundle, and the per-module `dist/*.js` the tests `require` come from
`npm run compile` (tsc).** The first mutation run appeared to *pass* — the
property did not fail — purely because `turbo run build --filter=@satsuma/lsp`
never rebuilt the file under test. A mutation check that mysteriously fails to
fail is the signal to check what the test actually loaded.

## Two bugs found, both filed and both pinned

**`gpt-fjo7` — rename does not rewrite NL `@ref` mentions.** Renaming schema
`s0` leaves `@s0.field_1` inside a transform body naming a schema that no longer
exists. The workspace still parses; `satsuma validate` reports
`unresolved-nl-ref` on it. Mechanism: the index files an `@ref` under the field
path it names (`s0.field_1`, context `nl`), not under the schema, so
`findReferences(index, "s0")` never reaches it. The properties exclude entities
an NL `@ref` mentions — computed from the scenario by
`entitiesMentionedByNlRefs`, never by noticing the toolchain got it wrong — and
the gap has its own pinned test on a minimal fixture.

**`gpt-68ka` — the LSP reports no `unresolved-nl-ref` at all**, so the editor
does not show the damage `gpt-fjo7` causes. Cause is already documented in code:
`semantic-diagnostics.ts`'s `buildSemanticIndex` carries
`nlRefData: not available (LSP does not extract NL ref data)`, and core's
`checkNLRefs` iterates exactly that field.

## One correction to my own first draft, worth not repeating

The collision case initially renamed a schema onto *any* other schema's bare
name and expected a refusal. It failed — correctly. A file-scope `staged` and a
`warehouse::staged` are two different entities, so renaming `raw` to `staged`
beside a `warehouse::staged` is legal and the server rightly allows it. The case
now picks two schemas sharing a namespace, and counts how many samples actually
reached a collision so it cannot pass vacuously.

## What the round trip asserts

All four the ticket names, in one walk per entity because they share the edit:
the workspace still validates clean (via the real
`computeSemanticValidationDiagnostics`, unioned over every document); every
entity's usage sites equal `scenarioDeclaredUsageSites` with the renamed key
swapped; no reference to the old key or old text survives in the re-indexed
result; and no unrelated entity's sites changed — the last folded into the same
comparison, since "an unrelated entity changed" and "the renamed entity lost a
site" are one check against different keys.

Three domains, named separately so a counterexample is the shape under test:
the shared domain, `multiFileWorkspaceArbitrary` (the cross-file half), and
`bareNamespacedWorkspaceArbitrary` (where the key is not the text at the
cursor — `sl-p256` in its writing form).

The adapter gained `renameEdit`, `renameEditInImportScope`,
`applyWorkspaceEdit` and `semanticProblems`. None reimplements anything:
`computeRename` is the production function and applying a `WorkspaceEdit` is
what any client does with one.

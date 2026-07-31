---
id: sl-5sjp
status: closed
deps: []
links: []
created: 2026-07-31T13:13:05Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ce11
tags: [feature-35, cli]
---
# cli: replace the CLI's duplicate FieldDecl with core's, exposing field declaration positions

PRD 35 open question 1, resolved YES in user review: per-field coverage entries in CLI output must carry the declaration line number, enabling editor-jump links in downstream UIs.

## Design

Reframed after doc review 2026-07-31 — the work is smaller and differently shaped than originally written. The positions already exist: core FieldDecl carries startRow/startColumn, "always set by extractFieldTree" (satsuma-core/src/types.ts:113-127, added by aa-65ni). The CLI cannot see them because satsuma-cli/src/types.ts:37-45 keeps a divergent structural copy of FieldDecl that omits both fields. So this is not "add position tracking to the index-builder" — it is delete the CLI's clone and re-export core's type. That duplicate is itself a Core vs Consumer violation.

One case needs a decided answer rather than an accident: fields materialised by fragment-spread expansion (spread-expand.ts, deepCopyFields) have no declaration row of their own. Decide explicitly whether they carry the spread site's position or report line as absent. They must never report a silently-wrong 0 — an editor-jump link would land on line 1 of the wrong file. Note core's FieldCoverageEntry.line doc-comment currently says "CLI: 0 when not available from the index"; update it to match whatever is decided here.

## Acceptance Criteria

CLI's duplicate FieldDecl interface removed and core's re-exported in its place (no structural clone remains); startRow/startColumn survive the CLI's deepCopyFields and spread-expansion paths; spread-expanded fields have the decided, documented position behaviour and never report a misleading 0; unit tests assert positions for a minimal nested-schema snippet and for a spread-expanded field; core's FieldCoverageEntry.line doc-comment updated; no regression in existing CLI tests.


## Notes

**2026-07-31T13:57:57Z**

Cause: satsuma-cli/src/types.ts kept a structural clone of core's FieldDecl that omitted startRow/startColumn. The positions were present on the objects at runtime (extractFieldTree always sets them, aa-65ni) — verified by satsuma fields --json, which has been emitting them all along — but invisible to the type checker, so no CLI command could read them.
Fix: deleted the clone and re-exported core's FieldDecl. Added src/field-positions.ts owning the declaration-row rule: a spread-expanded field is reported at the consuming entity's block row, following the cbh-5lzd precedent already used by find, because its own startRow is a row in the fragment's file while the reported file is the consuming schema's. Provenance is inherited down the tree, since only the field copied directly out of the fragment carries fromFragment. Absent positions propagate as undefined, never 0. FieldCoverageEntry.line was made optional in core with a matching doc-comment (commit in sl-gsxu). 912 CLI tests pass; eslint clean.

---
id: sl-5sjp
status: open
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


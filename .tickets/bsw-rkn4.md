---
id: bsw-rkn4
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, viz-backend, adr-053]
---
# lsp: find-references and rename never see ^. / $. escape paths

`extractArrowFieldName` / `extractArrowFullPath` (`tooling/satsuma-viz-backend/src/workspace-index.ts:924-985`) strip only a leading `.`, so `^.transect_ref` is indexed under key `"^"` / `"src.^.transect_ref"` and `$.sid` under `"$"`. caf9dd77 updated only `definition.ts`.

Repro: inside `flatten transects.sightings -> tgt { ^.transect_ref -> tref  $.survey_id -> sid }`, references at the `transect_ref` or `survey_id` declaration return `[]` (the `.species` control in the same block is found). On `examples/ancestor-escape/pipeline.stm`, references from `colony_survey.transect_ref` return only the target-side `transect_ref`.

## Acceptance Criteria

- The index keys escape-path usages by their container-resolved field (reuse core's resolution, e.g. `qualifyChildArrowPath` / `resolveAuthoredPathAgainstContainer`, rather than re-stripping text).
- LSP tests: references and rename include `^.` and `$.` sites, red before the fix.

## Notes

**2026-10-06T18:39:40Z**

Cause: the workspace index built its reference keys from arrow-path text, so `^.x` and `$.x` were filed under "^" and "$" and never met the field they name. Already fixed by 435054e5 (bsw-89wr), which keys every arrow path by its container-resolved field through core's `resolveArrowPathInPlace`.
Fix: added the LSP tests the acceptance criteria ask for: references from the declarations to `^.`/`$.` sites and back, and a computeRename that rewrites both sites and keeps the marker. All four fail with 435054e5^'s workspace-index.ts and pass now. Field rename stays gated off by prepareRename, so the rename test pins computeRename's edits only. (commit immediately after 435054e5)

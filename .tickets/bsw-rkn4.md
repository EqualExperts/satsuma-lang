---
id: bsw-rkn4
status: open
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

---
id: bsw-pv7a
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, vscode, adr-053]
---
# lsp: satsuma/actionContext returns invalid field paths inside each/flatten (breaks Trace field lineage)

`normalizeArrowPath` / `inferArrowFieldPath` (`tooling/satsuma-lsp/src/action-context.ts:171-197`) ignore the enclosing container and the escape prefixes. The result feeds VS Code's "Trace field lineage" (`vscode-satsuma/src/extension.ts:99`).

| Cursor on (inside `flatten transects.sightings`) | fieldPath returned | Expected |
|---|---|---|
| `^.transect_ref` | `src.^.transect_ref` | `src.transects.transect_ref` |
| `$.survey_id` | `src.$.survey_id` | `src.survey_id` |
| `.species` | `null` | `src.transects.sightings.species` |
| bare `code` | `src.code` | `src.transects.sightings.code` |

## Acceptance Criteria

- actionContext resolves arrow paths through core's container resolution; tests cover the four rows above.

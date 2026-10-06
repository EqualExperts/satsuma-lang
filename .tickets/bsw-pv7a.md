---
id: bsw-pv7a
status: closed
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

## Notes

**2026-10-06T18:42:20Z**

Cause: action-context.ts built the field path from the arrow's own text and prefixed the mapping's schema, ignoring the enclosing each/flatten and the `^.`/`$.` escapes; `.species` had no arrow context at all because definition.ts read an empty first segment. Commit 435054e5 (bsw-89wr) already fixed both: actionContext now resolves the path in place through core's `resolveArrowPathInPlace`.
Fix: no code change needed. Added tests for the four rows above plus source and target paths inside nested `each`; all six fail when action-context.ts is reverted to 435054e5^ and pass now (commit immediately after 57a84d37).

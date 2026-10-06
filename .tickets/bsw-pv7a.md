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

**2026-10-06T19:49:46Z** (review follow-up)

Cause: with the cursor on an arrow path's first segment, definition.ts's `tryArrowSchemaPrefixContext` matched it against the mapping's schema names on the raw text, and action-context.ts built the field path from `rawPath` without core's container resolution. Inside `each orders`, `src.x` (the field orders.src.x) therefore traced and jumped to the top-level `src.x` when the cursor was on `src`, but to `src.orders.src.x` when it was on `x`.
Fix: the schema-prefix context now applies only when the segment is still first after core resolves the path (mapping-body level or after `$.`), and action-context resolves `arrow_schema` paths through `resolveArrowPathInPlace` like the other arrow kinds. Added action-context and go-to-definition tests for the shadowed first segment and the mapping-level prefix (commit immediately after b8c6facf).

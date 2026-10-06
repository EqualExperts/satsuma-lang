---
id: bsw-s9pd
status: open
deps: []
links: [bsw-ep0m]
created: 2026-10-06T18:02:45Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, fragments]
---
# cli: context, schema --json, match-fields and summary expand only schema-level spreads

Follow-up from bsw-ep0m. These commands still build their field list as
`[...entity.fields, ...expandEntityFields(...)]`, which inlines schema-level
spreads only. A spread inside a record body, or inside a record a fragment
supplies, is left out:

- `commands/context.ts` (schema rendering, ~line 292)
- `commands/schema.ts` `printJson` (~line 211)
- `commands/match-fields.ts` (~line 78)
- `commands/summary.ts` `totalFieldCount` (counts top-level fields only)

`fields`, `arrows`, `field-lineage`, `nl` and `meta` now use core's
`expandDeclaredFields` (directly or through `field-lookup.ts`), which sees
through every depth.

## Acceptance Criteria

- Each command above builds its field tree with `expandDeclaredFields`, or the
  ticket records why top-level-only expansion is the intended contract there.
- A test per changed command uses a fixture with a spread inside a record
  (`tooling/satsuma-cli/test/fixtures/spread-field-lookup.stm` has every shape).

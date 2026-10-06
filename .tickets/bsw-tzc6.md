---
id: bsw-tzc6
status: closed
deps: []
links: []
created: 2026-10-06T09:57:03Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, arrows, namespaces]
---
# cli: arrows finds nothing for a field of a namespaced flatten target schema

```satsuma
namespace n {
  schema src { items list_of record { sku STRING } }
  schema fact { sku STRING }
  mapping `m` { source { src } target { fact }  flatten items -> fact { .sku -> sku } }
}
```

`satsuma arrows n::fact.sku` prints "No arrows found" (exit 1); `field-lineage n::fact.sku`, and the same file without the namespace, return `items.sku -> fact.sku`. Canonical example: `satsuma arrows mart::species_fact.species_code examples/seabird-colony-lineage/mart.stm` fails the same way. The arrow target is stored as `fact.sku`, but `pathExistsInSchema` (`tooling/satsuma-cli/src/commands/arrows.ts:143-147`) only strips the `n::fact.` prefix. Pre-existing.

## Acceptance Criteria

- `arrows` matches flatten-to-schema targets inside namespaces; test with the seabird example query.

## Notes

**2026-10-06T18:17:03Z**

Cause: Inside a namespace, a flatten to the target schema records its children with the schema's bare name (`fact.sku`), while the index keys the schema as `n::fact`. The CLI's own text-prefix checks in `buildFieldArrows`, the `arrows` field matcher and the `--json` qualifiers knew only the index spelling, so the arrow was keyed as `n::fact.fact.sku`, rejected by every lookup, and printed with a doubled prefix.
Fix: New `arrowPathInSchema` in tooling/satsuma-cli/src/index-builder.ts wraps core's `schemaLocalFieldPath` (the rule coverage and lint use) and now drives `buildFieldArrows` and the `arrows` matcher; `--json` endpoints and the NL dedup go through `arrowEndpoint` (core `resolveFieldEndpoint`). `arrows mart::species_fact.species_code` now finds the seabird flatten child. (commit immediately after 8b738c71)

**2026-10-06T19:37:29Z**

Cause (review): the fix stripped a schema's bare name from an arrow path without checking whether the schema declares a top-level field of that name. In `namespace n`, with schema `fact` holding a record field `fact`, `a -> fact.sku` was indexed and printed in `--json` as `n::fact.sku` instead of `n::fact.fact.sku`, and `field-lineage n::fact.fact.sku` found nothing.
Fix: core's `resolveFieldEndpoint` takes an optional `TopLevelFieldTest`, so a declared field wins over a look-alike schema prefix (ADR-041). The CLI builds the test once per workspace with `topLevelFieldTest` (index-builder.ts) and passes it to `buildFieldArrows`, to `arrows --json` and to the field-edge source behind `graph` and `field-lineage`. The global form of the same shape was already wrong before this ticket and is now fixed too. (commit immediately after 351449bb)

---
id: bsw-tzc6
status: open
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

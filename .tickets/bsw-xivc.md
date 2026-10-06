---
id: bsw-xivc
status: closed
deps: []
links: []
created: 2026-10-06T09:57:03Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, core, validate, lsp, fragments]
---
# core: a fragment spread inside a nested record silently turns off field validation for the whole schema

`tooling/satsuma-core/src/spread-expand.ts:385`, `if (spreads.length === 0 && entity.hasSpreads) return false;`, reports "unresolved" for any schema whose only spreads are nested: extraction sets the schema-level `hasSpreads` but stores nested spreads on the field, not in `schema.spreads` (`extract.ts:122-125`). `validate.ts:596/638` then suppresses every field check for that schema. Pre-existing (6e1949be, March).

```satsuma
fragment f { a INT }
schema s { x INT }
schema t { y INT  r record { ...f } }
schema u { y INT  r record { a INT } }
mapping `m`  { source { s } target { t }  x -> bogus }
mapping `m2` { source { s } target { u }  x -> bogus }
```

`satsuma validate` reports one `field-not-in-schema` (for `u`) where it should report two. The source side behaves the same (`bogus_src -> y` with a nested spread in the source is not flagged). Canonical examples `lib/sfdc_fragments.stm` and the namespaces files use nested spreads, and the LSP shares core validate, so the editor misses these warnings too.

Related facet: an undefined nested spread is never reported. `schema t { a record { ...nope } }` validates clean, while a top-level `...nope` warns; `checkFragmentSpreads` (`validate.ts:333`) only walks `schema.spreads`.

## Acceptance Criteria

- Nested spreads count as resolved when their fragments resolve; the repro reports both warnings, source side too.
- An undefined nested spread is reported like a top-level one.
- Core tests, red before the fix; check the example corpus for newly surfaced warnings and fix or explain them.

## Notes

**2026-10-06T10:37:02Z**

Cause: `expandEntitySpreads` returned "unresolved" for any entity with `hasSpreads` set but an empty top-level `spreads` list, which is exactly what extraction produces when the only spreads sit inside record bodies; the separate nested-path walker never reported failures, and `checkFragmentSpreads` only read the top-level list.
Fix: one walker in `spread-expand.ts` now treats each record body as an entity of its own, so nested spreads resolve, recurse, detect cycles and report failure exactly like top-level ones; `checkFragmentSpreads` reports undefined nested spreads via the new `collectNestedSpreads`, and the LSP adapter now passes top-level spreads and field rows to core. No example in `examples/` gained a warning (commit immediately after 914c97c2).

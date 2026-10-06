---
id: bsw-kvj9
status: closed
deps: []
links: []
created: 2026-10-06T09:57:03Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, arrows]
---
# cli: arrows on a top-level field also returns arrows for nested fields with the same name

With `src` declaring top-level `id` plus `orders.id` and `orders.lines.id`, each mapped separately, `satsuma arrows src.id` returns `id -> rid`, `orders.id -> rows.oid` and `orders.lines.id -> rows.items.lid`. `field-lineage src.id` correctly returns only `rid`.

`id` names a declared top-level field, so the query is unambiguous: gpt-qhfo's reasoning ("a fully qualified query is unambiguous") applies, and sl-xj4p's show-all-matches rule covers only leaf names that are not top-level fields. 6dc9c11d tightened only dotted queries (`arrows.ts:146`); the undotted path still accepts any arrow whose path exists anywhere in the schema (`arrows.ts:147-150`). The impact-analysis and PII-audit workflows in SATSUMA-CLI.md (`arrows X.id --as-source`) therefore pull in unrelated fields.

## Acceptance Criteria

- When the queried name is a declared top-level field, only its arrows are returned; leaf-name matching (sl-xj4p) still applies when it is not. Tests for both.

## Notes

**2026-10-06T18:08:41Z**

Cause: `arrows` demanded an exact path only when the query contained a dot; an undotted query accepted any candidate whose path existed anywhere in the schema, so a top-level `id` picked up `orders.id` and `orders.lines.id` through the leaf-name index, and the `--as-source`/`--as-target` filters and text grouping matched by leaf name and suffix too.
Fix: arrows.ts now resolves the query once with `findDeclaredFields` (exact path wins, else every field of that leaf name) and accepts an arrow only when its schema-local path is one of those resolved paths; the suffix post-filter is gone, the generated-property suite asserts every declared path exactly, and SATSUMA-CLI.md states the rule (commit immediately after 872555bf).

**2026-10-06T19:30:05Z** (review follow-up)

Cause: the schema-qualified index key's arrows were accepted without the queried-field test. In a schema `orders` with a top-level record `orders`, the index files `orders.id -> b` under `orders.id`, while the matcher reads that path as the record child, so `arrows orders.id` listed two arrows under a "1 arrow" header and disagreed with `--as-source`.
Fix: arrows.ts now gathers candidates from the qualified, bare and leaf keys in one loop and applies the same side-and-path test to all three; integration tests cover the schema-named record (commit immediately after 8b9a2d1e).

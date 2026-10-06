---
id: bsw-kvj9
status: open
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

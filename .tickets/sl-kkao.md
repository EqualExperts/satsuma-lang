---
id: sl-kkao
status: open
deps: []
links: []
created: 2026-06-10T23:21:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, core, validate]
---
# core: false field-not-in-schema for schema-qualified spread fields in multi-source mappings

satsuma-core/src/validate.ts:547-553 (prefixed path collection) and :975-980 (resolveFieldPath qualified branch) collect schema.fields without fragment-spread expansion, so the qualified form of a spread-inherited field is never in the valid set (the unqualified form is, via expandSpreads). Repro: s2 spreads fragment audit { created_at }; mapping source { s1, s2 }; arrow s2.created_at -> z  -> "field-not-in-schema: Arrow source s2.created_at not declared in schema s1". Bonus bug: the message names s1 (always the first source) even when the path is qualified with s2.

## Acceptance Criteria

Schema-qualified spread-inherited fields validate clean; error message names the schema the path is qualified with; multi-source + spread test.


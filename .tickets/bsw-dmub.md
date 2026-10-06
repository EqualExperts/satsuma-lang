---
id: bsw-dmub
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp, namespaces, rename]
---
# lsp: renaming a namespaced schema leaves ns::schema.field arrow paths on the old name

```satsuma
namespace ns { schema s1 { id INT }  schema s2 { id INT } }
schema t { k INT  j INT }
mapping m { source { ns::s1, ns::s2 } target { t } ns::s1.id -> k  ns::s2.id -> j }
```

Renaming `s1` to `s9` edits only the declaration and the source block; the arrow still reads `ns::s1.id`. Definition on `s1` or `id` in that arrow returns null, and references from the `s1.id` declaration return `[]`. AI-AGENT-REFERENCE.md documents `namespace::schema.field` as a valid path. Causes: `tryArrowSchemaPrefixContext` (`definition.ts:272`) handles only `field_path`; `extractArrowFieldName` (`workspace-index.ts:966-983`) takes the schema segment as the field name and indexes no schema-prefix reference for `namespaced_path`.

## Acceptance Criteria

- Rename updates `ns::schema.field` arrow prefixes; definition and references work on both segments; tests added (the corpus has no namespaced arrow path, so add a fixture).

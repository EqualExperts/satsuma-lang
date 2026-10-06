---
id: bsw-8flg
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, examples]
---
# examples/namespaces/namespaces.stm raises four field-not-in-schema warnings

`satsuma validate examples/namespaces/namespaces.stm` reports `0 errors, 4 warnings`: lines 105-108 map to `warehouse::conformed_store` fields `order_date`, `store_code`, `order_id` and `total_amount`, which that schema does not declare. A canonical example should validate clean.

## Acceptance Criteria

- The example validates with no warnings (fix the schema or the arrows, whichever was intended); golden outputs that include it are refreshed.

---
id: bsw-8flg
status: closed
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

## Notes

**2026-10-06T10:08:50Z**

Cause: dece5573 renamed `warehouse::hub_store`/`hub_customer` to `conformed_store`/`conformed_customer` and dropped `daily_sales`'s `source ecom::orders`, adding a `daily sales pipeline` mapping that read the order fields from `warehouse::conformed_store` instead. ns-platform.stm kept importing the old `hub_*` names, giving two more undefined-import warnings.
Fix: The mapping now sources `ecom::orders`, which declares all four fields, and ns-platform.stm imports the `conformed_*` names; a CLI integration test now pins every example clean, and the LSP's sl-rngq contract test, which relied on these four warnings, uses its own inline input. No golden output embeds either file (commit immediately after ca9473e7)

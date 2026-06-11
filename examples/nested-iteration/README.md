# nested-iteration

Demonstrates `each` and `flatten` blocks nested inside an `each` block (spec §4.4 "Nested Mappings"): a warehouse dispatch event with orders, lines, and parcels is mapped to a courier manifest that preserves the order/line hierarchy while flattening parcel contents into one packed-items list per order.

## Key features demonstrated

- `each` block nested inside an `each` block — preserving a two-level source hierarchy in the target
- `flatten` block nested inside an `each` block — lifting a doubly-nested list into a flat per-element list
- Relative `.field` paths resolving against the enclosing iteration context
- Metadata (`note`) on an iteration block header

## Entry point

`pipeline.stm` — main pipeline (imports nothing)


### Common mistakes

These are mistakes agents make *despite* having the grammar — non-obvious
pitfalls that the EBNF alone doesn't prevent.

| Mistake | Correct approach |
| --- | --- |
| Using `::` between schema and field (e.g. `schema::field`) | `::` is namespace-to-schema only. Use `.` for fields: `ns::schema.field.nested` |
| Using `source`/`target`/`table` as schema keywords | Use `schema` for all — role is contextual from mapping context |
| Using `STRUCT { }` / `ARRAY { }` for nesting | Use `name record { }` / `name list_of record { }` |
| Using `[]` in mapping paths for array access | Use `each src -> tgt { }` for iteration, dot paths for field access |
| Using `(flatten \`list\`)` metadata on mappings | Use `flatten src.list -> tgt { }` block syntax inside mapping body |
| Repeating schema IDs in paths inside implicit mapping blocks | Bare names resolve to source (left) and target (right) |
| Using `metric name "X" (...)` block syntax | Metrics are now `schema name (metric, metric_name "X", ...)` — `metric` is a metadata tag, not a block keyword |
| Using `report` / `model` as block keywords | Use `schema name (report, ...) { }` or `schema name (model, ...) { }` |
| Summing a `non_additive` measure across dimensions | Use weighted average or re-aggregate from grain; only `additive` measures can be summed |
| Writing field names bare in NL strings | Use `@ref` — e.g. `"Sum @order_total grouped by @customer_id"` |
| Backticking an entire `@ref` path | Backtick only the unsafe segment(s): `@raw::\`crm-contacts\`.\`customer-id\`` |
| Referencing a schema in NL without declaring it | `@ref` schemas must be in the mapping's `source { }` block |

---

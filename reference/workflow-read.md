### When reading/interpreting Satsuma:

1. Run `satsuma summary <file>.stm` to understand the workspace scope before reading individual files
2. Use `satsuma schema <name>` and `satsuma mapping <name>` to inspect specific blocks
3. Use `satsuma arrows <schema.field>` to trace specific fields through mappings — don't search manually
4. Use `satsuma nl <scope>` and `satsuma nl-refs` to read NL content and inspect extracted `@ref`s
5. `src -> tgt` means source-to-target; `a, b -> tgt` means multi-source; `-> tgt` (no left side) means computed/derived
6. Transform content is in `{ }` after the arrow — pipelines read left-to-right, and `...name` spreads a named transform
7. Mapping `source { }` blocks may contain source-level filters and NL join descriptions, not just schema names
8. `"..."` strings in transforms are natural language intent — interpret them, but keep structural facts separate from your interpretation
9. `//!` comments are warnings about data quality or known issues — also visible via `satsuma warnings`
10. `note { }` blocks contain rich documentation

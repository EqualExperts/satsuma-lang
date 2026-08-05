
## Agent Workflow

### When generating Satsuma from a description or spreadsheet:

1. If source and target schemas already exist, run `satsuma match-fields --source <s> --target <t>` to find deterministic name matches, then `satsuma nl <s>` and `satsuma nl <t>` to read field notes for context
2. Preserve existing namespace/import structure if the workspace already uses it; don't collapse namespaced definitions back to flat global names
3. Start with a `note { }` block if integration context, assumptions, or join strategy need durable documentation
4. Define `schema` blocks with all fields, types, and metadata
5. Add `fragment` blocks if you have reusable field sets
6. Use `schema name (metric, metric_name "...", source ..., grain ...) { }` for business KPIs; use `(report)` / `(model)` metadata on `schema` for downstream consumer artifacts
7. Write the `mapping { }` block with source/target refs and all arrows
8. For multi-source mappings, put structural sources plus source-level filters in `source { }`, and describe joins in an NL string with `@ref`s
9. Use `"natural language"` in `{ }` for any transform you can't express as a pipeline — use `@ref` for any field or schema names referenced inside the NL string (e.g. `"Sum @amount grouped by @customer_id"`)
10. Add `//!` warnings for known data quality issues
11. Add `//?` for any open questions or ambiguities
12. Add `(note "...")` metadata for persistent field-level documentation
13. Run `satsuma fmt <file>.stm` to apply canonical formatting
14. Run `satsuma validate <file>.stm` to check for parse errors and semantic issues
15. Run `satsuma lint <file>.stm` to check for policy/convention issues; use `--fix` to auto-correct fixable ones
16. Run `satsuma coverage <file>.stm --uncovered` to see which declared fields nothing maps yet — check the aggregate section, since another mapping may already populate a field your mapping ignores


---
id: bsw-vf2i
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-sweep-2026-10, viz-backend, viz, lsp, regression]
---
# viz: field-chain view says "Field not found" for every metric field

Regression from a912f890 (sv-embb, unknown-field vs no-lineage). `focusFieldIsDeclared` accepts only definitions of kind `"schema"` (`tooling/satsuma-viz-backend/src/field-chain.ts:178`), and so does `resolveSchemaFields` (`tooling/satsuma-viz-backend/src/workspace-definition-lookup.ts:110`). But `workspace-index.ts:610-612` files metric schemas (`schema x (metric, ...)`) under kind `"metric"`, so every metric field is reported as undeclared.

Repro:

```satsuma
schema out { cid INT }
schema revenue (metric, source out) {
  total DECIMAL (measure additive)
}
mapping mm { source { out } target { revenue } cid -> total }
```

`buildFieldChainFromSources(..., "revenue.total")` returns `{upstream: [], downstream: [], resolved: false}`; `satsuma field-lineage revenue.total` on the same file returns two upstream hops. In the UI: click the lineage button on a metric field (metric cards render via `metricAsSchemaCard`) or a metric hop in the chain view (`sz-chain-view.ts:511`) and the view shows "Field not found". Before a912f890 it showed the lineage. The LSP shares this backend, so VS Code is affected too.

## Acceptance Criteria

- `focusFieldIsDeclared` and `resolveSchemaFields` treat metric definitions as declaring fields.
- A viz-backend test builds a field chain for a metric field and asserts `resolved: true` with the upstream hop; verified red before the fix.
- Playwright: clicking a metric field's lineage button opens the chain view with lineage, not the unknown-field state (extend the sv-embb chain-view describe block; add a metric fixture if none is wired).

## Notes

**2026-10-06T09:56:34Z**

Cause: The sv-embb existence check (`focusFieldIsDeclared`, `resolveSchemaFields`) accepted only index entries of kind "schema", but the workspace index files metric schemas under kind "metric", so every metric field was reported as undeclared.
Fix: Added `declaresSchemaFields` (schema or metric) in workspace-definition-lookup.ts and used it at both sites; viz-backend tests and a Playwright spec on the metrics-platform fixture cover it (commit immediately after 68e36a19)

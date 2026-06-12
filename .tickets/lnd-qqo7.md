---
id: lnd-qqo7
status: open
deps: []
links: []
created: 2026-06-12T08:58:24Z
type: task
priority: 2
assignee: Thorben Louw
---
# LSP: false undefined-ref for namespace-qualified metric target in same namespace

Opening examples/namespaces/namespaces.stm in the editor produces:

  undefined-ref: Mapping 'analytics::daily sales pipeline' references undefined target 'analytics::daily_sales'

analytics::daily_sales is defined directly above the mapping (a metric-decorated schema in the same namespace block), and `satsuma validate` on the same file reports no such error — this is an LSP live-path-only false positive, likely in how buildSemanticIndex / defEntryToMapping (tooling/satsuma-lsp/src/semantic-diagnostics.ts) resolves namespace-qualified targets against metric-kind definitions.

Found while fixing sl-padl (false duplicate-definition for reopened namespaces).

Acceptance criteria:
- Opening examples/namespaces/namespaces.stm produces no undefined-ref diagnostic for analytics::daily_sales.
- A mapping targeting a qualified metric name defined in the same closure resolves in the LSP semantic diagnostics path.
- Regression test in tooling/satsuma-lsp/test/semantic-diagnostics.test.js.


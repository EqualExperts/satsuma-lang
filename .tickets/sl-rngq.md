---
id: sl-rngq
status: closed
deps: []
links: []
created: 2026-06-12T09:24:18Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [lsp, diagnostics]
---
# LSP validate fallback silently drops all CLI diagnostics: JSON shape mismatch

The LSP's on-save validate fallback (tooling/satsuma-lsp/src/validate-diagnostics.ts runValidate) parses `satsuma validate --json` output expecting a bare JSON array, but since commit 8758118 (2026-03-25, 'validate: wrap --json in {findings, summary} like lint') the CLI emits an object {findings: [...], summary: {...}}. The Array.isArray(entries) guard rejects the object and resolves an empty map, so NO satsuma-validate diagnostics ever reach the editor. Because the live LSP semantic path also skips arrow-field checks (fieldArrows is intentionally empty in semantic-diagnostics.ts), field-not-in-schema warnings — e.g. the four bogus source fields in examples/namespaces/namespaces.stm mapping 'daily sales pipeline' (lines 105-108, fields order_date/store_code/order_id/total_amount not on warehouse::conformed_store) — are invisible in the editor even though 'satsuma validate' reports them correctly.

## Acceptance Criteria

1. runValidate parses the {findings, summary} envelope (tolerating the legacy bare-array shape is optional but document the choice). 2. Saving examples/namespaces/namespaces.stm surfaces the four field-not-in-schema warnings as editor diagnostics with source 'satsuma-validate'. 3. LSP tests cover the envelope shape; a regression test fails if the CLI JSON shape and LSP parser drift again (e.g. shared fixture or contract test against actual CLI output).


## Notes

**2026-06-12T11:46:47Z**

Cause: The LSP's runValidate parsed `satsuma validate --json` expecting a bare array, but commit 8758118 (2026-03-25) wrapped the output in a {findings, summary} envelope; the Array.isArray guard rejected it and silently resolved an empty diagnostics map.
Fix: Extracted parseValidateFindings handling both the envelope and the still-live bare-array resolve-failure shape; added a contract test running the locally built CLI against examples/namespaces/namespaces.stm that hard-asserts the four field-not-in-schema warnings (commit 35b3a86)

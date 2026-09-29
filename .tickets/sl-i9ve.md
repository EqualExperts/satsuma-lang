---
id: sl-i9ve
status: open
deps: []
links: [sl-ui5d, sl-8vqk]
created: 2026-09-29T07:27:22Z
type: bug
priority: 2
assignee: Thorben Louw
external-ref: gh-525
tags: [core, diagnostics, nested-data]
---
# core: say why a path inside each/flatten fails when it names an enclosing-level field (gh-525)

From GitHub issue #525; docs half is sl-ui5d. Inside `flatten Order.LineItems`, the arrow `Order.OrderId -> order_id` is reported as:

    sample.stm:22:1 warning [field-not-in-schema] Arrow source 'Order.LineItems.Order.OrderId' not declared in schema 'commerce_order'

Correct per spec §4.4, but it reads like a tooling bug: it shows only the prefixed path, does not say the authored path was made relative to the container, and does not say `Order.OrderId` exists one level up.

## Root cause

`qualifyChildArrowPath` (`satsuma-core/src/extract.ts:1022`, called at :1100-1101) prefixes the container path as specified. `ExtractedArrow` keeps neither the container prefix nor the authored path, so `validate.ts:672-679` can only report the result.

## Approach

When an arrow inside an each/flatten container fails field-not-in-schema, check whether the authored path (record the container prefix on the extracted arrow) resolves at an enclosing level or the schema root. If so, add a hint, e.g. `— paths inside 'flatten Order.LineItems' are relative to it; 'Order.OrderId' exists outside the block, so write this arrow there (spec §4.4)`. Same for targets. Keep it in core so CLI and LSP share it.

Column: `ExtractedArrow.column` already exists but validate.ts hard-codes `column: 1` in 13 places. Leave the column alone here for consistency; a repo-wide column fix would be its own ticket.

## Acceptance Criteria

- Core validate test with the minimal #525 snippet: the diagnostic names the container and suggests moving the arrow outside.
- A path that exists at no level (e.g. `.Nope` inside the block) gets no hint.
- Nested `each` inside `each` naming a field of the outer element gets the hint.
- LSP semantic-diagnostics test confirms the hint reaches the editor diagnostic.
- No change to coverage or lineage for any example in examples/.
- No Playwright needed: diagnostic text only.

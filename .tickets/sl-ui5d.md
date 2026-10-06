---
id: sl-ui5d
status: closed
deps: []
links: [sl-i9ve, sl-8vqk, sl-pn00, tced-ewd4]
created: 2026-09-29T07:27:22Z
type: bug
priority: 1
assignee: Thorben Louw
external-ref: gh-525
tags: [docs, nested-data]
---
# docs: tutorial and lessons teach parent-field arrows inside flatten, which fail validation (gh-525)

From GitHub issue #525. The reporter copied this pattern from our own tutorial:

    flatten Order.LineItems -> order_lines_parquet {
      Order.OrderId -> order_id
      .SKU -> sku
    }

and got `warning [field-not-in-schema] Arrow source 'Order.LineItems.Order.OrderId' not declared in schema 'commerce_order'`, with `Order.OrderId` uncovered. The tooling is right: spec §4.4 (sl-pn00) says every path inside a block is relative, dot or no dot, and there is no ancestor notation. The docs are wrong. When sl-pn00 made the rule explicit, nobody swept the teaching material.

## Where the docs are wrong

- `docs/tutorials/ba-tutorial.md:312-321` — `Order.OrderId` inside the flatten block, plus the prose the reporter quoted ("Parent-level fields like `OrderId` are repeated").
- `lessons/07-nested-mappings.md:115,122-124,129` — `Order.OrderId`, `Order.CurrencyCode`, `Order.Channel`, `Order.Customer.CustomerId` inside the block under "// Parent-level fields repeated on every row".
- `lessons/14-integration-engineer-playbook.md:149,152,157` — same pattern.
- Spec §4.6 (~line 533): "Fields inside the block use `.` prefix to reference the current list element" implies undotted paths are absolute; it does not restate §4.4.
- `AI-AGENT-REFERENCE.md:115` (`.field // relative field inside each/flatten`) implies the same; this is also what `satsuma agent-reference` emits. Check `skills/satsuma-language` too.

examples/, skills/ and the spec's own examples were scanned and are clean.

## Approach

Move parent-level arrows outside the flatten block, as spec §4.6's example does, and rewrite the prose: fields written *outside* the block repeat on every row; every path *inside* is relative to the list element, with or without a dot (§4.4). Do not change resolution semantics — the ancestor-notation question stays with sl-8vqk.

## Acceptance Criteria

- The three teaching docs, spec §4.6 and AI-AGENT-REFERENCE.md are corrected; `satsuma agent-reference` output reflects it.
- Each corrected snippet, with its schema, validates cleanly through the CLI (no field-not-in-schema) and coverage shows the parent fields covered.
- A guard stops the drift recurring: extend an existing doc-snippet check if there is one, otherwise add a test/script that extracts the Satsuma snippets from docs/tutorials and lessons and validates them.
- Check whether the site renders these files and needs rebuilding.

## Notes

**2026-10-06T06:30:58Z**

Cause: When sl-pn00 made "every path inside a block is relative" explicit (spec §4.4), nobody swept the teaching material, so the BA tutorial and lessons 07/14 kept teaching `Order.OrderId` inside `flatten Order.LineItems` — and also flattened into `-> order_lines`, a target that does not exist. No check validated doc snippets.
Fix: Rewrote the three snippets to flatten into `order_lines_parquet` and reach order-level fields with `^.` (ADR-053), with prose explaining relativity; corrected spec §4.6 and the agent reference/skill/excel prompt wording. Added scripts/check-doc-snippets.mjs (+ tests, run by `npm run test:scripts`): snippets in docs/tutorials, docs/nested-data and lessons opt in via a `satsuma-check` HTML comment and are validated through the CLI against real example schemas; any complete each/flatten mapping snippet without an annotation fails. The site only links to these docs on GitHub, so no rebuild is needed. (commit immediately after 20aec326)

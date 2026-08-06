---
id: gpt-h0dc
status: open
deps: []
links: []
created: 2026-08-06T13:54:33Z
type: task
priority: 2
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, formatter]
---
# core: the formatter preserves semantics, not just shape (R7)

generated-format-properties.test.js proves the formatter is idempotent, preserves CST structure and reparses without recovery nodes. All three are claims about SHAPE. Nothing proves the formatter preserves MEANING — that what the toolchain extracts from a file is what it extracts after formatting it. A formatter that dropped the last source of a multi-source arrow, or re-associated a pipe chain, would keep the CST well-formed and pass every property in that file.

## Design

Add to tooling/satsuma-core/test/generated-format-properties.test.js, driven through the existing test/support/scenario-pipeline.js adapter: for every generated scenario, extract(parse(src)) deep-equals extract(parse(format(src))). The comparison is over the extracted semantic index — declarations, arrows, endpoints, transform classification — not over text or CST. Also assert the paired weaker claim the suite currently lacks a partner for: formatting twice extracts the same as formatting once (idempotence at the semantic level, not only the textual one). This is the strongest single property available for the formatter because it spans the whole pipeline the formatter can damage, and it needs no new oracle — scenario-pipeline.js already drives parse and extract. Listed as R7 because it is independent of R1's mutators and R3's adapter; it was in the original survey and dropped from the first PRD draft in error.

## Acceptance Criteria

Mutation check: make format() drop the trailing source of a multi-source arrow (a change the CST-preservation and idempotence properties both survive) and confirm the semantic property fails, with the counterexample naming the arrow. Run and recorded in the closing note. A second mutation check on a shape-only defect (e.g. altered indentation) must NOT fail this property — it belongs to the existing idempotence test, and a property that fires on both is testing the wrong thing.


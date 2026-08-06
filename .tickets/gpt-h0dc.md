---
id: gpt-h0dc
status: closed
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


## Notes

**2026-08-06T14:27:40Z**

**2026-08-06T00:00:00Z**

Cause: generated-format-properties.test.js asserted only shape (idempotence, CST-structure preservation, recovery-free reparse), and every one of those properties ran over `semanticScenarioArbitrary` alone — a domain with no multi-source arrows, containers, namespaces, imports, NL @refs, computed arrows or metric metadata. Nothing stated that formatting preserves *meaning*.
Fix: added test/support/semantic-index.js (a position-free, layout-free projection of every core extractor) and an `extract(parse(src))` deep-equals `extract(parse(format(src)))` property, including semantic idempotence at the second pass. Restructured the file so all four properties — the three existing shape claims plus the new meaning claim — run over BOTH the single-mapping domain and a new workspace-file domain, reached through a new `parseGeneratedWorkspaceFiles` adapter in test/support/scenario-pipeline.js. Core test count 700 -> 705. (commit immediately after 852449ee)

Mutation checks run, and one contradicted this ticket's stated premise:

1. Required check — break `formatMapArrow` to drop the trailing source of a multi-source arrow. The semantic property FAILS over the workspace domain, naming the arrow. But so does `preserves generated CST structure` over the same domain. The ticket predicted the CST property would survive this break; it does not. `cstStructure` compares the named tree *including named leaf text*, and every extractor is a pure function of exactly that, so identical CST structure implies an identical semantic index. The two properties are not independent for the formatter as it stands. The ticket's premise held only while the shape properties never reached a multi-source arrow at all — which was the real gap, and is now closed.

   The semantic property is kept for reasons of contract rather than extra detection, recorded in the test file's module comment: it states the claim consumers depend on (format composed with every extractor) rather than leaving it inferred from an unwritten purity argument; and it is the claim that must survive if `cstStructure`'s leaf-text inclusion is ever relaxed.

2. Required negative check — set the formatter's INDENT to three spaces. The semantic property stays GREEN (all 8 generated properties pass) while `format.test.js`'s corpus golden tests fail 4 cases. A shape-only defect is therefore caught elsewhere and does not fire this property, which is what makes it a test of meaning.

Both mutations reverted; `format.ts` is byte-identical to `main`. Full core suite green: 705 pass, 0 fail.

One deliberate design point beyond the ticket: `PipeStep.text` is a node's raw text, so a `map { a: 1 }` step carries its own interior spacing, which the formatter is permitted to reflow (sl-dxjh, ADR-033). The projection collapses whitespace runs in step text; comparing it verbatim would have made the property report a legal reflow as a semantic change once the generated domain grows map literals.

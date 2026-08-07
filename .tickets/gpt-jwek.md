---
id: gpt-jwek
status: closed
deps: []
links: []
created: 2026-08-06T15:22:41Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [lsp, definition]
---
# lsp: go-to-definition answers nothing at three usage kinds find-references reports

Feature 46 R3's generated duality properties (gpt-21jp) found three usage kinds where find-references and go-to-definition disagree: the reference is indexed and reported, but navigating from it answers nothing. Each is pinned as a falsifiable test in tooling/satsuma-lsp/test/generated-reference-duality.test.js's 'gaps these properties therefore exclude' block, so a fix turns the pin red.

1. **A metric `source` token.** `findNodeContext` has no case for a metadata value, so a metric's declared provenance is navigable in one direction only — find-references lists it, go-to-definition does not resolve it.

2. **The schema prefix of a qualified arrow path.** `s0.field_0` on a multi-schema side indexes `s0` as a reference to the schema, which is what makes renaming the schema rewrite the prefix. But the definition provider looks the first segment up as a FIELD of the mapping's schemas, and a schema name never is one. So rename handles it and go-to-definition does not — the asymmetry is the bug.

3. **A `namespace` name.** Excluded from declaredEntities rather than from RESOLVABLE_USAGE_KINDS; see the pin for the exact shape.

These are worth one ticket because they are one cause seen three times: `findNodeContext`'s case list is narrower than what `workspace-index` indexes. A fix that widens the case list should be checked against all three pins at once.

## Acceptance Criteria

Each of the three navigates to its declaration. The corresponding pinned test is deleted and the usage kind removed from RESOLVABLE_USAGE_KINDS (or from declaredEntities for the namespace case), so the duality properties then cover it positively rather than excluding it — that widening is the real acceptance signal, not the pins going green.


## Notes

**2026-08-07T11:47:17Z**

Cause: findNodeContext's case list was narrower than what workspace-index actually indexes as a reference, so go-to-definition answered nothing at a metric source token (no case for a metadata value), the schema prefix of a qualified arrow path (its first segment was looked up as a field, and a schema name never is one), and a namespace's own name (a plain identifier, not a block_label). Fix: added a value_text case for a metric's source metadata value and two identifier-shape detectors (tryArrowSchemaPrefixContext, tryNamespaceNameContext), all resolving through the existing resolveDefinition path; widened RESOLVABLE_USAGE_KINDS to cover metric_source and arrow, and added a dedicated positive test for the namespace-name self-reference case since a namespace has no scenario-gen usage site to fold into the generic duality properties. (commit immediately after 1bf0e046)

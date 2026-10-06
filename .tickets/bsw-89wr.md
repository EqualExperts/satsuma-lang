---
id: bsw-89wr
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, lsp]
---
# lsp: go-to-definition, references and hover return nothing on relative .field arrow paths

`extractPathFieldName` (`tooling/satsuma-lsp/src/definition.ts:523-551`) takes `".x".split(".")[0]`, which is `""`, so `tryContext` returns null. A sweep over `examples/` found 77 of 77 `relative_field_path` sites return null, e.g. `examples/top-level-dotted-each/pipeline.stm:26` `.party_role`. The escape comment added in caf9dd77 says the leading dot "is already ignored"; it is not. Related: `` ^.^.`tr ref` `` returns null because the backtick segment keeps its backticks. Pre-existing.

## Acceptance Criteria

- Definition, references and hover resolve relative paths inside each/flatten to the container field, including backtick segments; the corrected comment matches the code.
- Test over at least one example file asserting non-null definition on every relative path site.

## Notes

**2026-10-06T18:35:31Z**

Cause: the LSP and the workspace index rebuilt arrow paths from raw text and ignored the enclosing each/flatten. `.x` gave an empty first segment, so definition, references and hover found nothing; backtick segments kept their quotes; and the index filed `.id` inside `each orders` under the top-level `src.id`, and `^.x`/`$.x` under `^`/`$`. Hover only echoed the path text.

Fix: new core `resolveArrowPathInPlace` / `resolvedSegmentsThrough` (arrow-path.ts) resolve a path node against its containers, pinned equal to extraction on every example arrow, and `schemaLocalSegments` (coverage-paths.ts) strips a schema prefix by segment. The LSP's new arrow-field.ts looks the full path up in the side's schemas, following fragment spreads, and definition, references (with the index keying via `arrowFieldReferenceKeys`), hover (now given the index; it shows the resolved field and type) and actionContext all use it. The wrong "leading dot is already ignored" comment went with `extractPathFieldName`. (commit immediately after f32a5e7e)

**2026-10-06T19:45:38Z**

Cause (review follow-up): the index keyed arrows by a `schema.path` string built at index time from the mapping's spelling of the schema and without ADR-041's shadow rule, while go-to-definition applied both. So `customers` inside `namespace crm` and `crm::customers` outside it never met, `src.id` meant different fields to definition and references when `src` declares a field `src`, and `crm::customers.email` inside its own namespace got the malformed key `customers.crm::customers.email`. Declaration-side queries still matched arrows by leaf name through the bare key, which the old nested-field test could not catch.

Fix: `arrowFieldReferenceKeys` is gone. The index records each authored arrow-path segment (`arrowFields`, keyed by name) with its container-resolved path, side schemas and namespace; the LSP's `findArrowSegmentsNaming` resolves each candidate with `resolveArrowField`, the rule definition uses, once every file is indexed. References from an arrow and from a declaration both reduce to the declared field, and take only NL mentions, never arrows, from the name-keyed index. Exact-span tests cover both spellings, the namespaced path, the shadow case and the nested/top-level pair in both directions. (commit immediately after 0221789b)

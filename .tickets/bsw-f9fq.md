---
id: bsw-f9fq
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, core, paths]
---
# core: a backtick segment after the first in a path keeps its backticks and fails to resolve

`pathText` (`tooling/satsuma-core/src/extract.ts:810-814`) unquotes only the `backtick_path` form; `field_path`, `relative_field_path`, `parent_path` and `root_path` return raw text, so a backtick segment anywhere but first keeps its backticks. `extractPathText` (`nl-ref.ts:1086`) has the same flaw. Pre-existing for `` orders.`odd name` ``; the ADR-053 escapes inherit it.

Repros (each validates with `field-not-in-schema`, and coverage marks the field uncovered):
- top level: `` orders.`odd name` -> x ``
- inside `each orders -> rows`: `` .`odd name` -> .y ``
- inside an each: `` $.`long name` -> .c `` gives "Arrow source '`long name`' not declared in schema 'src'"

## Acceptance Criteria

- Every path form strips backticks per segment (ideally built from CST segments, not raw text), in both extract.ts and nl-ref.ts.
- Tests for the three repros; coverage agrees.

## Notes

**2026-10-06T16:54:39Z**

Cause: `pathText` (extract.ts) and its copy `extractPathText` (nl-ref.ts) rebuilt arrow paths from raw node text, unquoting only a leading backtick name and only its outermost pair, while the namespaced branch dropped backtick segments entirely; any later quoted segment kept its backticks and matched no declared field.
Fix: New core module `arrow-path.ts` decomposes a src_path/tgt_path from its CST segments (`arrowPathParts` → anchor, namespace, unquoted segments; `arrowPathText` renders it for the container resolver); both copies are deleted in favour of it, and error-recovered paths still fall back to raw text. (commit immediately after c684abd0)

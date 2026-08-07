---
id: gpt-qhfo
status: closed
deps: []
links: []
created: 2026-08-06T15:21:01Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [cli, arrows]
---
# arrows: a fully qualified nested-path query returns a different field's arrows

`satsuma arrows warehouse::staged.lines.field_0 --as-source` on Feature 46's kitchen-sink workspace returns only `warehouse::staged.field_0 -> ::revenue_metric.field_0` — a different field's arrow — and none of the nested field's own.

Two mechanisms combine:
- tooling/satsuma-cli/src/commands/arrows.ts:113-152, the `altKey` loop, whose `pathExistsInSchema` guard only checks the arrow path exists SOMEWHERE in the queried schema rather than that it is the path asked for.
- tooling/satsuma-cli/src/commands/arrows.ts:375-388, `arrowPathMatches`, which accepts `requestedPath.endsWith('.' + arrowPath)`, letting a shorter arrow path match a longer query.

sl-xj4p is closed and covers only the other half of this shape — an ambiguous BARE leaf-name query, which its acceptance criterion 2 deliberately blesses as 'show all matches'. A fully qualified query is unambiguous, so criterion 1 applies and this is a defect, not the blessed reading.

Found by Feature 46 R6 (gpt-clpj) and pinned there so it cannot change unnoticed: see the 'known behaviour' describe block in tooling/satsuma-cli/test/generated-inverse-relations.test.ts. Fixing this means updating that pin to the correct expectation.

## Acceptance Criteria

A fully qualified nested-path query returns exactly the arrows touching that path and no others. The pinned case in generated-inverse-relations.test.ts is converted from a pin of the current wrong answer into an assertion of the right one. The bare-leaf-name behaviour sl-xj4p blessed is unchanged.


## Notes

**2026-08-07T10:08:35Z**

## Notes

**2026-08-07T00:00:00Z**

Cause: `arrows.ts`'s `altKey` fallback loop admitted a candidate arrow whenever its path existed *somewhere* in the queried schema's field tree (`pathExistsInSchema`), and the later nested-path filter's `arrowPathMatches` accepted a match in either direction (`requestedPath.endsWith('.' + arrowPath)` as well as the reverse), so a shorter arrow path (e.g. top-level `field_0`) satisfied a longer, fully qualified query (e.g. `lines.field_0`) for an unrelated field.
Fix: `pathExistsInSchema` now requires an exact path match whenever the queried field name is dotted (a fully qualified nested path), leaving the bare-leaf-name fallback sl-xj4p blessed untouched; `arrowPathMatches` no longer accepts a shorter arrow path matching a longer request. The pinned "known behaviour" case in `generated-inverse-relations.test.ts` is now a regression test asserting the correct empty answer. (commit immediately after 02c3cb07)

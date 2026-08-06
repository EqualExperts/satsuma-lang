---
id: gpt-clpj
status: closed
deps: []
links: []
created: 2026-08-06T13:44:45Z
type: task
priority: 2
assignee: Thorben Louw
parent: gpt-uazn
tags: [feature-46, testing, cli]
---
# cli: inverse-relation properties for where-used, find and arrows (R6)

where-used, find and arrows answer questions scenarioFieldEdges already states the answer to, but none of them has generated coverage. Cheapest requirement in the feature; listed last because the commands are read-only and their blast radius is the smallest.

## Design

For every declared field in a generated workspace, where-used returns exactly the arrows scenarioFieldEdges says touch it — both directions. find resolves every declared entity and nothing it does not declare. arrows emits every declared arrow of a mapping exactly once. Follows the pattern R3 establishes; uses the CLI's existing test/support/generated-workspace.ts adapter.

## Acceptance Criteria

Mutation check: dropping NL-derived edges from where-used makes the property fail with a declared arrow missing for an @ref-touched field. Run and recorded in the closing note.


## Notes

**2026-08-06T15:30:07Z**

**2026-08-06T00:00:00Z**

Cause: `arrows`, `where-used` and `find` answer questions `scenarioFieldEdges` and `scenarioSchemaEdges` already state the answer to, and none of the three had generated coverage.
Fix: added `test/generated-inverse-relations.test.ts` (9 properties) and `test/support/run-cli-command.ts` (an in-process command runner), driven through the CLI's existing `test/support/generated-workspace.ts` adapter. (commit immediately after 2c9d9f30)

Mutation check run as the acceptance criteria require. Replacing `resolveAllNLRefs(index)` with an empty list at `src/commands/where-used.ts:207` fails two properties with the predicted counterexample — `where-used s0 misreports the @ref site for ::s0.field_1`, followed by the shrunk two-schema workspace whose arrow body mentions `@s0.field_1`. Reverted; `satsuma-cli/src` is byte-identical to `main`.

Two of the ticket's three premises were wrong and were rejected rather than worked around:

- `where-used` is entity-level and cannot take a field path, so "for every declared field, `where-used` returns exactly the arrows touching it" is not a query the command supports. The property instead asserts the entity-level relation: exactly the mappings, metrics and `@ref` sites the workspace attaches to each schema, both directions.
- `find` is a `--tag` metadata search, not a name resolver, so "resolves every declared entity" does not apply. The properties assert what it does do: every metric block is found by its own tags and only metric blocks are, and its matches partition across the `--in` block scopes without gaining or losing any.

Three weaknesses corrected after review:

- `arrowEdgesFor` read every `EXIT_NOT_FOUND` as "no arrows", but `arrows` uses that same code for "schema not found" and "field not found in schema" — so a failure to resolve a declared path would have passed silently whenever the expected set was empty. It now also asserts the `No arrows found` prose.
- `refNames` deduplicated every ref kind, so a regression reporting each mapping twice would still have satisfied the comparison. Split into a multiset helper (mappings, where each appearance in a source/target list is one emitted ref) and a distinct-set helper (metrics and `nl_ref`s, which production dedupes per metric and per mapping/file/line).
- A `describe("known defect")` block asserted behaviour that closed ticket sl-xj4p explicitly blessed — its criterion 2 asks that ambiguous leaf-name queries "show all matches". Renamed to "known behaviour", the sl-xj4p-blessed reading separated from the genuine defect, and a second pinned case added for the indefensible half.

Two real defects found and filed, both pinned in the suite so they cannot change unnoticed:

- `gpt-qhfo` — `arrows warehouse::staged.lines.field_0 --as-source` returns *only* `warehouse::staged.field_0 -> ::revenue_metric.field_0`, a different field's arrow, for a fully qualified nested path. Contradicts sl-xj4p criterion 1; two mechanisms combine (the `altKey` loop's guard checks the path exists *somewhere* in the schema, and `arrowPathMatches` accepts a suffix match).
- `gpt-4p1z` — `arrows --json` prints prose and exits 1 for an empty answer while `find --json` emits `[]`. The property depends on that prose today, so a fix must update `NO_ARROWS_PROSE`.

Two follow-ups filed rather than done here: `gpt-ek0e` (the canonical-endpoint owning-schema split is implemented four times — twice in core's src, twice privately in CLI test files — and belongs in core) and `gpt-idmq` (no arbitrary declares a `transform` block or a namespaced metric, so `where-used`'s `transform_call` kind is only ever asserted empty and `find`'s namespaced-schema lookup is untested).

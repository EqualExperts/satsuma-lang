---
id: sl-0zgi
status: open
deps: []
links: [sl-ez36]
created: 2026-07-31T15:54:58Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [lint, nl-refs]
---
# lint: bare @ref matching a field in more than one source schema binds silently to the first

`resolveRef` walks `[...sources, ...targets]` in declaration order and returns
the first schema carrying the field name. When two sources declare the same field
name, the ref binds to whichever schema was listed first, with no diagnostic.

    schema left  { id, amount }
    schema right { id, amount }
    mapping join_them {
      source { left, right }
      target { tgt }
      -> total { "Sum @amount across both sides" }
    }

    $ satsuma nl-refs
    @amount  ->  ::left.amount          # ::right.amount gets no edge

    $ satsuma validate   # no issues found
    $ satsuma lint       # no findings

The reader's intent here is plainly both sides, and joins across schemas that
share column names are the normal case for the idiom
(`examples/multi-source/multi-source-join.stm`). Reordering the `source {}` block
silently changes the lineage graph.

Picking the first match is a defensible resolution rule — the gap is that
nothing tells the author the ref was ambiguous, so the wrong binding is
invisible. This is lint's job, alongside `unresolved-nl-ref` (which fires when a
ref matches nothing; nothing fires when it matches too much).

Lower priority than the two path bugs: the resolved path here is real, just
possibly not the intended one.

## Acceptance Criteria

- A new lint rule (e.g. `ambiguous-nl-ref`, severity warning) fires when a bare
  @ref matches a field name on more than one schema in the mapping context.
- The message names every candidate schema and states which one resolution
  picked, so the author can disambiguate by writing `@left.amount`.
- The rule does not fire when the ref is already qualified (`@left.amount`,
  `@ns::s.f`), nor when only one schema in context carries the name.
- Registered in `lint --rules` with a one-line description.
- Not auto-fixable: choosing the intended schema is an authoring decision.


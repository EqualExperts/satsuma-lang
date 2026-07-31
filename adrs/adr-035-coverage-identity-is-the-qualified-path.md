# ADR-035 — Coverage Identity Is the Qualified Field Path

**Status:** Accepted
**Date:** 2026-07-31 (sl-joeq)

## Context

`computeMappingCoverage()` answers one question per declared field: does any
arrow in this mapping reference it? The answer is looked up in a `Set<string>`
of covered paths built by `addPathAndPrefixes()` in
`satsuma-core/src/coverage-paths.ts`. That function registered three kinds of
entry for every path an arrow referenced: the full path, each ancestor prefix,
and — deliberately, with a comment saying so — **each segment on its own**.
Covering `address.city` produced `{"address", "address.city", "city"}`.

The bare segment existed so a consumer holding only a local field name could
probe the set without building a qualified path. Its cost is that coverage
stopped being a question about a path and became a question about a name: a
field was reported mapped whenever its own path happened to equal *any segment
of any covered path in the same schema*. Repeated leaf names across depths —
`id`, `sku`, `code`, `city`, `BIC` — are not an edge case in nested schemas but
the normal shape of one, so the collision rate rose with exactly the specs
coverage analysis exists to check. The failure was silent and in the dangerous
direction: an incomplete spec read as complete. On the example corpus it credited
three joined-but-unread source schemas with their sibling's arrows purely because
the two declared the same field names, and it reported a top-level `city` as
mapped on the strength of `home_address.city`.

Removing the bare entries immediately exposed a second defect they had been
masking. Multi-source mappings qualify their arrows by schema — every source
arrow in `examples/filter-flatten-governance/governance.stm` reads
`crm_customers.email -> email` — but the covered-path walk recorded arrow text as
authored and never resolved that prefix. `crm_customers.email` matched the
declared field `email` only via the trailing bare segment. So the two defects had
been cancelling: one over-counted by matching names, the other would have
under-counted by never stripping prefixes, and neither was visible while the
other was present. The same accident meant a qualified arrow could never reach a
*nested* declared path, since only the final segment was ever compared —
`crm_customers.consent.email_marketing` left `consent.email_marketing`
uncovered.

Two other resolutions of the prefix rule already existed in the tree, in
`satsuma-viz/src/field-coverage.ts` and in the CLI's `arrows.ts` and
`graph-builder.ts`, each written for its own consumer.

## Decision

**A field's coverage is decided by its qualified path from the schema root, and
by nothing else.** `addPathAndPrefixes()` registers the full path and its
ancestor prefixes only. Ancestor registration stays — a record whose descendant
is covered still matches on its own path, which is what the VS Code gutter
decorates — but no entry is ever keyed by a local field name, and every consumer
must pass a qualified schema-local path to `isCoveredFieldPath()`.

The prefix rule that this makes necessary lives in core, as
`schemaRefPrefixes()` and `schemaLocalFieldPath()` in `coverage-paths.ts`.
`schemaLocalFieldPath()` reduces an arrow's authored reference to a path local to
one schema in three ordered rules: a prefix naming this schema is stripped; a
prefix naming a different schema in the same `source {}` / `target {}` block
yields `null`, leaving the claim to that schema's own pass; anything else is
already local and passes through unchanged. A namespaced schema is matched by
both its qualified id and its bare name, because arrows keep authored text while
the index reports the canonical key. `coverageForSchema()` in `coverage.ts`
applies it per schema, which is why the covered-path set is now built per schema
rather than once per mapping side.

Where a schema and one of its own top-level fields share a name, the declared
field wins and the path is read as-is: a declaration is concrete evidence, a
prefix that merely looks like one is not. Callers supply that knowledge through
the optional `declaresTopLevel` predicate.

`satsuma-viz`'s `resolveSchemaLocalFieldPath()` delegates to
`schemaLocalFieldPath()` and keeps only the rule specific to rendering a card —
that an unprefixed reference must be declared by the schema before it is shown
against it. Consumers must not reimplement prefix resolution.

## Consequences

**Positive:**

- Coverage means what it says. `home_address.city` covers exactly that path, and
  a schema nobody reads reports 0% however its field names overlap its
  neighbours'.
- The over-count is gone in the direction that matters. The prior behaviour hid
  work; a reviewer or a `--fail-under` gate could not see a gap it had already
  been told was filled.
- One implementation of the prefix rule, in core, for `satsuma coverage`,
  `fields --unmapped-by`, the LSP, the VS Code gutter and the viz overlay. Four
  surfaces that must agree now cannot drift.
- Qualified arrows reach nested declared paths, which fixes a genuine
  *under*-count that the name match could not express.
- `isCoveredFieldPath()` keeps its signature, so no consumer had to change to
  keep working.

**Negative:**

- **Recorded coverage figures move, in both directions.** Anyone tracking a
  number or gating CI with `coverage --fail-under` must re-baseline. On the
  example corpus four files change: three inflated figures fall and one
  under-count rises. Every movement is a correction, but a consumer cannot tell
  that from the number alone, which is why `CHANGELOG.md` states it explicitly.
- A consumer holding only a local field name can no longer probe the covered
  set. It must build the qualified path — which is the point, but it makes the
  set harder to use casually than it was.
- The covered-path set is now built once per participating schema instead of once
  per mapping side, because prefix resolution depends on which schema is being
  reported. For a mapping with many sources this is more work than before; it is
  linear in schemas × arrow references and has not been measured as significant.
- The schema-versus-own-field name collision is resolved by a rule, not by the
  language. Satsuma does not forbid a schema declaring a top-level field of its
  own name, so `orders.amount` inside `mapping { source { orders } }` is
  genuinely ambiguous and the resolution here — prefer the declared field — is a
  convention a future contributor could reasonably question.

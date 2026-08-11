# ADR-053 — Ancestor Escape Paths Inside `each`/`flatten` Blocks

**Status:** Accepted
**Date:** 2026-08-02 (sl-8vqk)

## Context

Every path written inside an `each`, `flatten`, or nested-arrow body is made
absolute by prefixing the enclosing container's path (spec §4.4). A leading `.`
documents that relativity but does not change the result: `.sku` and `sku`
inside `each lines` both mean `orders.lines.sku`. The prefix accumulates
through every level of nesting.

That rule is an implicit contract across four consumers — extraction
(`qualifyChildArrowPath`), coverage, lineage, and the viz — and it is relied on
by all of them. It has one consequence that is a real limitation, not a bug:
**there is no notation for reaching an ancestor.** A parent field referenced
from inside a block receives the block's prefix like everything else, producing
a path that does not exist:

```
flatten transects.sightings -> rows {
  transects.transect_ref -> transect_ref   // becomes transects.sightings.transects.transect_ref
}
// warning [field-not-in-schema] Arrow source 'transects.sightings.transects.transect_ref'
//   not declared in schema 'colony_survey'
```

For `flatten` there is a clean workaround: write the arrow _outside_ the block,
where its path is already absolute and the field repeats on every output row.
For a **nested `each`** there is none — "the parent transect's ref populates a
field on each child element" cannot be stated structurally and has to live in a
`note`, which lineage and coverage cannot follow (sl-8vqk).

The companion ticket sl-kezo (binding the current element of a _scalar_ list)
is a separate question and is not decided here; this ADR addresses only the
ancestor-reference gap.

## Decision

Adopt two path prefixes that escape the container, both available wherever a
`src_path`/`tgt_path` is valid (arrow headers, nested arrow bodies, `each`/
`flatten` bodies, and computed/multi-source arrow targets):

1. **`^.` — parent escape.** Each `^.` pops one segment off the enclosing
   container's path before the rest of the path is appended. `^.transect_ref`
   inside `each transects.sightings -> ...` resolves to `transects.transect_ref`;
   `^.^.survey_id` inside `each transects.sightings.rings -> ...` resolves to
   `transects.survey_id`. The prefix is repeatable.
2. **`$.` — root escape.** The enclosing containers are ignored and the path is
   taken absolute from the schema root. `$.survey_id` resolves to `survey_id`
   from any depth.

Both keep the existing dot semantics **untouched**. A bare `field` or a
`.field` still receives the container prefix exactly as before; the new
prefixes are the only authored forms that suppress it. This is the load-bearing
constraint: the prefixing rule is relied on by extraction, coverage, the viz and
the LSP, and changing it would move every consumer at once. The escapes are
additive — a path either carries an escape prefix or it does not, and the two
never interact with the relativity marker.

### Resolution

The rule lives in one place — `qualifyChildArrowPath` in `extract.ts`, which
every consumer already calls — and the parallel `qualifyContainerFieldRef`
(reference-stages) and target qualification (`nl-ref.ts`) follow it. A path is
classified by its prefix, in order:

| Authored            | Container             | Resolves to          |
| ------------------- | --------------------- | --------------------- |
| `$.survey_id`       | `transects.sightings` | `survey_id`           |
| `^.transect_ref`    | `transects.sightings` | `transects.transect_ref` |
| `^.^.survey_id`     | `transects.sightings` | `survey_id`           |
| `.species_code`     | `transects.sightings` | `transects.sightings.species_code` (unchanged) |
| `species_code`      | `transects.sightings` | `transects.sightings.species_code` (unchanged) |

Popping past the schema root resolves root-relative: `^.foo` at mapping-body
level (no container) resolves to `foo`, and `^.^.foo` inside a one-level
container resolves to `foo`. The escape is a directional instruction, not a
range check; whether the resulting path names a declared field is still
validated by `field-not-in-schema`, exactly as a mis-typed absolute path would
be.

### What this does not do

- It does **not** bind the current element of a scalar list (sl-kezo). `^.`
  pops a container; it does not name the element itself.
- It does **not** introduce a `zip` operator or positional correlation.
- It does **not** change NL `@ref` resolution, which names schema fields by
  path and was never container-prefixed.

## Consequences

- The grammar gains two named path nodes (`parent_path`, `root_path`) alongside
  `relative_field_path` and `field_path`; the CST symbol contract is regenerated.
- Extraction, coverage, lineage and the viz resolve escaped paths through the
  same shared rule, so a parent-to-child-element arrow now flows through
  coverage and lineage instead of vanishing into a `note`.
- The `field-not-in-schema` warning in the ticket's example no longer fires —
  the arrow resolves to a declared field — and a mis-aimed escape still fires it
  against the resolved path, so the safety property is preserved.
- `docs/nested-data/README.md` §2 (addressing) and §9 (known sharp edges) are
  updated: the ancestor limitation is removed from the sharp-edges table and
  the escape prefixes are documented as the way to state a nested-`each`
  parent-to-child arrow.

# ADR-039 — Consumer Models Keep the Authored Form; Core's Rules Resolve It at the Point of Use

**Status:** Accepted
**Date:** 2026-08-02 (3cdd-yavi, sl-5nsv; feature 38)

## Context

Satsuma lets an author write two things in shorthand, and both have to be
expanded before anything can be matched against a declared field.

The first is the **element-relative path**. Inside a `nested_arrow`, `each` or
`flatten` body, arrows are authored relative to the container: `.line1 ->
.line1` under `addr -> address` means `addr.line1 -> address.line1` (spec §4.6,
`examples/nested-iteration/pipeline.stm`). The second is the **fragment
spread**. `address record { ...address_fields }` declares that record's fields
as surely as writing them out (ADR-008), and the spread may name a fragment in
another file.

Core normalises both as it extracts: `extractArrowRecords` makes a container's
children absolute by accumulating the enclosing paths, and the CLI's coverage
resolver expanded spreads before handing core a field tree. The two consumers
built on the shared workspace index did neither, and in both cases the authored
form was not merely left unresolved but *discarded*: `viz-model.ts` stored
`.line1` verbatim with nothing that could later qualify it, and the index's
`FieldInfo` projection dropped `spreads` entirely, so no later pass could have
expanded it even if one had wanted to.

The result was three answers to one question. `resolveSchemaLocalFieldPath(".line1",
…)` split to `["", "line1"]`, matched no declared field, and returned null — so
every relative-path arrow contributed nothing to mapping-detail coverage, hover
cross-highlighting, or overview edges, where ELK's missing-port `continue`
dropped the edge without a word (`3cdd-yavi`). On the spread side, for
`customer { id, name, address record { ...address_fields } }` with two address
leaves mapped, `satsuma coverage` reported 2/5, the editor gutter reported 1/3
with `address` a single fully covered leaf, and the viz card had `address` with
no children at all (`sl-5nsv`). Every disagreement flattered the number.

The obvious repair is to normalise into the model and the index at build time,
as core does at extraction. One obstacle stands in front of each form. The viz
model is a *rendering* contract (ADR-018): the mapping-detail table prints an
arrow's paths verbatim beneath the scope heading that gives them their meaning,
so absolute paths would print `parcels.line1 -> packed.line1` under `each
parcels -> packed` — the author's own text replaced by a redundant expansion,
and every row's test id changed with it. Spreads have a timing obstacle rather
than a presentational one: `indexFile` runs per file, and a spread may name a
fragment in a file that has not been indexed yet, so at index time the
information needed to resolve it does not exist.

## Decision

**A consumer's index or model records authored shorthand as written — leading
dot and fragment name intact — and resolution happens at the point where a value
is matched against a declared field, through core's rule and never a local
copy.** Two functions are that rule, and core's own extraction calls the first
of them so there is exactly one implementation of each:

- `qualifyChildArrowPath(path, containerPath)` in
  `satsuma-core/src/extract.ts` — makes one container child's path absolute,
  stripping the authored dot; a null container returns the path untouched, dot
  and all, so a malformed mapping-level path stays unresolvable instead of being
  matched to a top-level field.
- `expandDeclaredFields(entity, ns, resolveRef, lookupFragment)` in
  `satsuma-core/src/spread-expand.ts` — materialises both spread forms in one
  fixed order (nested record-body spreads, then schema-level ones appended), on
  a deep copy, since the nested pass mutates and index records are shared across
  commands.

Where "the point of use" falls is decided by one question: **does this consumer
render the authored text?** Arrow paths in the viz model are rendered, so they
stay authored and are qualified per lookup — `forEachMappingArrow` hands each
visitor the model's own `ArrowEntry` alongside its absolute paths, and the two
walks that cannot go through it (`elk-layout`'s edge collection, which needs
per-block ids and scope badges, and the detail view's highlight check) thread the
same `ContainerScope`. Declared fields are not rendered in authored form —
ADR-008 makes a spread's fields the consuming schema's own — so they are
expanded as early as the workspace allows: in the LSP's `resolveSchema` adapter
and in the viz's `resolveAndStripSpreads`, both of which run after the index is
complete. The index itself, being a per-file record built before the workspace
exists, always stores the authored form: `FieldInfo.spreads` and
`DefinitionEntry.spreads` now carry it.

The corollary is the one ADR-034 states for denominators, applied to the field
tree and the path: a consumer must not re-derive either rule locally, and a new
resolution site must resolve before it matches.

## Consequences

**Positive:**

- One implementation of each rule, so a spec or grammar change lands in core
  and reaches every consumer (ADR-020). The relative-path rule in particular had
  already been fixed twice in two packages under two ticket numbers (`sc-xnxp`,
  then `3cdd-yavi`) before it was shared.
- Cross-file spreads resolve by construction, because expansion is deferred to a
  point where the whole workspace is indexed.
- The mapping-detail table still shows what the author wrote, and its test ids
  are unchanged.
- An unresolvable spread survives expansion and stays visible on the schema card
  as a dangling-reference indicator, rather than silently becoming an empty
  record.
- The parity this enables is now pinned rather than asserted: one fixture pair is
  checked leaf for leaf, state for state and percentage for percentage by the
  CLI, LSP, viz-backend and viz-component suites.

**Negative:**

- Every resolution site has to remember to resolve, and forgetting fails
  silently — an unmatched path yields no coverage, no edge and no highlight,
  which is exactly how `3cdd-yavi` stayed hidden through two rounds of work on
  the same file. Funnelling viz's arrow walks through `forEachMappingArrow`
  narrows this, but does not close it: `elk-layout` still applies the rule
  itself.
- Two representations of one path are in flight at once. A reader of the viz
  model must know that its arrow paths are not comparable to declared field
  paths, which is a thing to know rather than a thing the types enforce.
- The viz model now mixes conventions in one object graph — materialised field
  trees beside authored arrow paths — and stays legible only as long as the doc
  comments saying so remain accurate.
- `FieldInfo` and `FieldEntry` carry a `spreads` field that is meaningful only
  before expansion and that most consumers never read.
- Expansion deep-copies a schema's field tree per resolution rather than once per
  index, so coverage over a workspace pays the copy for every (mapping, schema)
  pair it reports on.

# ADR-042 — Coverage Is Computed Once, at Model Assembly, and Transported in the Payload

**Status:** Accepted
**Date:** 2026-08-03 (sl-46wr, sl-csrs; feature 38)

## Context

Three consumers report field coverage for the same workspace: `satsuma coverage`,
the VS Code gutter and status bar, and the viz schema card. ADR-034 moved the
*counting* into core and told consumers not to compute their own denominators.
It did not say where the per-field *verdicts* come from, and the viz answered that
question for itself: `satsuma-viz/src/field-coverage.ts` walked the VizModel's
arrows, resolved each endpoint against the cards on screen, and built a flat
`Set<string>` of covered paths. Core offered `fieldCoverageFromCoveredPaths(fields,
uri, coveredPaths)` to turn such a set into entries, so the card counted through
core's shapes while deciding for itself what was covered.

That looked equivalent and was not. Two coverage rules are invisible in an
arrow's endpoints. A leaf named by a *resolved* NL `@ref` is covered (ADR-036),
which needs the ref resolver and the mapping's prose — neither reachable from a
path. An arrow onto a record covers that record's whole declared subtree when it
states a correspondence and enumerates no children (ADR-037), which needs the
arrow's *declaration kind* and whether its body listed anything — both discarded
the moment an arrow becomes a path. So the card silently under-reported: on
twelve of the shipped examples it disagreed with `satsuma coverage`, and on
`examples/contracts/buy-to-om-order.stm` it read 7/8 against the CLI's 8/8, the
differing leaf being `tax_amount`, which the CLI tags `tier=nl`. A sweep over
`examples/` found 45 disagreements across mappings, schemas and roles.

The failure mode matters more than the count. Every rule added to coverage since
had to be implemented twice or the card drifted again, and the second
implementation had no way to detect that it was incomplete — a flat set of paths
answers "is this path covered?" perfectly well while being wrong about what the
covered set should have contained. That is the "one workspace, three completeness
figures" defect PRD 38 R3 exists to remove, and it survived sl-5nsv's parity test
because that test exercised only fragment-spread fixtures.

Two alternatives were considered. **Teach the viz derivation the two rules** —
rejected: it requires the viz model to carry the arrow's declaration kind and
enumeration signal purely so a second implementation can re-apply core's rules,
and the next rule would need the same treatment. **Resolve schemas from the
workspace index**, as the LSP's `resolveSchema` adapter does — rejected because
the card renders `SchemaCard.fields`, so counting any other field tree puts a
ratio next to rows it does not describe; it also drops metric endpoints, since the
index classifies a metric under its own kind while the detail view renders it as a
schema card.

## Decision

**Field coverage is computed once, by core, when a VizModel is assembled, and
travels to the client inside the payload. A consumer selects and counts those
entries; it never derives them.** The mechanism:

- `attachMappingCoverage(uri, tree, namespaces, wsIndex)` in
  `satsuma-viz-backend/src/coverage.ts` calls core's `computeMappingCoverage` for
  every mapping and assigns the result to `MappingBlock.coverage`. It runs last in
  `buildVizModel`, after `resolveAndStripSpreads`, so the tree it judges is the
  tree the card renders. Absent coverage means "not computed" — a consumer must
  not render it as 0%.
- **Schemas resolve to the model's own cards**, via `indexCardsByQualifiedId`, so
  the counted field tree and the rendered field tree are the same object. The
  index is consulted for one step only: core reads schema references off the CST
  *as authored* (ADR-039), so an unqualified reference is resolved relative to the
  namespace its mapping is declared in before the card is looked up. Metric cards
  are registered alongside schema cards.
- `MappingBlock.coverage` is part of the protocol in `@satsuma/viz-model`, typed
  as core's `MappingCoverageResult`. That package now depends on `@satsuma/core`
  and re-exports the coverage types, so the payload carries core's types verbatim
  rather than a structural copy that could drift.
- **A mapping is named by identity, not by label.** `computeMappingCoverage`
  takes a `MappingTarget`: a `MappingSelector` — `{namespace, name, row}`, any
  part of which narrows the match — or a bare label for the one caller that has
  nothing else (the LSP's `satsuma/mappingCoverage` request). A label is not
  unique: two namespaces may declare `mapping load`, and matching on the label
  alone gave the first-declared block's arrows to both, so a card and
  `satsuma coverage` agreed on a figure that belonged to the other mapping. An
  anonymous `mapping { … }` block has no label at all, so a label lookup found
  nothing and dropped its coverage. The CLI passes `{name, namespace}`; the viz
  passes `{namespace, row}`, which identifies the block outright.
- **Absent coverage is "not computed", and stays distinguishable from `0/N`.**
  The viz's selectors (`mappingSchemaCoverage`, `buildCoverageIndex`) return
  `null` for it, and the card then shows a plain leaf count in place of a ratio.
  A schema no mapping references is the genuine zero and does report `0/N`, from
  `uncoveredFieldCoverage`. Collapsing the two would let a model assembled
  without a workspace index — or a payload cached by an older host — assert a
  completeness figure nobody measured.
- Combining entries is core's too. `unionFieldCoverage(lists)` in
  `coverage-rollup.ts` is the single implementation of the union rule — a leaf is
  covered when any input covers it, under the strongest tier any input claims, and
  containers are re-derived from the unioned leaves. `aggregateCoverage` and the
  viz overview index both go through it.
- **No API accepts an arbitrary set of covered paths.**
  `fieldCoverageFromCoveredPaths`, `buildCoveredFieldSet` and `isCoveredFieldPath`
  are deleted. A consumer with real coverage to report calls
  `computeMappingCoverage`; one that only needs a denominator for a schema no
  mapping references calls `uncoveredFieldCoverage(fields, uri)`, which answers
  exactly that degenerate case and nothing wider.

Consumers must also *render* the tier rather than reconstruct it (ADR-036), which
is why the transported entry carries `tier` and `state` and not a boolean.

The rule for a new consumer is therefore: if you are about to build a collection
of covered paths, you are reintroducing this defect.

## Consequences

**Positive:**

- The CLI, the gutter and the card cannot disagree by construction — there is one
  computation, not three that must be kept in step. A corpus sweep
  (`satsuma-cli/test/coverage-viz-parity.test.ts`) asserts identical covered
  count, denominator and percentage for every mapping the model renders in every
  `examples/**.stm`: 0 disagreements, down from 45.
- A new coverage rule is one change in core and reaches every consumer. ADR-036's
  tier and ADR-037's conferral needed no viz work at all once the derivation was
  gone.
- The card gained the tri-state and the tier for free, so a partly-mapped record
  and an `@ref`-derived hop are now distinguishable in the UI.
- Metric endpoints report coverage on the card, which the index-based resolver
  does not manage.
- Deleting the path-set API removes the shape that made the defect expressible,
  rather than documenting a hazard and leaving it in place.

**Negative:**

- `@satsuma/viz-model` is no longer dependency-free. It was deliberately a
  contract-only package, and the coverage types are the one thing it now imports.
- Model assembly does more work: every mapping's coverage is computed even when no
  consumer displays it, and NL refs are resolved per document. Assembly is
  per-file and already parses and indexes, so this is a small addition to an
  existing cost, but it is not free — and the live editor re-assembles on edit.
- Coverage is attached per file, before `mergeVizModels`, which upgrades an
  imported stub card to its full definition. The stub carries the index's fields,
  so the tree is stable in practice, but a future change to what a stub contains
  would need coverage recomputed after the merge.
- The corpus sweep can only catch what the corpus contains. It found neither the
  duplicate-label nor the anonymous-mapping defect above, because no file under
  `examples/` has either shape — both are pinned by fixtures instead
  (`coverage-duplicate-mapping-labels.stm`, `coverage-anonymous-mapping.stm`). A
  sweep over real files is a good net for rules that apply everywhere and no
  substitute for a case built to exercise one.
- The card is now inert without a host that supplies coverage: a model assembled
  with no workspace index renders rows with no verdicts. That is the honest
  reading, and it is why absent must not be displayed as zero, but it is a
  behaviour a consumer has to handle rather than a default it inherits.
- `uncoveredFieldCoverage` exists only to give a card a denominator, which is a
  narrow reason for a public function. The alternative — letting the card count
  its own fields — is what ADR-034 forbids.

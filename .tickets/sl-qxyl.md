---
id: sl-qxyl
status: closed
deps: [sl-hrql, sl-ez36]
links: []
created: 2026-07-31T15:54:44Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [coverage, core, nl-refs]
---
# coverage: resolved @refs do not count toward coverage, contradicting ADR-013

`satsuma coverage` treats a field referenced only by a resolved NL `@ref` as
uncovered. ADR-013 ("NL @ref Mentions as Implicit Field Lineage", Accepted,
unsuperseded) says the opposite: a resolved `@ref` "carries the same lineage
weight as a declared source field to the left of an arrow" and such refs "are
not second-class". `arrows`, `graph`, `lineage`, `field-lineage` and `lint` all
honour that. `coverage` is the sole dissenter.

The exclusion was introduced as a Feature 35 non-goal and was never recorded as
an amendment to ADR-013. ADR-036 reverses it and defines the replacement
contract; this ticket implements ADR-036.

## Observed

    mapping load {
      source { src_a, src_b }
      target { tgt }
      -> gross_total { "Add @net_amount and @tax_amount" }
      -> final_total  { "@gross_total minus @discount" }
    }

    $ satsuma coverage
      source  src_a   0/3   0%
      source  src_b   0/2   0%
      target  tgt     2/3  67%

All five source fields are reported uncovered and listed by `--uncovered`, while
`field-lineage` resolves every one of them and labels the edges `nl-derived`.
The aggregate "covered by no mapping" section — which `coverage --help` calls
"the claim worth acting on" — names live fields, so a reader who trusts it will
delete them. `coverage --fail-under --role source` is unusable on any spec that
leans on the idiom.

## Expected (per ADR-036)

    $ satsuma coverage
      source  src_a   3/3  100%  (1 declared, 2 nl)
      source  src_b   1/2   50%  (0 declared, 1 nl)
      target  tgt     2/3   67%  (2 declared, 0 nl)

Two tiers over one denominator. ADR-034's leaf-only denominator is unchanged —
this splits the numerator only.

## Blocked on the resolution defects

`sl-hrql` and `sl-ez36` must land first. Until they do, refs inside
`each` / `flatten` / `nested_arrow` resolve to fabricated field paths, and this
change would attribute coverage to fields that do not exist — a silent
overstatement inside a merge gate.

Interacts with `sl-joeq`: a resolved `@ref` yields a canonical full path, so it
must be registered as a real path rather than a bare segment.

## Documentation to reconcile

The superseded claim is recorded in five places, all of which must change with
the code:

- `features/35-coverage-command/PRD.md:233` — Out of Scope bullet
- `features/38-hierarchical-coverage/PRD.md:576` — Out of Scope bullet
- `tooling/satsuma-core/src/coverage.ts` — module comment ("deliberately
  structural only")
- `tooling/satsuma-cli/src/commands/coverage.ts` — `--help` text
- `SATSUMA-CLI.md:126`, `:317`, `:383` — including the positioning claim that
  "`coverage` is a command rather than a workflow precisely because it needs no
  NL interpretation", which needs restating as *resolution is not
  interpretation* rather than deletion

## Acceptance Criteria

- A leaf counts as covered when a declared arrow references it **or** a resolved
  `@ref` in the same mapping names it. A field covered both ways counts once, in
  the declared tier.
- `covered` = `covered_declared` + `covered_nl`; `total` is unchanged and still
  governed by ADR-034 (leaves only, own flag, records excluded).
- Unresolved refs contribute nothing — coverage must not rise when a ref breaks.
- A ref with `context: "source_block"` counts toward source coverage only; it
  names no target field and cannot contribute target coverage.
- Each `FieldCoverageEntry` carries the tier that covered it, so a rendered
  field list and its adjacent count derive from one definition.
- The rule lives only in `computeMappingCoverage()` (path collection, tagged by
  origin) and `summarizeFieldCoverage()` (all counting). No consumer computes
  its own denominator *or* its own split.
- `--fail-under` gates the combined figure; `--role source` gates combined
  source coverage.
- Human output shows the split; `--json` exposes `covered_declared` /
  `covered_nl` per schema, per namespace, per workspace, and in the aggregate.
- Tests: a field covered only by NL; covered by both (counted once, declared);
  covered by an unresolved ref (not counted); a `source_block` ref (source only,
  never target); NL coverage inside `each` / `flatten` / `nested_arrow` once
  sl-hrql and sl-ez36 land; and cross-consumer parity per `sl-5nsv`.
- The five documentation sites above are reconciled in the same PR, each citing
  ADR-036.
- `3cc-t6uo` is either fixed or explicitly re-scoped: the VS Code status bar's
  own rule now disagrees on two axes, not one.

## Notes

**2026-07-31T16:15:18Z**

**2026-07-31T16:15:18Z**

Unblocked: sl-hrql and sl-ez36 are both fixed and closed, so resolved @refs now
carry real field paths on both ends and coverage can credit them safely.

Two changes on main since this ticket was written make the work smaller than the
description implies:

1. sl-joeq replaced name-based matching with path-based matching, and left the
   seam collectBodyPaths -> schemaLocalFieldPath in place. A resolved @ref
   already yields a canonical absolute path, which is exactly the shape that
   seam consumes — so the interaction noted in the description resolves in this
   ticket's favour rather than needing separate work.
2. PRD 38 Open Question 1 resolved (sl-vu22): coverage will derive covered paths
   from extract.ts's arrow output and delete its own CST walker. Sequence this
   ticket AFTER that swap if both are in flight, so the NL tier is added to one
   producer rather than to a walker that is about to be deleted.

ADR-036 is on the branch for PR #409 (adrs/adr-036-nl-ref-coverage-tier.md).
Numbered 036 because another session took 035 for coverage path identity.

**2026-07-31T16:51:44Z**

Cause: coverage excluded NL @refs as a Feature 35 non-goal, contradicting ADR-013 (Accepted, unsuperseded), which binds all lineage-aware tools to follow a resolved @ref with the same weight as a declared source field. Five commands honoured it; coverage alone dissented.

Fix: implements ADR-036. computeMappingCoverage() takes the workspace's resolved @refs and credits the ones naming declared fields, tagged with their tier; summarizeFieldCoverage() derives every count from those tags. Both are the only places the rule lives.

Design notes:
- The seam sl-joeq left in place did the heavy lifting. A resolved ref's resolvedTo.name is a canonical schema-qualified path (::src.net_amount), which is exactly the shape schemaLocalFieldPath consumes, so NL paths resolve through the same per-schema step as arrow paths. One addition to schemaRefPrefixes was needed: a bare schema name now also matches its canonical ::name form, or a global schema's NL coverage would never match.
- NL paths are accepted only when the schema prefix actually came off. A resolved ref is always fully qualified, so requiring the strip keeps another schema's refs out of this schema's set rather than parking unmatchable paths in it.
- findMappingBlock now returns the namespace-qualified mapping key, so refs are matched on the same key resolveAllNLRefs files them under. Matching on the bare label would have credited two same-named mappings in different namespaces with each other's refs.
- Human output shows the tier split only on rows that HAVE nl coverage. Annotating every row of every structural-only report with '(n declared, 0 nl)' is a column of noise for no information; --json always carries both counts. This deviates from the illustrative output in the ticket description, which showed '(2 declared, 0 nl)'.
- LSP: the gutter feeds core the same refs, via a new DefinitionLookup built from the workspace index (schemas, cross-file) plus extractMappings on the current tree (mapping source/target context, which the index does not store in that shape). Without it the editor would have shown fields as unmapped that the CLI reports as covered — a NEW cross-consumer disagreement introduced by this very ticket.

3cc-t6uo: FIXED rather than re-scoped, per ADR-036's requirement that a consumer with its own rule be reconciled. computeTargetCoverageStats now delegates to summarizeFieldCoverage; the top-level-only rule and its stale 'nested paths would double-count' comment are gone, and the tooltip reports the NL share.

Corpus effect: 17 example files gain NL-tier coverage. Notably several source schemas that read 0% now report real figures — order_transactions 0->6, support_tickets 0->5, finance_transactions 0->3, crm_system 0->2, hr_employees 0->2, sat_contact_details 0->4 — which is precisely the failure ADR-036 describes, since the aggregate section named those as covered by no mapping.

Docs reconciled, all five sites plus two more: features/35 PRD out-of-scope bullet (struck through with the reason), features/38 PRD out-of-scope bullet, coverage.ts module comment, coverage --help, SATSUMA-CLI.md :126 (rewritten), :324, :390 (the 'needs no NL interpretation' positioning restated as resolution-is-not-interpretation), plus the SATSUMA-CLI.md JSON contract block — which a CLI test enforces key-for-key against the actual output.

Totals: core 514, cli 972, lsp 292, viz 98, viz-backend 166, viz-model 6, vscode 34, tree-sitter 315/315 parses, npm run lint clean.

Not run: the viz Playwright harness (needs a human-launched browser). Deliberately not touched: satsuma-viz's own buildMappedFieldsIndex still derives coverage from the viz model rather than from core, so the viz overlay does not yet show the tier — that is feature 36's R3/R6 work (sl-hcan, sl-5nsv), not this ticket's.

**2026-08-01T18:14:17Z**

Cause: coverage credited only arrow sources and targets, so a field referenced solely by a resolved NL @ref read as uncovered — the sole consumer dissenting from ADR-013, which gives a resolved @ref the same lineage weight as a declared source field.
Fix: resolved @ref paths now count toward coverage as a distinct tier, reported separately from arrow-covered fields so the weaker evidence stays visible rather than being silently merged (commit 821ae54, PR #413). See ADR-036.

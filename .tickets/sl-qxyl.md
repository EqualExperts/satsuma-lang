---
id: sl-qxyl
status: open
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

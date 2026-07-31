---
id: sl-qxyl
status: open
deps: [sl-hrql, sl-ez36]
links: []
created: 2026-07-31T15:54:44Z
type: task
priority: 3
assignee: Thorben Louw
tags: [coverage, product-decision]
---
# decide: source-role coverage reads 0% for specs that name their sources only in NL

Not a bug — a decision to confirm or revisit.

`coverage` is structural by design: "a field described only in prose (a note
block) is uncovered by definition; use 'nl-refs' to find those"
(coverage.ts module comment, features/35-coverage-command/PRD.md:233,
features/38-hierarchical-coverage/PRD.md:576).

The consequence is sharper than the wording suggests, because the
`-> target { "... @a and @b" }` idiom is a *first-class* way to declare a
mapping, not an aside in a note block. For:

    mapping load {
      source { src_a, src_b }
      target { tgt }
      -> gross_total { "Add @net_amount and @tax_amount" }
      -> final_total { "@gross_total minus @discount" }
    }

    $ satsuma coverage
      source  src_a   0/3   0%
      source  src_b   0/2   0%
      target  tgt     2/3  67%

Every source field is reported uncovered, and `--uncovered` lists all five as
the review queue, even though `field-lineage` resolves them and labels the edges
`nl-derived`. `coverage --fail-under <n> --role source` is therefore unusable on
any spec that leans on the idiom, and the "covered by no mapping" aggregate —
the one the help text says is "the claim worth acting on" — will send a reader
to delete live fields.

The toolchain is already inconsistent about this: `field-lineage`, `arrows` and
`graph` all follow NL @refs and mark them `nl-derived`; only `coverage` does
not. `nl-refs` finds them but has no coverage view.

Options:
  1. Keep structural-only, and make the source-role report say so — e.g. flag
     schemas whose fields are reached only via NL refs, so 0% is legible rather
     than alarming.
  2. Count NL-ref coverage as a distinct tier, reported separately from
     declared coverage (`covered` / `nl-covered` / `uncovered`), leaving the
     structural percentage untouched. Matches how `arrows` and `graph` already
     separate `none` / `nl` / `nl-derived`.
  3. Add an opt-in flag (`--include-nl`) that folds NL-ref coverage into the
     percentage for teams that treat prose refs as declarations.

Option 2 preserves the existing contract while making the report actionable, and
reuses classification vocabulary the CLI already ships.

Blocked on the two nl-ref path bugs: NL-ref coverage computed today would
attribute coverage to fabricated field paths for anything nested.

## Acceptance Criteria

- A decision is recorded (spec, PRD, or ADR) on whether coverage stays
  structural-only, gains a separate NL tier, or gains an opt-in flag.
- If the answer is "stays structural-only", `coverage --role source` output and
  the `--fail-under` help text call out that NL-only sources read as 0%, and
  point at `nl-refs`.
- The decision names how `--fail-under --role source` should behave for a
  prose-heavy spec.


---
id: gpt-uazn
status: closed
deps: []
links: [gpt-pwze, gpt-o0fk]
created: 2026-08-06T13:43:52Z
type: epic
priority: 1
assignee: Thorben Louw
tags: [feature-46, testing, diagnostics, lsp]
---
# Feature 46: generated-input confidence for diagnostics and editor intelligence

Deliver Feature 46 from features/46-generated-property-expansion/PRD.md: close the two structural gaps left by Features 39 and 41. Every generated workspace in the repo is valid by construction, so the whole diagnostic surface (validate, lint, and the LSP's mirror of both) is still fixture-only; and satsuma-lsp has no generated coverage at all, despite three of its features being inverse relations over ground truth the generator already states. Covers a defect-mutator layer in scenario-gen, diagnostic properties in both directions (missed and spurious), an LSP scenario adapter, rename round-trip, diff algebra, and inverse-relation properties for the query commands.

## Acceptance Criteria

R1-R7 are delivered through linked child tickets with their PRD acceptance tests passing; every requirement is accepted by a mutation check that shows the property failing against a deliberately broken implementation, with the counterexample naming the defect; every child records its cause/fix note and passing relevant automated tests before closure; the PRD ticket map and status are reconciled when the epic closes; no diagnostic semantics, rule severities or command output change.


## Notes

**2026-08-06T13:50:27Z**

Project owner decisions, 2026-08-06.

1. R2 asserts diagnostic positions to the mutated construct, not to an exact
   line. Recorded as PRD decision 4; gpt-vq0r's design updated.
2. No bug raised for lint-lineage-cycle / lint-type-mismatch. The claim that they
   were exported from core but unregistered was a false positive: lint-engine.ts
   registers both through the TYPE_MISMATCH_RULE_ID and LINEAGE_CYCLE_RULE_ID
   constants rather than as literal id strings, so a grep for 'id: "..."' misses
   them, and lint-command.test.ts already drives both end to end. All six rules
   are reachable from satsuma lint and all six are in scope for R1's mutators.
   Recorded as PRD decision 3.

**2026-08-06T16:20:03Z**

**2026-08-06T00:00:00Z** — mid-feature handover. Feature is 5/8 done; do not close.

Branch `feat/generated-property-testing`, **draft PR #512**, rebased onto `main` at `fba794db`. Working tree clean, branch pushed and in sync at `15434fab`.

## Landed and green

| Ticket | Commit | |
|---|---|---|
| `gpt-h0dc` R7 | `a3252a66` | formatter preserves semantics, not just shape |
| `gpt-pwze` R1 | `0bbdcab3` | defect mutators and the `WorkspaceDefect` contract |
| `gpt-21jp` R3 | `711dcb7c` | LSP scenario adapter; definition/references duality |
| `gpt-clpj` R6 | `6a5db6dc` | inverse-relation properties for arrows/where-used/find |
| `gpt-o0fk` | `8b074bf5` | pin the registered lint rule set against the docs |
| — | `15434fab` | Semgrep fix: string scan instead of a value-built RegExp |

Counts: core 703 -> 708, cli 1074 -> 1084, lsp 303 -> 317, scenario-gen 30 -> 31. Corpus 318/318. Full `npm run test:all` green (24/24 tasks) plus the tree-sitter corpus run separately.

## Remaining — all three now unblocked

`gpt-vq0r` (R2), `gpt-8izj` (R4), `gpt-ocmp` (R5). **Each carries its own detailed handover note** with the contract facts, the adapters that already exist, and the mutation check it owes. Read the ticket's note before its Design section — the notes correct things the Design got wrong.

The single most important cross-ticket point: **R4 must state which index it asks.** `gpt-bc1x` showed that rename is scoped by `scopeIndex(uri)` and import reachability points one way, so a round-trip over the whole-folder index would prove something the real server does not do.

## Where the CI stands (2026-08-06 end of day)

GitHub Actions was unhealthy all afternoon. Run `31116733850` on `15434fab` had eight jobs fail with `Set up job` as their **only** step — the runner never allocated — and the whole run was then cancelled with no superseding run. A full re-run was queued at end of day and its result is unknown.

**Do not read that run's red as a code failure.** The evidence it is infrastructure: every failing job's only step is `Set up job`; the failing set is a random spread including `Satsuma-to-Excel skill` and `Tree-sitter parser`, which this branch does not touch; the same suites pass locally; and the **Security workflow passed** on the same sha (`31116733731`), which is the run that matters, because Semgrep was the one genuine CI failure this branch caused and `15434fab` fixed it.

First action on resuming: re-check PR #512's checks, and re-run failed jobs before investigating anything.

## Bugs these properties found — filed, pinned, not fixed here

`gpt-bc1x` (rename leaves upstream imports stale), `gpt-qhfo` (`arrows` answers a qualified nested-path query with another field's arrows), `gpt-i1uv` (`unenumerated-record-target` silent for any spread-bearing schema), `gpt-jwek` (three go-to-definition gaps), `gpt-4p1z` (`arrows --json` prose vs `[]`). Each is pinned as a test asserting today's behaviour, so a fix turns the pin red rather than passing unnoticed.

## Two deferred core-concern moves, and why that is a deviation

CLAUDE.md says logic that belongs in core moves **as part of the ticket**, not as cleanup. `gpt-l9rp` (the LSP's declared-usage-site oracle belongs in `scenario-gen`'s ground-truth) and `gpt-ek0e` (the canonical-endpoint owning-schema split exists in four copies, two in core's src) were both filed instead, because parallel agents held those files at the time. That is a knowing deviation from the rule and the project owner has not ruled on it. `gpt-l9rp` in particular should probably land **before** R4, since R4 is the next consumer of that oracle.

## One acceptance criterion that is factually wrong

`gpt-h0dc` predicted that dropping the trailing source of a multi-source arrow would fail the new semantic property while CST-preservation survived. It does not — see that ticket's closing note. The property was kept for contract reasons and the test file's module comment argues the case. If a reviewer disagrees, deleting it is clean.

**2026-08-06T19:03:53Z**

Cause: not a defect — this epic delivers Feature 46. Two structural gaps: every
generated workspace in the repository was valid by construction, so the whole
diagnostic surface was fixture-only; and satsuma-lsp had no generated coverage
at all.
Fix: R1–R7 all shipped on `feat/generated-property-testing` (draft PR #512),
each with its mutation check run and recorded on its own ticket. The PRD's
status line, ticket map and Decisions section, and ROADMAP.md's entry, are
reconciled in the same commit. (commit immediately after 5ae35134)

Test counts: core 703 -> 708, CLI 1074 -> 1157, LSP 303 -> 323,
scenario-gen 30 -> 47.

## Every requirement, and the mutation check that accepted it

- **R1 `gpt-pwze`** — 12 defect mutators, 3 null mutators, the `WorkspaceDefect`
  contract.
- **R2 `gpt-vq0r`** — validate and lint over mutated workspaces. Suppressing the
  `duplicate-definition` push fails it naming the missing rule and entity;
  keying the duplicate check on cross-file visibility fails the *null*-mutation
  property with a spurious finding.
- **R3 `gpt-21jp`** — the LSP scenario adapter and definition/references duality.
- **R4 `gpt-8izj`** — rename round trip. Dropping cross-file edits fails it with
  the surviving `import { s1 }`.
- **R5 `gpt-ocmp`** — diff algebra. Comparing raw `body` instead of
  `canonicalBody` fails the reformat property naming `clean_string`.
- **R6 `gpt-clpj`** — inverse relations for `arrows`, `where-used`, `find`.
- **R7 `gpt-h0dc`** — the formatter preserves meaning, not only shape.
- **`gpt-o0fk`** (outside the requirement set) — the lint registry pinned to the
  docs.
- **`gpt-l9rp`** (raised by R3's review, closed before R4 consumed it) — the
  declared-usage-site oracle moved into `scenario-gen`'s `ground-truth.js`.

## Seven bugs found, filed, and pinned — none fixed here

`gpt-bc1x`, `gpt-qhfo`, `gpt-i1uv`, `gpt-jwek`, `gpt-4p1z`, and from R4
`gpt-fjo7` and `gpt-68ka`. Each is pinned by a test asserting today's behaviour,
so its fix turns that test red. No diagnostic semantics, rule severity or
command output changed anywhere in this feature, which was its stated contract.

## Three requirements were wrong as written, and were corrected rather than met

Each correction is argued in the header of the file that carries it and recorded
as a PRD decision:

1. **R2's set comparison had to become a multiset**, and predictions pair with
   observations by maximum bipartite matching — an entity is only observable as
   a *substring* of a message, and substring containment is not one-to-one.
2. **R4 had to state which index it asks.** Whole-folder, with the scoped
   behaviour pinned as `gpt-bc1x`. Now PRD decision 5.
3. **R5's "diff is empty across every null mutation" is false.** Renaming an
   entity consistently is a structural change and `diff` is right to report it;
   the null mutators preserve meaning for the *diagnostic* surface, not entity
   identity.

Also worth keeping: **`gpt-h0dc`'s acceptance criterion is factually wrong** and
was recorded as such rather than satisfied — CST-structure preservation implies
semantic-index preservation, because every extractor is a pure function of the
CST. The property was kept for contract, not detection.

## Two tickets left open on purpose

`gpt-ek0e` (the helper it asks for already exists; the ticket now carries a
findings note listing four things it got wrong, including a fifth copy it missed
and a behavioural difference between two of the copies) and `gpt-l0nz` (no
generated workspace declares a `transform` block). Neither is a child of this
epic and neither blocks it.

## One trap worth carrying forward

`npm run build` in `satsuma-lsp` is esbuild's bundle; the per-module `dist/*.js`
its tests `require` come from `npm run compile`. R4's mutation check appeared to
*pass* — the property did not fail — purely because the file under test was
never rebuilt. A mutation check that mysteriously fails to fail is the signal to
check what the test actually loaded.

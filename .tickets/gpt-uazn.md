---
id: gpt-uazn
status: open
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

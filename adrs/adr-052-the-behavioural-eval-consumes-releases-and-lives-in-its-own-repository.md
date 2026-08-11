# ADR-052 — The Behavioural Eval Consumes Released Artifacts, and Therefore Lives in Its Own Repository

**Status:** Accepted
**Date:** 2026-08-11 (sl-x9m1; Feature 44 Phase 0.5)

## Context

Feature 44 measures what Satsuma costs an AI agent and what it buys. Its
arms are defined in `docs/product-owner/ROADMAP.md`'s source PRD: arm X reads a
spreadsheet, arm M a markdown table, arm S the `.stm` source alone, and **arm S+
the `.stm` source with the `satsuma` CLI on PATH** — the configuration the
project actually ships. The PRD is explicit that arm S+'s number is "a property
of the agent's invocation choices, not of the CLI," which is why the runner
records every invocation with its flags and output size. But that record is only
interpretable if you also know *which CLI answered*.

Building the runner (`sl-x9m1`) surfaced that the repository could not answer
that question. The `satsuma` on the developer's PATH reported version `0.12.0`
while already carrying `v0.13.0`'s `agent-reference --section` and `--profile`
flags, which shipped with Feature 45. That is `sl-13p5` — non-release builds
carry a stale version — and it means a locally installed CLI's self-reported
version is not evidence of anything. The runner mitigated it by recording the
invoked path, resolved path, reported `--version` *and* `package.json` version
separately, so a disagreement would at least be visible in the results. That is
detection, not prevention: the eval could still measure an artifact it could not
name, and would only say so in a field most readers would skip.

Three further frictions appeared in the same session, all pointing the same way:

**Toolchain.** `evals/` is Python; this repository is npm workspaces, Turborepo
and a tree-sitter WASM build. Getting the runner's `unittest` suite into the
pre-commit hook required a Node wrapper (`scripts/probe-runner.test.mjs`)
shelling out to `python3`, plus widening `lint:python`'s path list. The
behavioural harness then added `pi`, QEMU and a Linux micro-VM to the
dependency list. None of that belongs in a language repository's CI, and the
PRD's own acceptance criteria promise "nothing added to CI time."

**Independence.** Feature 45 carries a registered "no iteration against eval
outcomes" control, because a reference tuned until the eval likes it measures
nothing. Co-location makes that control a matter of discipline. Separation
makes it a matter of mechanism.

**Credibility.** An eval that ships inside the product repository reads as
marketing. One pinned to published releases reads as a study. This matters
because the eval exists to correct published claims, not to confirm them.

The counter-argument is real: the probe's `.stm` scenario is co-designed with
the language, so pinning to a release means a future grammar change can break
the scenario across a repository boundary. That is accepted below.

## Decision

The **behavioural** eval moves to its own repository, `satsuma-eval`, and
consumes **released artifacts only**.

`bin/fetch_satsuma.py` takes a release tag, downloads
`satsuma-cli-<tag>.tgz` from this repository's releases page, and verifies its
SHA-256 against the digest GitHub published for that asset — refusing to install
on a mismatch. It installs into `vendor/`, then materialises the agent reference
by running *that build's own* `agent-reference` command, so the blob arm S is
charged for is by construction the document that version ships rather than a
file checked out beside it. `vendor/manifest.json` records the source repository,
release tag, asset name, SHA-256, and the version the build reports of itself —
the last two kept separate on purpose, so an `sl-13p5`-shaped disagreement shows
up in the results instead of being smoothed over at fetch time.

The runner **refuses to start without that manifest**. There is deliberately no
`--cli-path` escape hatch and no fallback to a `satsuma` on PATH: a fallback
would reintroduce exactly the ambiguity this decision removes, at the moment
someone is in a hurry.

The dividing line is **"does it need the parser, or only released artifacts?"**

- **Moved:** the Phase 0.5 probe scenario, answer keys and lookups; the episode
  runner; the PRD and its working note, so protocol and results live together.
- **Stayed:** the static-compactness measurement
  (`evals/static-compactness/`, `scripts/measure-static-compactness.mjs`). It
  imports `@satsuma/core` to parse each spec and re-render it as equivalent YAML
  and JSON. Core is published in no installable form — the release carries the
  CLI, the LSP and the VSIX — so this measurement *cannot* consume a release the
  way everything in `satsuma-eval` does. Publishing core is the prerequisite for
  ever moving it, and is not part of this decision.

Tickets stay in this repository's `tk` tracker. `tk` is the project's single
tracker and epic `sl-qz3v` links to tickets on both sides of the split; a second
tracker would fragment the dependency graph that makes `tk ready` meaningful.

Git history was **not** rewritten into the new repository. `satsuma-eval`'s
README states where the history lives (this repository, through commit
`a526b798`) rather than fabricating a filtered one.

## Consequences

**Positive:**

- Every eval result names the artifact it measured, verified against the
  publisher's own digest. "Which build was this?" stops being a question of
  trust in the operator's environment.
- The `sl-13p5` class of defect can no longer corrupt a measurement silently.
  Verified on the first fetch: released `v0.13.0` correctly reports `0.13.0`,
  where the locally installed CLI did not.
- This repository's CI keeps its shape — no Python test bridge, no ruff path
  for `evals/`, and no route by which QEMU or a micro-VM could become a
  prerequisite for committing a grammar change.
- Feature 45's Goodhart control is enforced by repository boundary rather than
  by remembering.
- The eval can be opened, shared or published on its own terms without exposing
  or entangling the language repository.

**Negative:**

- **Cross-repository drift is now possible.** A grammar change can break the
  probe scenario, and nothing in this repository's CI will notice. The
  mitigation is that the eval pins a release: the break surfaces at a
  deliberate version bump, in the repository that owns the scenario, rather
  than silently at a merge here. This is a trade, not an elimination.
- **The static/behavioural split is a seam.** Feature 44's measurements now
  live in two repositories, divided by a rule (needs the parser vs. needs only
  a release) that a reader has to be told. Two pointer documents
  (`features/44-token-and-task-eval/README.md`, `evals/README.md`) exist
  because the rule is not self-evident from the file layout.
- **`scripts/probe-spreadsheets.test.mjs` was dropped here and not yet ported.**
  It guarded the committed `.xlsx` arms against regeneration drift — including
  a defect where an earlier version regenerated into the committed directory
  and so read its own output. Until it is re-implemented in Python in the new
  repository, the workbooks have no drift guard.
- **Work now spans two repositories with tickets in one of them.** Anyone
  picking up `sl-x9m1` or `sl-3yzd` must know the code is elsewhere; the
  tickets say so, but the indirection is real.

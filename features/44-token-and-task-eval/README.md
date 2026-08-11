# Feature 44 — token and task eval

**This feature lives in its own repository:
[`satsuma-eval`](https://github.com/EqualExperts/satsuma-eval).**

Moved on 2026-08-11, before any behavioural episode ran. `PRD.md` and
`thoughts-so-far.md` went with it, to `docs/` in that repository, so the protocol
and the results it governs stay together.

## Why it moved

The eval measures **released artifacts**. An eval living beside the source is
always one `npm link` away from measuring a working tree instead — and that is
not hypothetical: the CLI installed on the author's machine reported `0.12.0`
while already carrying `v0.13.0`'s `agent-reference --section` flags, which is
[`sl-13p5`](../../.tickets/sl-13p5.md). In `satsuma-eval` the CLI under test is
downloaded from this repository's releases page by tag, verified against the
published SHA-256, and named in every result file. The ambiguity is gone by
construction rather than by care.

Three more reasons, in `satsuma-eval/README.md`: protocol independence (the
"no iteration against eval outcomes" control), toolchain fit (Python, QEMU and a
micro-VM have no business in this repository's CI), and credibility.

## What stayed here, and why

The **static-compactness** measurement — [`evals/static-compactness/`](../../evals/static-compactness/)
and [`scripts/measure-static-compactness.mjs`](../../scripts/measure-static-compactness.mjs)
— compares `.stm` against equivalent YAML and JSON. It imports `@satsuma/core`
to parse and re-render specs, and core is not published as an installable
artifact, so it cannot consume a release the way everything in `satsuma-eval`
does. Publishing core would be the prerequisite for moving it; until then it
belongs with the parser it depends on.

## Tickets

Eval tickets stay in this repository's `tk` tracker — `sl-qz3v` (the Phase 0.5
epic), `sl-x9m1` (run the arms), `sl-3yzd` (grade and decide) — because `tk` is
the project's single tracker and the epic links to tickets on both sides.

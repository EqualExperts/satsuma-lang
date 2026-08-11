# evals/

What remains here is the **static** measurement only: comparisons that need the
parser, and therefore cannot run against a released artifact.

- [`static-compactness/`](static-compactness/) — the committed serialisation
  design behind the `.stm`-versus-YAML-and-JSON comparison. Driven by
  [`scripts/measure-static-compactness.mjs`](../scripts/measure-static-compactness.mjs),
  which imports `@satsuma/core` to parse each spec and re-render it.

**The behavioural eval moved to [`satsuma-eval`](https://github.com/EqualExperts/satsuma-eval)**
on 2026-08-11 — scenarios, answer keys, episode runner, harness, graders and
results. It consumes only released artifacts, pinned by tag and verified by
digest. See [`features/44-token-and-task-eval/README.md`](../features/44-token-and-task-eval/README.md)
for why the line falls where it does.

Nothing in this directory is part of the npm workspace, the Turborepo graph, or
`npm run test:all`.

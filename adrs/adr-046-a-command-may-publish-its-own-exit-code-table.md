# ADR-046 — A Command May Publish Its Own Exit-Code Table When the CLI-Wide Meanings Contradict It

**Status:** Accepted
**Date:** 2026-08-03 (sl-1u6r)

## Context

The CLI publishes three exit codes for every command
(`tooling/satsuma-cli/src/command-runner.ts`, documented in `SATSUMA-CLI.md`):
`0` success, `1` not found or no results, `2` parse error or filesystem error.
`command-runner.ts` is the single `process.exit` boundary, and the comment on
`EXIT_PARSE_ERROR` states the intent plainly: collapse every "real problem" into
one non-zero code so a script can write `if ! satsuma …; then`, and let `--json`
draw finer distinctions.

That works while a command's failure modes map onto those three meanings. `lint`
has never fitted. It returned `EXIT_PARSE_ERROR` for **error-severity findings**
— a workspace that parsed perfectly and was read without incident — so `2` meant
two unrelated things depending on which command produced it, and in `lint`'s case
the documented meaning was the one that never applied. A CI job could not tell a
failing lint gate from an unreadable checkout: both exited `2`.

`sl-1u6r` then asked for strict mode, where warnings fail the build. Under the
CLI-wide table the only free code was `1`, "not found or no results" — which
would have given `1` a third meaning while `2` still had two. Three codes, five
meanings, none of them documented for this command.

Three alternatives were considered. **Extending the CLI-wide table** with a
global "policy findings present" code was rejected: the meaning is not general,
and every command would inherit a code it can never return, which is how a
shared table becomes noise. **Keeping `2` for both and distinguishing via
`--json`** is the documented philosophy, and it is right for a human at a shell —
but a merge gate reads the code, and asking CI to parse JSON to discover whether
lint ran at all inverts the reason exit codes exist. **Adding a fourth CLI-wide
code** was rejected for the same reason as the first: `1` and `3` would then mean
different things in different commands anyway, which is the situation this ADR
chooses to name explicitly rather than arrive at by accident.

The precedent already existed and was undocumented as a pattern: `fmt --check`
exits `1` for "a file would change" (`SATSUMA-CLI.md`), which is neither "not
found" nor "no results", and `coverage --fail-under` exits `3` for "below
threshold". Two commands had already stepped outside the table.

## Decision

**A command may publish its own exit-code table when the CLI-wide meanings would
be wrong for its outcomes, provided the table is documented alongside the command
and the codes it reuses cannot collide within a single invocation of that
command.** The CLI-wide table remains the default and continues to govern every
command that has not published one.

`lint` publishes this table, in its command help, in `SATSUMA-CLI.md` under *Lint
exit codes*, and in the module header of `tooling/satsuma-cli/src/commands/lint.ts`:

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | No findings, or warnings only without strict mode                           |
| `1`  | Warnings present and strict mode active                                     |
| `2`  | Error-severity findings present                                             |
| `3`  | Lint could not run — unusable config, unknown rule id, unreadable workspace |

The mechanism has three parts. Each command-scoped code is a **named constant in
`command-runner.ts`** whose doc-comment states which command owns it and why it
does not collide — `EXIT_LINT_STRICT_WARNINGS = 1` is numerically
`EXIT_NOT_FOUND`, and the argument for safety is that `lint` takes no lookup
argument that can fail to resolve; `EXIT_LINT_CANNOT_RUN = 3` is numerically
`EXIT_THRESHOLD_NOT_MET`, and `lint` has no threshold gate. The non-collision
argument is part of the constant, not folklore. Second, the whole table is
decided in **one function** — `lintExitCode(diagnostics, strict)` — so the
precedence between errors, warnings and strict mode is readable in one place
rather than distributed across the handler. Third, where a shared helper raises a
CLI-wide code that the command's table assigns a different meaning, the command
**remaps it at its own boundary**: `loadLintWorkspace()` catches
`loadWorkspace`'s `EXIT_PARSE_ERROR` and rethrows it as `EXIT_LINT_CANNOT_RUN`,
passing the message and stream through untouched. Shared helpers keep raising
CLI-wide codes; the translation is the command's responsibility.

Redefining a code a command already returns is a **breaking change** and must be
called out in `CHANGELOG.md` as one. `lint`'s move of "could not run" off `2` is
recorded there.

## Consequences

**Positive:**

- A CI job can distinguish the three outcomes it actually needs to act on
  differently: the gate failed on policy (`1`), the workspace has lint errors
  (`2`), the run never happened (`3`). Under the previous scheme the last two
  were indistinguishable.
- `2` from `lint` now means exactly one thing, which is what it meant in
  practice all along; the documentation and the behaviour agree for the first
  time.
- Strict mode was added without giving any code a second meaning.
- The `fmt --check` and `coverage --fail-under` deviations stop being anomalies
  and become instances of a named pattern, with a rule about when it is allowed.
- The non-collision reasoning is recorded next to each constant, so a future
  command tempted to reuse `EXIT_LINT_CANNOT_RUN` has to confront whether it
  means the same thing.

**Negative:**

- "What does exit 3 mean?" no longer has a single answer for the CLI; a reader
  must know which command produced it. This is the cost the ADR accepts, and it
  is why the table must be documented with the command rather than only in code.
- Two constants now share a numeric value with two others. Nothing prevents a
  future command from returning `EXIT_LINT_STRICT_WARNINGS` by mistake, since the
  type is `number`; the guard is the doc-comment, not the compiler.
- Every published table is a compatibility surface. Changing `lint`'s codes again
  breaks CI jobs a second time, so the table should be treated as settled.
- The pattern is available to commands that do not need it. A command adding a
  table because its author prefers finer codes, rather than because the CLI-wide
  meanings are wrong, would erode the default without the justification this ADR
  requires.

/**
 * command-runner.ts — Top-level dispatcher for CLI command handlers
 *
 * Owns the single point in the CLI where `process.exit` is called. Every
 * Commander `.action(...)` handler is wrapped in {@link runCommand}, which
 * normalises three completion paths:
 *
 *   1. The handler returns normally — exit with code 0 (or the numeric value
 *      it returned, for handlers that need to surface a non-zero "soft"
 *      result like `validate` or `lint` reporting findings).
 *   2. The handler throws a {@link CommandError} — print its message to the
 *      requested stream and exit with the carried code. This is the path
 *      handlers use for "expected" failures like *not found*, bad arguments,
 *      or unreadable input. The message is part of the contract; the runner
 *      does not decorate it.
 *   3. The handler throws anything else — print `Unhandled error: <msg>` to
 *      stderr and exit 2. This is the safety net for genuine bugs (a parser
 *      crash, a TypeError) so they don't escape silently.
 *
 * Why this exists: before sl-3291 the CLI had 53 inline `process.exit` calls
 * scattered across 23 files. That made it impossible to write tests against
 * the error paths without stubbing the global `process` object, and made it
 * impossible for the CLI to be embedded in another process (each handler
 * unilaterally killed the host). Concentrating the exit policy here means:
 *
 *   • handlers are pure functions of their inputs, returning or throwing —
 *     trivially testable without process stubs;
 *   • exit codes are uniform across commands (no command can quietly drift
 *     to a non-standard convention);
 *   • the rules for "what counts as an error" live in one place that a
 *     reader can find by following any handler's wrapper.
 *
 * The constants here are the single source of truth for CLI exit codes;
 * `errors.ts` re-exports them for backward compatibility with callers that
 * import them from the older location.
 */

/** Successful run — no errors, no findings worth surfacing. */
export const EXIT_OK = 0;

/**
 * "Not found" — a lookup failed (schema, mapping, field, transform, …) or
 * a query returned no results. Distinct from a parse failure: the workspace
 * was loaded fine, the user just asked about something that does not exist.
 */
export const EXIT_NOT_FOUND = 1;

/**
 * Parse error, bad argument, unreadable input, or "validate/lint reported
 * an error-severity finding". The CLI deliberately collapses these into a
 * single non-zero code so shell scripts can treat any "real problem" with
 * `if ! satsuma …; then`. Distinguishing them at the script level is the
 * job of `--json` output, not the exit code.
 */
export const EXIT_PARSE_ERROR = 2;

/**
 * `coverage --fail-under <pct>`: the report was produced fine, and the coverage
 * it reports is below the requested threshold.
 *
 * Deliberately its own code rather than reusing {@link EXIT_NOT_FOUND}. Both
 * outcomes are possible from a single invocation — `coverage --fail-under 90
 * --mapping "typo"` can fail because the mapping name is misspelled *or*
 * because the spec is genuinely incomplete — and CI must be able to tell them
 * apart: one means fix the pipeline, the other means finish the mapping. `fmt
 * --check` gets away with a shared code only because it takes no scope
 * arguments that can fail to resolve.
 *
 * Coverage-specific by design. A future gate on another command should reuse
 * this code only if it means the same thing: "the work succeeded, and the
 * measurement it produced fails a policy the caller set".
 */
export const EXIT_THRESHOLD_NOT_MET = 3;

/**
 * `lint`: the command could not run as instructed — an unusable
 * `satsuma.config.yaml`, or a rule id that does not exist named by
 * `--select`/`--ignore`/`lint.suppress`.
 *
 * Numerically the same as {@link EXIT_THRESHOLD_NOT_MET} but a different
 * meaning, which is intentional and command-scoped: `lint` publishes its own
 * exit-code table (PRD 37 R5), following the `fmt --check` precedent of a
 * command owning codes that mean something specific to it. The two never
 * collide in one invocation — `lint` has no threshold gate and `coverage`
 * reads no lint rules.
 *
 * Distinct from {@link EXIT_PARSE_ERROR} on purpose: `2` means "the workspace
 * has lint errors", so "lint never got far enough to judge the workspace"
 * needs its own code for CI to tell a failing gate from a broken setup.
 */
export const EXIT_LINT_CANNOT_RUN = 3;

/**
 * Structured failure raised by command handlers and shared utilities.
 *
 * Throwing a `CommandError` is the canonical way for a handler to abort
 * with a user-facing message. The runner catches it, writes `message` to
 * the chosen stream, and exits with `code`. Handlers must never call
 * `process.exit` directly — that responsibility belongs to {@link runCommand}.
 *
 * The empty-message case (`new CommandError("", code)`) is supported for
 * the situation where the handler has already printed multi-line output
 * (e.g. per-file parse warnings from `loadFiles`) and only needs to signal
 * the exit code. The runner skips printing in that case.
 */
export class CommandError extends Error {
  /**
   * @param message  human-readable failure message; may be empty if the
   *                 handler has already produced its own output.
   * @param code     exit code to surface to the shell (use the EXIT_*
   *                 constants exported by this module).
   * @param stream   output stream for `message`. Defaults to stderr;
   *                 commands that emit JSON-shaped errors on the
   *                 success channel pass `"stdout"`.
   */
  constructor(
    message: string,
    public readonly code: number,
    public readonly stream: "stderr" | "stdout" = "stderr",
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/**
 * Shape of a Commander action handler after wrapping.
 *
 * Handlers may be sync or async. The return value is interpreted as an
 * exit code: `void` / `undefined` means "success" (exit 0); a number is
 * passed straight through to `process.exit`. This lets handlers express
 * "soft" non-zero exits (e.g. validate exiting 2 because findings were
 * reported) without throwing.
 */
export type CommandHandler<Args extends unknown[]> = (
  ...args: Args
) => Promise<number | void> | number | void;

/**
 * Wrap a Commander `.action(...)` handler so it participates in the
 * single-dispatcher exit policy described in the module header.
 *
 * Usage:
 * ```ts
 * program.command("foo")
 *   .action(runCommand(async (arg, opts) => {
 *     if (!arg) throw new CommandError("missing argument", EXIT_PARSE_ERROR);
 *     return doWork(arg) ? EXIT_OK : EXIT_NOT_FOUND;
 *   }));
 * ```
 *
 * After this wrapper, the handler should not contain any reference to
 * `process.exit`. If you find yourself reaching for one, throw a
 * `CommandError` or return a numeric code instead.
 */
export function runCommand<Args extends unknown[]>(
  handler: CommandHandler<Args>,
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    // Compute the exit code from one of three completion paths, then
    // flush + exit exactly once below. Keeping the exit out of the
    // try/catch prevents the wrapper from accidentally catching its
    // own teardown (a real bug we hit during development: a throwing
    // process.exit stub re-entered the unknown-error branch).
    let code: number;
    try {
      const handlerReturn = await handler(...args);
      code = typeof handlerReturn === "number" ? handlerReturn : EXIT_OK;
    } catch (err: unknown) {
      if (err instanceof CommandError) {
        if (err.message) {
          const sink = err.stream === "stdout" ? console.log : console.error;
          sink(err.message);
        }
        code = err.code;
      } else {
        // Unknown error — surface it as an unhandled crash so the bug
        // is visible in CI logs and shell scripts. We deliberately don't
        // try to be clever about formatting: anything reaching this
        // branch is by definition unexpected.
        const message = (err as { message?: string })?.message ?? String(err);
        console.error(`Unhandled error: ${message}`);
        code = EXIT_PARSE_ERROR;
      }
    }
    await flushAndExit(code);
  };
}

/**
 * Drain stdout and stderr before calling `process.exit`.
 *
 * Why this matters: when stdout is piped to another process (or to a
 * test harness reading the child's output), Node buffers writes and
 * `process.exit` can fire before the buffer is flushed, truncating the
 * tail of large `--json` payloads. Several commands emit multi-megabyte
 * graphs, so the truncation is observable in practice — see the
 * `graph.test.ts` regression that motivated this drain.
 *
 * The empty-write callback fires when each stream's internal buffer is
 * empty, which is the cheapest way to wait for a flush without taking
 * a hard dependency on the `tty` vs `pipe` distinction. We do both
 * streams in parallel because there's no ordering constraint between
 * them at exit time.
 */
async function flushAndExit(code: number): Promise<never> {
  await Promise.all([
    new Promise<void>((r) => process.stdout.write("", () => r())),
    new Promise<void>((r) => process.stderr.write("", () => r())),
  ]);
  process.exit(code);
}

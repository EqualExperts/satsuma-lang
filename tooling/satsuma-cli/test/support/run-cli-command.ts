/**
 * run-cli-command.ts — invoke a real CLI command in-process and capture its output.
 *
 * Every query command's whole implementation lives inside its Commander
 * `.action(...)` closure: `where-used`, `find` and `arrows` export nothing but
 * `register`. A test therefore has exactly two ways to reach the code a user
 * runs — spawn `dist/index.js`, or register the command on a throwaway
 * `Command` and drive it here. The hand-written suites spawn (see
 * `where-used.test.ts`), which is right for a dozen fixture cases and wrong for
 * a generated property: a property queries every declared field of every
 * generated workspace, and a process spawn per query would cost minutes per
 * property.
 *
 * This module is the second way. It is deliberately *not* a reimplementation of
 * anything: the command's own `register` function is what runs, so argument
 * parsing, workspace loading, resolution, JSON shaping and exit codes are all
 * the production paths. The only thing simulated is the process boundary.
 *
 * Owns: the process-boundary simulation — argv in, stdout/stderr/exit code out.
 * Does not own: what any command means, or any expectation about its output.
 *
 * ## Why the stubs are safe here
 *
 * `console.log`, `console.error` and `process.exit` are global, so an invocation
 * is not re-entrant and two must never overlap. Node's test runner runs the
 * cases within one file sequentially and every call below is awaited, so they
 * cannot. Do not call this from inside a `Promise.all`.
 */

import { Command, CommanderError } from "commander";

/** What a CLI invocation produced, as a caller would see it from a shell. */
export interface CliCommandResult {
  /** Everything the command wrote to stdout, newline-joined. `--json` payloads land here. */
  stdout: string;
  /** Everything the command wrote to stderr, newline-joined. */
  stderr: string;
  /** The exit code the command asked for — see command-runner.ts's EXIT_* constants. */
  code: number;
}

/**
 * Sentinel thrown by the `process.exit` stub.
 *
 * `runCommand` calls `process.exit` outside its own try/catch on purpose, so a
 * throwing stub is the only faithful substitute for `(code) => never` — the same
 * pattern `command-runner.test.ts` uses.
 */
class ProcessExited extends Error {
  constructor(readonly exitCode: number) {
    super(`process.exit(${exitCode})`);
    this.name = "ProcessExited";
  }
}

/**
 * Run one CLI command in this process and return what it printed and exited with.
 *
 * @param register  the command module's own `register` export, e.g.
 *                  `import { register } from "#src/commands/arrows.js"`. Passing
 *                  the function rather than a module name keeps the import
 *                  static, so a typo is a compile error rather than a runtime one.
 * @param argv      the arguments a user would type *after* the command name,
 *                  e.g. `["s0.field_0", entryPath, "--json"]`.
 *
 * Commander's own failures (an unknown flag, a missing required option) come
 * back as an exit code and text on `stderr`, exactly as they would from a shell,
 * rather than as a thrown error — so a property can assert on them.
 */
export async function runCliCommand(
  register: (program: Command) => void,
  argv: string[],
): Promise<CliCommandResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const program = new Command();
  // Without this, a usage error would call process.exit inside Commander itself
  // and our stub's throw would surface as an unhandled rejection rather than a
  // result. Commander's own output is routed into the same buffers.
  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => stdout.push(text),
    writeErr: (text) => stderr.push(text),
  });
  register(program);

  // The command's name is the first token Commander needs; every command module
  // registers exactly one, so we can read it back rather than being told it.
  const commandName = program.commands[0]?.name();
  if (commandName === undefined) {
    throw new Error("register() added no command to the program");
  }

  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  process.exit = ((code?: number): never => {
    throw new ProcessExited(code ?? 0);
  }) as typeof process.exit;
  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));

  let code = 0;
  try {
    await program.parseAsync([commandName, ...argv], { from: "user" });
  } catch (err) {
    if (err instanceof ProcessExited) code = err.exitCode;
    else if (err instanceof CommanderError) code = err.exitCode;
    // Anything else is a genuine crash in the command under test: let it out so
    // the property reports it rather than silently turning it into an exit code.
    else throw err;
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  return { stdout: stdout.join("\n"), stderr: stderr.join("\n"), code };
}

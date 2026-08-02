/**
 * command-runner.test.ts — Unit tests for the CLI's exit dispatcher
 *
 * `runCommand` is the single point in the CLI that calls `process.exit`.
 * Every command handler funnels through it, so the contract pinned here
 * is what those handlers depend on:
 *
 *   • a handler that returns nothing exits 0;
 *   • a handler that returns a number exits with that number;
 *   • a handler that throws CommandError prints the message on the
 *     requested stream and exits with the carried code;
 *   • an empty-message CommandError signals exit code without printing
 *     (used by callers like `loadFiles` that already wrote per-file
 *     warnings to stderr);
 *   • any other thrown error becomes "Unhandled error: …" on stderr
 *     with code 2 — the safety net for genuine bugs that escape a
 *     handler.
 *
 * Process.exit is observed via a throwing stub. This is the *one* test
 * file in the suite that needs that pattern; everything else can now
 * simply assert the thrown CommandError directly.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  runCommand,
  CommandError,
  EXIT_OK,
  EXIT_NOT_FOUND,
  EXIT_PARSE_ERROR,
} from "#src/command-runner.js";

// ── process.exit / console capture ──────────────────────────────────────────

class ExitCalled extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

let originalExit: typeof process.exit;
let originalErr: typeof console.error;
let originalLog: typeof console.log;
let stderrLines: string[];
let stdoutLines: string[];

beforeEach(() => {
  originalExit = process.exit;
  originalErr = console.error;
  originalLog = console.log;
  stderrLines = [];
  stdoutLines = [];
  // A throwing stub is the closest faithful substitute for `(code) => never`.
  process.exit = ((code?: number): never => {
    throw new ExitCalled(code ?? 0);
  }) as typeof process.exit;
  console.error = (...args: unknown[]) => {
    stderrLines.push(args.map((a) => String(a)).join(" "));
  };
  console.log = (...args: unknown[]) => {
    stdoutLines.push(args.map((a) => String(a)).join(" "));
  };
});

afterEach(() => {
  process.exit = originalExit;
  console.error = originalErr;
  console.log = originalLog;
});

// Convenience: run a wrapped handler and capture the exit code that the
// stub throws. Any other thrown error fails the test.
async function runAndExpectExit(
  handler: () => Promise<number | void> | number | void,
): Promise<number> {
  const wrapped = runCommand(handler);
  try {
    await wrapped();
  } catch (err) {
    if (err instanceof ExitCalled) return err.code;
    throw err;
  }
  throw new Error("expected runCommand to call process.exit, but it returned normally");
}

// ── return-value cases ──────────────────────────────────────────────────────

describe("runCommand return values", () => {
  it("exits 0 when the handler returns void", async () => {
    // The most common case: a successful command that printed its output
    // and has nothing more to say. The wrapper must default void → EXIT_OK.
    const code = await runAndExpectExit(() => {
      /* no-op */
    });
    assert.equal(code, EXIT_OK);
    assert.deepEqual(stderrLines, []);
    assert.deepEqual(stdoutLines, []);
  });

  it("forwards a numeric return value as the exit code", async () => {
    // Handlers like `validate --quiet` or `find` use this to surface a
    // soft non-zero exit ("findings present" / "no matches") without
    // throwing.
    const code = await runAndExpectExit(() => EXIT_NOT_FOUND);
    assert.equal(code, EXIT_NOT_FOUND);
  });

  it("awaits an async handler before exiting", async () => {
    // Async handlers must be awaited — otherwise the wrapper would exit
    // on the dangling promise and lose the return value entirely.
    const code = await runAndExpectExit(async () => {
      await new Promise((r) => setImmediate(r));
      return EXIT_PARSE_ERROR;
    });
    assert.equal(code, EXIT_PARSE_ERROR);
  });
});

// ── CommandError cases ──────────────────────────────────────────────────────

describe("runCommand CommandError handling", () => {
  it("prints the message to stderr and exits with the carried code", async () => {
    // The canonical "expected failure" path: a handler throws a structured
    // CommandError and the wrapper does the printing + exit on its behalf.
    // Verifies both halves of the contract handlers depend on.
    const code = await runAndExpectExit(() => {
      throw new CommandError("schema 'foo' not found", EXIT_NOT_FOUND);
    });
    assert.equal(code, EXIT_NOT_FOUND);
    assert.deepEqual(stderrLines, ["schema 'foo' not found"]);
    assert.deepEqual(stdoutLines, []);
  });

  it("routes message to stdout when stream is 'stdout'", async () => {
    // JSON-mode commands need their error payloads on the success channel
    // so consumers can pipe through `jq` without losing the body. The
    // wrapper must honour the stream selector — this pins that.
    const payload = JSON.stringify({ error: "not found" });
    const code = await runAndExpectExit(() => {
      throw new CommandError(payload, EXIT_NOT_FOUND, "stdout");
    });
    assert.equal(code, EXIT_NOT_FOUND);
    assert.deepEqual(stdoutLines, [payload]);
    assert.deepEqual(stderrLines, []);
  });

  it("skips printing when the message is empty", async () => {
    // Used by helpers like `loadFiles` that have already printed
    // per-file warnings and only need to signal the final exit code.
    // Without this branch the empty line would still be written.
    const code = await runAndExpectExit(() => {
      throw new CommandError("", EXIT_PARSE_ERROR);
    });
    assert.equal(code, EXIT_PARSE_ERROR);
    assert.deepEqual(stderrLines, []);
    assert.deepEqual(stdoutLines, []);
  });
});

// ── unknown-error safety net ────────────────────────────────────────────────

describe("runCommand unknown-error safety net", () => {
  it("formats arbitrary thrown errors as 'Unhandled error: …' and exits 2", async () => {
    // Anything that's not a CommandError represents a genuine bug — a
    // TypeError, a parser crash, an assertion failure. We want those
    // visible in CI logs with a stable prefix and a non-zero exit, not
    // swallowed silently.
    const code = await runAndExpectExit(() => {
      throw new TypeError("undefined is not a function");
    });
    assert.equal(code, EXIT_PARSE_ERROR);
    assert.equal(stderrLines.length, 1);
    assert.match(stderrLines[0]!, /^Unhandled error: undefined is not a function$/);
  });

  it("stringifies non-Error throws so the user sees something useful", async () => {
    // Code that throws bare strings or numbers is wrong, but the wrapper
    // must still produce a readable message rather than `[object Object]`.
    const code = await runAndExpectExit(() => {
      // Throwing a bare string (non-Error) is wrong code, but the runner
      // must still produce a readable message rather than [object Object].
      const oops: unknown = "something went wrong";
      throw oops;
    });
    assert.equal(code, EXIT_PARSE_ERROR);
    assert.equal(stderrLines.length, 1);
    assert.match(stderrLines[0]!, /Unhandled error: something went wrong/);
  });
});

/**
 * Tests for the pure CLI error-normalization rules (sl-wlta).
 *
 * execFile's error.code is a number for non-zero process exits but a string
 * errno for spawn failures. The old `Number(error.code)` coercion produced
 * "exit code NaN" messages for ENOENT — the most common new-user failure,
 * hit whenever the satsuma CLI is not installed. These rules guarantee a
 * numeric exit code and an actionable message for that case.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  exitCodeFrom,
  spawnFailureMessage,
} = require("../dist/client/commands/cli-runner-logic.js");

describe("exitCodeFrom", () => {
  it("returns 0 when the process exited cleanly", () => {
    assert.equal(exitCodeFrom(null), 0);
  });

  it("passes through a numeric non-zero exit code", () => {
    assert.equal(exitCodeFrom({ code: 2 }), 2);
  });

  it("maps a string errno to exit code 1, never NaN", () => {
    // The regression under test: Number("ENOENT") is NaN.
    const code = exitCodeFrom({ code: "ENOENT", message: "spawn satsuma ENOENT" });
    assert.equal(code, 1);
    assert.ok(!Number.isNaN(code));
  });

  it("treats an error without a code as exit 1", () => {
    // e.g. the 15s timeout kills the process: error.code is undefined.
    assert.equal(exitCodeFrom({ message: "killed" }), 1);
  });
});

describe("spawnFailureMessage", () => {
  it("names the missing CLI and how to install it for ENOENT", () => {
    const msg = spawnFailureMessage({ code: "ENOENT" }, "satsuma");
    assert.match(msg, /Satsuma CLI not found at "satsuma"/);
    assert.match(msg, /satsuma\.cliPath/);
  });

  it("reports other spawn errnos with their code", () => {
    const msg = spawnFailureMessage({ code: "EACCES", message: "permission denied" }, "/opt/satsuma");
    assert.match(msg, /EACCES/);
    assert.match(msg, /permission denied/);
  });

  it("returns null for ordinary non-zero exits so real stderr is shown", () => {
    // A failing validate run produces its own stderr; the synthetic message
    // must not mask it.
    assert.equal(spawnFailureMessage({ code: 1, message: "exit 1" }, "satsuma"), null);
    assert.equal(spawnFailureMessage(null, "satsuma"), null);
  });
});

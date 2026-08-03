/**
 * warnings-logic.test.js — parsing and line-number shaping of
 * `satsuma warnings --json` output (sl-6osm).
 *
 * These are the transformations that decide where the "show warnings"
 * command's gutter diagnostics land; a regression here means every marker
 * silently lands on the wrong line (or line 0), same as the bug this ticket
 * fixed.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseWarningsResponse,
  groupWarningsByFile,
} = require("../dist/client/commands/warnings-logic.js");

describe("parseWarningsResponse", () => {
  it("parses a well-formed envelope", () => {
    const raw = JSON.stringify({
      kind: "warning",
      count: 1,
      items: [{ text: "some records have NULL", line: 12, file: "a.stm" }],
    });
    assert.deepEqual(parseWarningsResponse(raw), {
      kind: "warning",
      count: 1,
      items: [{ text: "some records have NULL", line: 12, file: "a.stm" }],
    });
  });

  it("returns undefined for unparseable JSON", () => {
    // The CLI can fail before emitting valid JSON (e.g. a crash mid-write);
    // the command falls back to showing stderr in this case, not a diagnostic.
    assert.equal(parseWarningsResponse("not json"), undefined);
  });

  it("returns undefined when items is not an array", () => {
    // Distinguishes a malformed response from a validly-parsed empty one —
    // the two produce different user-facing messages in warnings.ts.
    assert.equal(parseWarningsResponse(JSON.stringify({ kind: "warning", count: 0 })), undefined);
  });
});

describe("groupWarningsByFile", () => {
  it("converts the CLI's 1-indexed line to a 0-indexed marker line", () => {
    // sl-6osm: a prior version of this command read a `row` field the CLI
    // had already renamed to `line`, so `item.row ?? 0` always fell back to
    // 0 and every warning jumped to the top of the file instead of its real
    // line. This is the regression test for that fix.
    const byFile = groupWarningsByFile([{ text: "note", line: 12, file: "a.stm" }]);
    assert.deepEqual(byFile.get("a.stm"), [{ line: 11, text: "note" }]);
  });

  it("groups multiple items under the same file", () => {
    const byFile = groupWarningsByFile([
      { text: "first", line: 1, file: "a.stm" },
      { text: "second", line: 5, file: "a.stm" },
      { text: "third", line: 2, file: "b.stm" },
    ]);
    assert.deepEqual(byFile.get("a.stm"), [
      { line: 0, text: "first" },
      { line: 4, text: "second" },
    ]);
    assert.deepEqual(byFile.get("b.stm"), [{ line: 1, text: "third" }]);
  });

  it("skips items without a file rather than throwing", () => {
    // Defensive against the subprocess boundary — the CLI always sets
    // `file`, but this response crosses a process, not a function call.
    const byFile = groupWarningsByFile([{ text: "orphan", line: 1, file: "" }]);
    assert.equal(byFile.size, 0);
  });
});

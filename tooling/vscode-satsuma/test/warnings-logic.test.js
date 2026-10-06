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
  summariseMarkers,
} = require("../dist/client/commands/warnings-logic.js");

/** Wrap items in the default (unfiltered) envelope the command requests. */
const response = (items, kind = "warning") => ({ kind, count: items.length, items });

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
    const byFile = groupWarningsByFile(
      response([{ kind: "warning", text: "note", line: 12, file: "a.stm" }]),
    );
    assert.equal(byFile.get("a.stm")[0].line, 11);
  });

  it("keeps each item's own kind when warnings and questions are mixed (gh-542)", () => {
    // The default response carries both under a "warning" envelope; reading
    // the envelope instead of the item would list every question as a
    // Warning, which is what Show Warnings did before sl-0j8b.
    const byFile = groupWarningsByFile(
      response([
        { kind: "warning", text: "NULLs in source", line: 1, file: "a.stm" },
        { kind: "question", text: "should this be INT?", line: 5, file: "a.stm" },
        { kind: "question", text: "who owns this feed?", line: 2, file: "b.stm" },
      ]),
    );
    assert.deepEqual(byFile.get("a.stm"), [
      { kind: "warning", line: 0, message: "NULLs in source" },
      { kind: "question", line: 4, message: "Question: should this be INT?" },
    ]);
    assert.deepEqual(byFile.get("b.stm"), [
      { kind: "question", line: 1, message: "Question: who owns this feed?" },
    ]);
  });

  it("falls back to the envelope kind for items from a CLI that predates per-item kinds", () => {
    // Under --questions the envelope kind is exact, so an old CLI's
    // question-only response still lands at Information.
    const byFile = groupWarningsByFile(
      response([{ text: "who owns this feed?", line: 3, file: "a.stm" }], "question"),
    );
    assert.equal(byFile.get("a.stm")[0].kind, "question");
  });

  it("skips items without a file rather than throwing", () => {
    // Defensive against the subprocess boundary — the CLI always sets
    // `file`, but this response crosses a process, not a function call.
    const byFile = groupWarningsByFile(response([{ text: "orphan", line: 1, file: "" }]));
    assert.equal(byFile.size, 0);
  });
});

describe("summariseMarkers", () => {
  it("counts questions, so a questions-only workspace is not reported as clean (gh-542)", () => {
    const byFile = groupWarningsByFile(
      response([
        { kind: "question", text: "a?", line: 1, file: "a.stm" },
        { kind: "question", text: "b?", line: 2, file: "b.stm" },
      ]),
    );
    assert.equal(summariseMarkers(byFile), "Satsuma: 0 warnings and 2 questions found.");
  });

  it("uses the singular for a count of one", () => {
    const byFile = groupWarningsByFile(
      response([
        { kind: "warning", text: "w", line: 1, file: "a.stm" },
        { kind: "question", text: "q?", line: 2, file: "a.stm" },
      ]),
    );
    assert.equal(summariseMarkers(byFile), "Satsuma: 1 warning and 1 question found.");
  });

  it("says plainly when there is nothing to list", () => {
    assert.equal(summariseMarkers(new Map()), "Satsuma: no warnings or questions found.");
  });
});

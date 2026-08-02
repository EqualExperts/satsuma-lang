/**
 * warnings.test.ts — Focused CLI coverage for the `satsuma warnings` command.
 *
 * Exercises the real command so warning/question filtering, grouped text
 * output, JSON output, and not-found exit semantics stay aligned.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runCli } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const COMMENTS = resolve(__dirname, "fixtures/comments-test.stm");
const CLEAN = resolve(__dirname, "fixtures/lint-clean.stm");

const run = (...args: string[]) => runCli(CLI, ...args);

describe("satsuma warnings", () => {
  it("prints warnings and questions together in default text mode", async () => {
    // Default mode intentionally shows both comment kinds; the line prefixes
    // are how humans distinguish warnings from questions in one pass.
    const { stdout, code } = await run("warnings", COMMENTS);

    assert.equal(code, 0);
    assert.match(stdout, /comments-test\.stm/);
    assert.match(stdout, /:4 {2}\/\/! warning: data quality issue/);
    assert.match(stdout, /:5 {2}\/\/\? should we rename this\?/);
    assert.match(stdout, /:12 {2}\/\/! warning: aggregation may be incorrect/);
    assert.match(stdout, /:13 {2}\/\/\? consider using SUM instead/);
  });

  it("filters text output to questions with --questions", async () => {
    // The questions flag must be a true filter, not just a label change.
    const { stdout, code } = await run("warnings", "--questions", COMMENTS);

    assert.equal(code, 0);
    assert.match(stdout, /:5 {2}\/\/\? should we rename this\?/);
    assert.match(stdout, /:13 {2}\/\/\? consider using SUM instead/);
    assert.doesNotMatch(stdout, /warning: data quality issue/);
    assert.doesNotMatch(stdout, /warning: aggregation may be incorrect/);
  });

  it("emits default JSON with block context for both warning and question items", async () => {
    // JSON consumers need stable counts, one-based lines, and enclosing block
    // context for every extracted comment item.
    const { stdout, code } = await run("warnings", "--json", COMMENTS);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.kind, "warning");
    assert.equal(data.count, 4);
    assert.deepEqual(
      data.items.map((item: { line: number }) => item.line),
      [4, 5, 12, 13],
    );
    assert.ok(
      data.items.every(
        (item: { block: string; blockType: string }) => item.block && item.blockType,
      ),
    );
  });

  it("emits question-only JSON with the question kind and filtered count", async () => {
    // `--questions --json` is the structured counterpart to question text
    // mode; it must not include warning comments under a question payload.
    const { stdout, code } = await run("warnings", "--questions", "--json", COMMENTS);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.kind, "question");
    assert.equal(data.count, 2);
    assert.deepEqual(
      data.items.map((item: { text: string }) => item.text),
      ["should we rename this?", "consider using SUM instead"],
    );
  });

  it("returns EXIT_NOT_FOUND while keeping empty JSON parseable", async () => {
    // Empty results are a meaningful not-found state, but JSON callers still
    // need a parseable payload rather than stderr-only text.
    const { stdout, code } = await run("warnings", "--json", CLEAN);

    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(stdout), { kind: "warning", count: 0, items: [] });
  });
});

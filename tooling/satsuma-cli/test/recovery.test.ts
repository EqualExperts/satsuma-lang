/**
 * recovery.test.ts — Error-recovery integration tests for the CLI.
 *
 * The tree-sitter grammar produces MISSING / ERROR nodes when input is
 * malformed (unterminated braces, dangling identifiers, missing closing
 * tokens). These tests assert that user-facing CLI commands degrade
 * *gracefully* on such input — they print a structured result and exit
 * with a defined code rather than crashing with an unhandled exception
 * or hanging the user's editor / build pipeline.
 *
 * Each case writes a deliberately broken `.stm` file to a tmp dir, runs
 * one CLI command, and asserts:
 *   1. The process exits with a numeric code (no crash signal).
 *   2. stderr does not contain a Node-level stack trace.
 *   3. The command produces *some* parseable output for the recovered tree.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run, type RunResult } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");

/** Run the CLI with the given arguments. */
const satsuma = (...args: string[]) => run(CLI, ...args);

/** Write `source` to a temporary .stm file and return its absolute path. */
function writeBroken(prefix: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), `stm-recovery-${prefix}-`));
  const file = join(dir, "broken.stm");
  writeFileSync(file, source);
  return file;
}

/** Assert that a CLI run did not crash (exited with a numeric code, no JS stack). */
function assertGraceful(result: RunResult): void {
  assert.equal(typeof result.code, "number", `expected numeric exit code, got ${result.code}`);
  assert.ok(
    !/at .* \(.+:\d+:\d+\)/.test(result.stderr),
    `stderr looks like a Node stack trace:\n${result.stderr}`,
  );
}

describe("CLI error recovery — broken .stm input", () => {
  // ── 1. summary on a schema with an unterminated body ──────────────────────
  it("summary degrades gracefully on an unterminated schema body", async () => {
    // Closing brace of `customers` is missing; tree-sitter will recover with
    // a MISSING `}` node. summary should still print the section headings.
    const file = writeBroken("summary", "schema customers {\n  id UUID\n  name VARCHAR\n");
    const result = await satsuma("summary", file);
    assertGraceful(result);
    // The recovered tree still contains a `customers` schema definition.
    assert.match(
      result.stdout + result.stderr,
      /customers|Schemas/i,
      "summary should mention either the schema name or the Schemas section",
    );
  });

  // ── 2. extract schemas on a file with a dangling field type ───────────────
  it("extract schemas tolerates a field with a missing type", async () => {
    // `email` has no type — the parser inserts a MISSING type node. extract
    // should still emit a JSON document and not blow up.
    const file = writeBroken(
      "extract",
      "schema customers {\n  id UUID\n  email\n  name VARCHAR\n}\n",
    );
    const result = await satsuma("extract", "schemas", file, "--json");
    assertGraceful(result);
    // Either we got JSON output, or the command exited non-zero with a
    // structured error message — both are acceptable. What is *not* acceptable
    // is an unhandled crash.
    if (result.stdout.trim().length > 0) {
      assert.doesNotThrow(() => {
        JSON.parse(result.stdout);
      }, "stdout should be valid JSON when produced");
    } else {
      assert.notEqual(result.code, 0, "empty stdout must coincide with non-zero exit");
      assert.ok(result.stderr.length > 0, "non-zero exit must report a reason on stderr");
    }
  });

  // ── 3. find on a mapping with an unterminated arrow expression ────────────
  it("find runs against a file with an unterminated mapping body", async () => {
    // The mapping body has an arrow but no target identifier and no closing
    // brace. find should still walk the recovered CST without crashing.
    const file = writeBroken(
      "find",
      `schema src { id UUID }
schema dim { id UUID }
mapping \`m\` {
  source { src }
  target { dim }
  id ->
`,
    );
    const result = await satsuma("find", "schema", "src", file);
    assertGraceful(result);
    // Either find walks the recovered CST and surfaces `src`, or it bails out
    // with a structured non-zero exit. Both demonstrate graceful degradation.
    if (result.code === 0) {
      assert.match(result.stdout, /src/);
    } else {
      assert.ok(result.stderr.length > 0, "non-zero exit must explain itself on stderr");
    }
  });
});

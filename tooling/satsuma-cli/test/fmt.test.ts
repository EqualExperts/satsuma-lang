/**
 * fmt.test.ts — Tests for `satsuma fmt` command
 *
 * Exercises --check, --diff, and --stdin modes via CLI subprocess,
 * plus idempotency and parse-error handling. The formatter logic
 * itself (format.ts) is covered transitively; these tests validate
 * the command's exit codes, output format, and error paths.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const EXAMPLES = resolve(__dirname, "../../../examples");

/** Run the CLI with the given arguments. */
const satsuma = (...args: string[]) => run(CLI, ...args);

// ── --check mode ────────────────────────────────────────────────────────────

describe("satsuma fmt --check", () => {
  it("exits 0 for already-formatted file", async () => {
    // Canonical examples should already be formatted
    const file = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { code, stderr } = await satsuma("fmt", "--check", file);
    assert.equal(code, 0, `should exit 0, stderr: ${stderr}`);
  });

  it("exits 1 for file that would change", async () => {
    // Create a messy file by adding extra whitespace
    const tmp = mkdtempSync(join(tmpdir(), "fmt-check-"));
    const messyFile = join(tmp, "messy.stm");
    writeFileSync(messyFile, "schema  messy_schema    {\n  id    INT\n}\n");
    try {
      const { code, stdout } = await satsuma("fmt", "--check", messyFile);
      assert.equal(code, 1, "should exit 1 when file would change");
      assert.ok(
        stdout.includes("messy.stm") || stdout.includes("messy"),
        "should print the filename that would change",
      );
    } finally {
      unlinkSync(messyFile);
    }
  });
});

// ── --diff mode ─────────────────────────────────────────────────────────────

describe("satsuma fmt --diff", () => {
  it("prints unified diff header for files that would change", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "fmt-diff-"));
    const messyFile = join(tmp, "diff-test.stm");
    writeFileSync(messyFile, "schema  diff_schema    {\n  id    INT\n}\n");
    try {
      const { stdout, code } = await satsuma("fmt", "--diff", messyFile);
      assert.equal(code, 0);
      assert.match(stdout, /^---/m, "should have --- header");
      assert.match(stdout, /^\+\+\+/m, "should have +++ header");
    } finally {
      unlinkSync(messyFile);
    }
  });

  it("produces no output for already-formatted file", async () => {
    const file = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { stdout, code } = await satsuma("fmt", "--diff", file);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "", "should produce no diff output");
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe("satsuma fmt idempotency", () => {
  it("formatting a formatted file produces no change", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "fmt-idemp-"));
    const src = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const copy = join(tmp, "pipeline.stm");
    copyFileSync(src, copy);

    // Format once
    const { code: c1 } = await satsuma("fmt", copy);
    assert.equal(c1, 0);
    const after1 = readFileSync(copy, "utf8");

    // Format again
    const { code: c2 } = await satsuma("fmt", copy);
    assert.equal(c2, 0);
    const after2 = readFileSync(copy, "utf8");

    assert.equal(after1, after2, "formatting should be idempotent");
    unlinkSync(copy);
  });
});

// ── Parse error handling ────────────────────────────────────────────────────

describe("satsuma fmt error handling", () => {
  it("skips files with parse errors and reports on stderr", async () => {
    const fixture = resolve(__dirname, "fixtures/parse-error.stm");
    const { stderr } = await satsuma("fmt", "--check", fixture);
    // Should mention parse error but not crash
    assert.match(stderr, /parse error/i);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────────

describe("satsuma fmt edge cases", () => {
  it("produces correct type-column alignment for backtick field names containing newlines (sl-w5fs)", async () => {
    // A backtick field name with an embedded newline spans two lines. The type
    // column should align relative to the last line of the name, not the full
    // string length (which includes the newline character).
    const tmp = mkdtempSync(join(tmpdir(), "fmt-edge-"));
    const file = join(tmp, "test.stm");
    writeFileSync(file, "schema test {\n  `name with\nnewline` STRING\n}\n");

    await satsuma("fmt", file);

    // The formatted output is written to the file in-place; read it back.
    const result = readFileSync(file, "utf8");
    unlinkSync(file);

    // The last line of the field name is "newline`". The type must appear on
    // the same line as the closing backtick, with at least 2 spaces gap.
    assert.match(result, /newline`\s{2,}STRING/, "type should align on last line of backtick name");
  });
});

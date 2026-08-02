/**
 * errors.test.ts — Unit tests for src/errors.ts
 *
 * The behaviours pinned here are the contract that command handlers
 * depend on:
 *
 *   • findSuggestion's case-insensitive exact-then-prefix matching;
 *   • loadFiles' partial-success policy (warn on parse errors, abort on
 *     read failures via CommandError);
 *   • notFound's message shape (suggestion line, available list vs count
 *     fallback) and exit code.
 *
 * These tests no longer need to stub `process.exit` — every failure
 * surface is now expressed via thrown CommandError, which is observable
 * directly. The exit-dispatcher behaviour itself is covered in
 * command-runner.test.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findSuggestion, loadFiles, notFound } from "#src/errors.js";
import { CommandError, EXIT_NOT_FOUND, EXIT_PARSE_ERROR } from "#src/command-runner.js";

// ── findSuggestion ──────────────────────────────────────────────────────────

describe("findSuggestion", () => {
  it("returns case-insensitive exact match in preference to a prefix match", () => {
    // 'ORDERS' matches 'orders' exactly when lowercased — must beat any
    // prefix-only candidate so the user sees the most relevant hint.
    assert.equal(findSuggestion("ORDERS", ["orders", "order_items"]), "orders");
  });

  it("falls back to a 3-character prefix match when no exact match exists", () => {
    // The prefix rule is what catches typos like 'cust' → 'customers'.
    assert.equal(findSuggestion("cust", ["customers", "orders"]), "customers");
  });

  it("returns null when neither rule applies", () => {
    // No exact match, no usable prefix → no suggestion. The caller will
    // fall through to the bare "not found" message.
    assert.equal(findSuggestion("xyz", ["orders", "customers"]), null);
  });

  it("returns null when the available list is empty", () => {
    // Edge case: an empty workspace shouldn't crash the matcher.
    assert.equal(findSuggestion("anything", []), null);
  });
});

// ── loadFiles ───────────────────────────────────────────────────────────────

describe("loadFiles", () => {
  it("returns successfully parsed files when every parse succeeds", () => {
    // The happy path: every file parses cleanly, every result flows
    // through. Pins that loadFiles preserves order and shape.
    const mockParse = (f: string) => ({ filePath: f, tree: {}, errorCount: 0 });
    const result = loadFiles(["a.stm", "b.stm"], mockParse as never);
    assert.equal(result.length, 2);
    assert.equal(result[0]!.filePath, "a.stm");
  });

  it("warns on parse errors but keeps the file in the result list", () => {
    // Partial-parse policy: a file with parse errors is still useful for
    // commands that walk the CST, so loadFiles must not drop it. The
    // warning goes to stderr.
    const stderrCaptured: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((s: string) => {
      stderrCaptured.push(s);
      return true;
    }) as never;
    try {
      const mockParse = (f: string) => ({ filePath: f, tree: {}, errorCount: 2 });
      const result = loadFiles(["bad.stm"], mockParse as never);
      assert.equal(result.length, 1);
      assert.ok(
        stderrCaptured.some((s) => s.includes("2 parse error")),
        "expected per-file parse-error warning on stderr",
      );
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("throws CommandError(EXIT_PARSE_ERROR) when a file cannot be read", () => {
    // The hard-failure path: any read failure aborts the command. The
    // per-file error is emitted directly by the helper (the throw carries
    // an empty message because the runner would otherwise double-print).
    const stderrCaptured: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((s: string) => {
      stderrCaptured.push(s);
      return true;
    }) as never;
    try {
      const mockParse = (_f: string) => {
        throw new Error("ENOENT");
      };
      assert.throws(
        () => loadFiles(["missing.stm"], mockParse as never),
        (err: unknown) =>
          err instanceof CommandError && err.code === EXIT_PARSE_ERROR && err.message === "",
      );
      assert.ok(
        stderrCaptured.some((s) => s.includes("could not read or parse missing.stm")),
        "expected per-file read-error message on stderr before the throw",
      );
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("returns an empty array for an empty file list", () => {
    // Edge case: zero inputs is a no-op success, not an error. Some
    // commands compose loadFiles with a filter that may legitimately
    // produce no paths.
    const result = loadFiles([], () => ({ filePath: "", tree: {}, errorCount: 0 }) as never);
    assert.equal(result.length, 0);
  });
});

// ── notFound ────────────────────────────────────────────────────────────────

describe("notFound", () => {
  it("includes a 'did you mean' suggestion when one is available", () => {
    // The most user-visible thing this helper does. The suggestion comes
    // from findSuggestion, so this also covers the wiring between the
    // two without re-testing the matching rules themselves.
    assert.throws(
      () => notFound("Schema", "ORDERS", ["orders", "customers"]),
      (err: unknown) =>
        err instanceof CommandError &&
        err.code === EXIT_NOT_FOUND &&
        err.message.includes("Did you mean 'orders'"),
    );
  });

  it("lists every alternative when there are 10 or fewer", () => {
    // Up to MAX_INLINE_AVAILABLE the user gets the full list inline,
    // because dumping it is cheaper than making them re-query.
    assert.throws(
      () => notFound("Schema", "xyz", ["a", "b", "c"]),
      (err: unknown) => err instanceof CommandError && err.message.includes("Available: a, b, c"),
    );
  });

  it("collapses long lists into a count to avoid wall-of-text output", () => {
    // Beyond 10 alternatives the inline list is more noise than signal,
    // so we show the count instead. Pins the threshold and the wording.
    const many = Array.from({ length: 15 }, (_, i) => `s${i}`);
    assert.throws(
      () => notFound("Schema", "xyz", many),
      (err: unknown) =>
        err instanceof CommandError && err.message.includes("15 schemas in workspace"),
    );
  });

  it("omits the 'did you mean' line when the query exactly matches an entry", () => {
    // A user querying the canonical name shouldn't be told they meant
    // exactly what they typed. Guards against an old regression in
    // findSuggestion's exact-match branch.
    assert.throws(
      () => notFound("Schema", "orders", ["orders", "customers"]),
      (err: unknown) => err instanceof CommandError && !err.message.includes("Did you mean"),
    );
  });
});

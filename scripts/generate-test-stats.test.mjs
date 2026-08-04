/**
 * Contract tests for the parsing logic behind test-stats.json generation.
 *
 * These test the pure parsing/assembly functions against small fixture
 * strings, not the real repo's live counts — the script's correctness is
 * "does it read a tool's summary output right", not "what number does the
 * CLI happen to report today".
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStats,
  parseCliCommandCount,
  parseCorpusTestCount,
  parseNodeTestCount,
} from "./generate-test-stats.mjs";

test("reads the node --test summary line printed by the default spec reporter", () => {
  const output = "✔ some test (1ms)\nℹ tests 689\nℹ suites 177\nℹ pass 689\nℹ fail 0\n";
  assert.equal(parseNodeTestCount(output), 689);
});

test("reads the node --test summary line printed by the tap reporter used in CI", () => {
  const output = "ok 1 - some test\n# tests 679\n# pass 679\n# fail 0\n";
  assert.equal(parseNodeTestCount(output), 679);
});

test("does not mistake a test named 'tests' for the summary line", () => {
  // A passing test whose own name/diagnostic text contains the word "tests"
  // must not be read as the run's total — only the anchored summary line at
  // the start of a line counts.
  const output = "✔ counts all tests correctly (1ms)\nℹ tests 42\n";
  assert.equal(parseNodeTestCount(output), 42);
});

test("throws rather than silently recording zero when the summary line is missing", () => {
  // A truncated or unrecognized reporter output must fail loudly, not write
  // a wrong count into test-stats.json.
  assert.throws(() => parseNodeTestCount("some unrelated output\n"), /summary line/);
});

test("reads tree-sitter's 'Total parses' summary line", () => {
  const output =
    "    318. ✓ Two map entries on one line still require a comma\n\n" +
    "Total parses: 318; successful parses: 318; failed parses: 0; success percentage: 100.00%; average speed: 5033 bytes/ms\n";
  assert.equal(parseCorpusTestCount(output), 318);
});

test("throws when tree-sitter's summary line is missing", () => {
  assert.throws(() => parseCorpusTestCount("no summary here\n"), /Total parses/);
});

test("counts real CLI commands and excludes commander's auto-appended help entry", () => {
  // The exact off-by-one this parser must not reintroduce: commander always
  // appends a synthetic "help [command]" line that is not a Satsuma command.
  const helpText =
    "Usage: satsuma [options] [command]\n\n" +
    "Options:\n" +
    "  -V, --version  output the version number\n\n" +
    "Commands:\n" +
    "  summary [options] [path]  Summarise a Satsuma file\n" +
    "  fmt [options] [path]      Format Satsuma files\n" +
    "  help [command]            display help for command\n";
  assert.equal(parseCliCommandCount(helpText), 2);
});

test("throws when --help output has no Commands section", () => {
  // Defends against silently reporting 0 commands for a broken or unbuilt CLI.
  assert.throws(
    () => parseCliCommandCount("Usage: satsuma\n\nOptions:\n  -h, --help\n"),
    /Commands:/,
  );
});

test("assembles test-stats.json with no volatile fields, so an unchanged rerun is byte-identical", () => {
  const stats = buildStats({
    cliCommands: 23,
    parserCorpusTests: 318,
    packages: { "satsuma-core": 689 },
  });
  assert.deepEqual(stats, {
    cliCommands: 23,
    parserCorpusTests: 318,
    packages: { "satsuma-core": 689 },
  });
});

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
  resolveCorpusTestCountFromLog,
  resolvePackageCountFromLog,
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

test("reads the summary line out of a colourised log, as Turborepo records one", () => {
  // Node colourises its summary, so a task that actually *executes* writes
  // "\x1b[34mℹ tests 7\x1b[39m" into tooling/<pkg>/.turbo/turbo-test.log. The
  // summary pattern is anchored to the line, so the escapes made it unmatchable
  // and the pre-commit hook failed with "Could not find a node --test summary
  // line". It stayed hidden because a Turborepo *cache hit* replays a log
  // captured without a TTY, and therefore without colour — so the step passed
  // every run until an unrelated dependency change invalidated the cache.
  assert.equal(parseNodeTestCount("[34mℹ tests 7[39m\n"), 7);
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

test("falls back to the previous count when run-repo-checks.sh's corpus step was skipped (no wasm feature)", () => {
  // run-repo-checks.sh treats a wasm-feature-less tree-sitter-cli as a
  // deliberate skip, not a failure — a skip must not be read as "0 tests".
  const skippedOutput = "[tree-sitter corpus] SKIP — tree-sitter-cli built without wasm feature\n";
  const previousStats = { cliCommands: 23, parserCorpusTests: 318, packages: {} };
  assert.equal(resolveCorpusTestCountFromLog(skippedOutput, previousStats), 318);
});

test("prefers a fresh count over the previous one when the corpus step actually ran", () => {
  const output = "Total parses: 320; successful parses: 320; failed parses: 0;\n";
  const previousStats = { cliCommands: 23, parserCorpusTests: 318, packages: {} };
  assert.equal(resolveCorpusTestCountFromLog(output, previousStats), 320);
});

test("throws on a skipped corpus step with no previous test-stats.json to fall back to", () => {
  // Otherwise a skip on the very first run would silently write parserCorpusTests: undefined.
  assert.throws(
    () => resolveCorpusTestCountFromLog("SKIP\n", null),
    /no previous test-stats\.json/,
  );
});

test("falls back to a package's previous count when run-repo-checks.sh doesn't exercise it locally", () => {
  // The local hook is a fast gate, not the full CI matrix — some tracked
  // packages (e.g. satsuma-viz-backend) have no captured log at all.
  assert.equal(resolvePackageCountFromLog(null, 182, "satsuma-viz-backend"), 182);
});

test("throws when a package has neither a captured log nor a previous count", () => {
  assert.throws(
    () => resolvePackageCountFromLog(null, undefined, "satsuma-viz-backend"),
    /No captured log for satsuma-viz-backend/,
  );
});

test("parses a package's real captured log instead of falling back, when one exists", () => {
  const output = "ℹ tests 1049\n";
  assert.equal(resolvePackageCountFromLog(output, 1031, "satsuma-cli"), 1049);
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

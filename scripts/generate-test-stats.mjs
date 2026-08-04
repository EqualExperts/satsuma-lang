/**
 * Computes the CLI command count and every tracked package's test count, and
 * writes them to test-stats.json at the repo root.
 *
 * That file is the single source of truth README.md, AGENTS.md, and the
 * website (site/_data/stats.json, copied from it at deploy time) read from,
 * instead of each hardcoding a number that immediately starts drifting.
 *
 * Two ways to gather the numbers, behind the same parsing logic:
 *   - default: spawn each package's own test command and parse its output.
 *   - `--from-logs <dir>`: read output already captured elsewhere. The
 *     pre-commit hook (scripts/run-repo-checks.sh) tees its own test run
 *     into per-package log files, so this mode adds no second test run.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATS_PATH = path.join(REPO_ROOT, "test-stats.json");
const CLI_ENTRY_POINT = path.join(REPO_ROOT, "tooling/satsuma-cli/dist/index.js");

// ── Parsing ─────────────────────────────────────────────────────────────
// All three counts are read from a tool's own summary output rather than
// re-derived by scanning source — the running tool is the most authoritative
// (and cheapest) source of truth available for each number.

/**
 * Node's built-in test runner (used by every package in this repo — there is
 * no vitest/jest) prints this exact line regardless of which reporter is
 * active: "ℹ tests N" for the default spec reporter, "# tests N" for the tap
 * reporter used in CI. Anchoring to the start of the line means a test
 * *named* "tests" can never be mistaken for the summary.
 */
const NODE_TEST_SUMMARY_PATTERN = /^(?:ℹ|#)\s+tests\s+(\d+)\s*$/m;

/** tree-sitter's `test --wasm` ends every run with this exact summary line. */
const CORPUS_SUMMARY_PATTERN = /Total parses:\s*(\d+);/;

/** Commander auto-appends this to every program's command list; it isn't a Satsuma CLI command. */
const COMMANDER_HELP_ENTRY_PATTERN = /^help\s/;

/** Extracts the test count from a package's `node --test` output. Throws on unrecognized output rather than silently recording zero. */
export function parseNodeTestCount(output) {
  const match = output.match(NODE_TEST_SUMMARY_PATTERN);
  if (!match) {
    throw new Error("Could not find a node --test summary line ('tests N') in the given output");
  }
  return Number(match[1]);
}

/** Extracts the corpus test count from tree-sitter's `test --wasm` output. */
export function parseCorpusTestCount(output) {
  const match = output.match(CORPUS_SUMMARY_PATTERN);
  if (!match) {
    throw new Error(
      "Could not find tree-sitter's 'Total parses: N' summary line in the given output",
    );
  }
  return Number(match[1]);
}

/** Same as parseCorpusTestCount, but returns null instead of throwing — for callers with a fallback. */
export function tryParseCorpusTestCount(output) {
  const match = output.match(CORPUS_SUMMARY_PATTERN);
  return match ? Number(match[1]) : null;
}

/**
 * Resolves the corpus test count from a captured log that may be a real run
 * or a deliberate skip (see collectCorpusTestCount's doc comment for why a
 * skip is expected, not an error). Falls back to the previous test-stats.json
 * value on a skip; throws if there is no previous value to fall back to.
 */
export function resolveCorpusTestCountFromLog(output, previousStats) {
  const parsed = tryParseCorpusTestCount(output);
  if (parsed !== null) {
    return parsed;
  }
  if (previousStats?.parserCorpusTests === undefined) {
    throw new Error(
      "tree-sitter's corpus check was skipped this run and there is no previous test-stats.json to fall back to",
    );
  }
  return previousStats.parserCorpusTests;
}

/**
 * Counts commands from the CLI's own `--help` output — the shipped source of
 * truth, rather than a count of `.command(...)` call sites in the source
 * (which would double-count comments/examples and needs the build fresh
 * anyway). Excludes commander's auto-appended `help [command]` entry.
 */
export function parseCliCommandCount(helpText) {
  const commandsSection = helpText.split(/^Commands:\s*$/m)[1];
  if (!commandsSection) {
    throw new Error("CLI --help output has no 'Commands:' section");
  }
  return commandsSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !COMMANDER_HELP_ENTRY_PATTERN.test(line)).length;
}

/** Assembles the exact test-stats.json shape from already-parsed numbers. No timestamp field: a re-run with unchanged counts must produce a byte-identical file. */
export function buildStats({ cliCommands, parserCorpusTests, packages }) {
  return { cliCommands, parserCorpusTests, packages };
}

// ── Package registry ───────────────────────────────────────────────────

/**
 * Packages whose test count is tracked. `tooling/satsuma-viz-harness` is
 * deliberately absent — it's Playwright, run only through the human-in-the-
 * loop watcher documented in AGENTS.md, never by a plain `npm test`, so
 * there is no automatic run to source a count from.
 */
export const TRACKED_PACKAGES = [
  { key: "satsuma-core", npmScript: "test" },
  { key: "satsuma-cli", npmScript: "test" },
  { key: "satsuma-lsp", npmScript: "test" },
  { key: "satsuma-viz-model", npmScript: "test" },
  { key: "satsuma-viz-backend", npmScript: "test" },
  { key: "satsuma-viz", npmScript: "test" },
  // vscode-satsuma's "test" script also runs vscode-tmgrammar-test grammar
  // fixture/golden checks, which print no "tests N" summary of their own.
  // test:unit is the slice that does, and is the count this package has
  // always meant by its test count.
  { key: "vscode-satsuma", npmScript: "test:unit" },
];

// ── Collection ──────────────────────────────────────────────────────────

/** Returns a captured log's contents, or null if run-repo-checks.sh never teed that step (e.g. a package it doesn't exercise locally). */
function readCapturedLogIfPresent(logDir, name) {
  const logPath = path.join(logDir, `${name}.log`);
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : null;
}

function runNpmScript(packageKey, npmScript) {
  return execFileSync("npm", ["run", npmScript], {
    cwd: path.join(REPO_ROOT, "tooling", packageKey),
    encoding: "utf8",
  });
}

/**
 * Resolves one package's test count from a captured log that may not exist —
 * run-repo-checks.sh doesn't run every tracked package locally (it's the
 * fast local gate, not the full CI matrix). No log means no fresh count this
 * run; keep the last committed value rather than treat "the local hook
 * doesn't exercise this package" as "the count is zero".
 */
export function resolvePackageCountFromLog(output, previousCount, key) {
  if (output === null) {
    if (previousCount === undefined) {
      throw new Error(
        `No captured log for ${key} and no previous test-stats.json value to fall back to`,
      );
    }
    return previousCount;
  }
  return parseNodeTestCount(output);
}

function collectPackageCounts(fromLogsDir, previousStats) {
  const packages = {};
  for (const { key, npmScript } of TRACKED_PACKAGES) {
    packages[key] = fromLogsDir
      ? resolvePackageCountFromLog(
          readCapturedLogIfPresent(fromLogsDir, key),
          previousStats?.packages?.[key],
          key,
        )
      : parseNodeTestCount(runNpmScript(key, npmScript));
  }
  return packages;
}

/**
 * In --from-logs mode, the captured log is whatever run-repo-checks.sh's own
 * corpus step produced — and that step deliberately SKIPs (rather than
 * fails) when the globally resolved tree-sitter-cli lacks the wasm feature,
 * relying on the JS integration tests to cover the corpus instead. A skip
 * means no fresh count is available this run; keep the last committed value
 * rather than treat "the hook chose not to run this" as "the count is zero".
 * Default (spawn) mode has no such gap — it always runs through the
 * project's own wasm-capable local binary — so it always parses for real.
 */
function collectCorpusTestCount(fromLogsDir, previousStats) {
  if (!fromLogsDir) {
    // `npm run test`, not a bare `tree-sitter test --wasm`: the globally
    // resolved tree-sitter-cli binary may lack the wasm feature, but the
    // project's own devDependency (resolved by the npm script via
    // node_modules/.bin) always has it — the same reason AGENTS.md tells
    // humans to run this suite through `npm test`, not the CLI directly.
    return parseCorpusTestCount(runNpmScript("tree-sitter-satsuma", "test"));
  }

  const output = readCapturedLogIfPresent(fromLogsDir, "tree-sitter-satsuma");
  if (output === null) {
    if (previousStats?.parserCorpusTests === undefined) {
      throw new Error(
        "No captured log for tree-sitter-satsuma and no previous test-stats.json value to fall back to",
      );
    }
    return previousStats.parserCorpusTests;
  }
  return resolveCorpusTestCountFromLog(output, previousStats);
}

/** Reads the currently committed test-stats.json, if any — the fallback source when a run-repo-checks.sh step was skipped rather than run. */
function readPreviousStats() {
  if (!fs.existsSync(STATS_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(STATS_PATH, "utf8"));
}

/** Always introspects the already-built CLI directly — cheap, no test suite involved, identical in both run modes. */
function collectCliCommandCount() {
  const helpText = execFileSync("node", [CLI_ENTRY_POINT, "--help"], { encoding: "utf8" });
  return parseCliCommandCount(helpText);
}

function writeStats(stats) {
  fs.writeFileSync(STATS_PATH, `${JSON.stringify(stats, null, 2)}\n`);
}

// ── CLI entry point ─────────────────────────────────────────────────────

function parseFromLogsArg(argv) {
  const flagIndex = argv.indexOf("--from-logs");
  if (flagIndex === -1) {
    return null;
  }
  const dir = argv[flagIndex + 1];
  if (!dir) {
    throw new Error("--from-logs requires a directory argument");
  }
  return dir;
}

function main() {
  const fromLogsDir = parseFromLogsArg(process.argv.slice(2));
  const previousStats = readPreviousStats();

  // Package tests run (or their logs are read) before the CLI is introspected:
  // satsuma-cli's own "test" script rebuilds dist/ via npm's automatic pretest
  // hook, so by the time collectCliCommandCount() runs, dist/index.js is fresh
  // in both run modes (run-repo-checks.sh also builds it explicitly first).
  const packages = collectPackageCounts(fromLogsDir, previousStats);
  const parserCorpusTests = collectCorpusTestCount(fromLogsDir, previousStats);
  const cliCommands = collectCliCommandCount();

  writeStats(buildStats({ cliCommands, parserCorpusTests, packages }));
  console.log(`Wrote ${STATS_PATH}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

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
 *   - `--from-logs [dir]`: read output a caller already produced, adding no
 *     second test run. Turborepo writes one log per `test` task it runs (and
 *     replays it on a cache hit), which is where almost every count comes from;
 *     the optional directory is for a caller with output of its own to
 *     contribute, as scripts/run-repo-checks.sh has for the tree-sitter corpus.
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

/**
 * SGR escape sequences, as written by Node's test reporter and replayed
 * verbatim into Turborepo's per-task logs.
 *
 * These have to come out before matching. Node colourises its summary, so the
 * line in `tooling/<pkg>/.turbo/turbo-test.log` reads
 * `\x1b[34mℹ tests 7\x1b[39m` — and {@link NODE_TEST_SUMMARY_PATTERN} is
 * anchored to the start and end of the line, precisely so that a test *named*
 * "tests" cannot be mistaken for the summary. The anchors and the escapes are
 * both wanted; stripping is what lets them coexist.
 *
 * The failure this prevents is confusing out of proportion to its size: it
 * appears only when a task actually executes, because a Turborepo *cache hit*
 * replays a log captured earlier without a TTY and therefore without colour.
 * So the stats step passes run after run and fails the first time an unrelated
 * dependency change invalidates the cache.
 */
// eslint-disable-next-line no-control-regex -- matching escape sequences is the point
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

/** Removes SGR escapes so a colourised log matches the same patterns a plain one does. */
function withoutAnsi(output) {
  return output.replace(ANSI_ESCAPE_PATTERN, "");
}

/** Commander auto-appends this to every program's command list; it isn't a Satsuma CLI command. */
const COMMANDER_HELP_ENTRY_PATTERN = /^help\s/;

/** Extracts the test count from a package's `node --test` output. Throws on unrecognized output rather than silently recording zero. */
export function parseNodeTestCount(output) {
  const match = withoutAnsi(output).match(NODE_TEST_SUMMARY_PATTERN);
  if (!match) {
    throw new Error("Could not find a node --test summary line ('tests N') in the given output");
  }
  return Number(match[1]);
}

/** Extracts the corpus test count from tree-sitter's `test --wasm` output. */
export function parseCorpusTestCount(output) {
  const match = withoutAnsi(output).match(CORPUS_SUMMARY_PATTERN);
  if (!match) {
    throw new Error(
      "Could not find tree-sitter's 'Total parses: N' summary line in the given output",
    );
  }
  return Number(match[1]);
}

/** Same as parseCorpusTestCount, but returns null instead of throwing — for callers with a fallback. */
export function tryParseCorpusTestCount(output) {
  const match = withoutAnsi(output).match(CORPUS_SUMMARY_PATTERN);
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
  { key: "integration-tests", npmScript: "test" },
  // vscode-satsuma's "test" script also runs vscode-tmgrammar-test grammar
  // fixture/golden checks, which print no "tests N" summary of their own.
  // test:unit is the slice that does, and is the count this package has
  // always meant by its test count.
  { key: "vscode-satsuma", npmScript: "test:unit" },
];

// ── Collection ──────────────────────────────────────────────────────────

/**
 * A package's already-captured test output, or null if nothing captured it.
 *
 * Two places are consulted, in order:
 *
 *   1. `<logDir>/<name>.log`, for a caller that captured the output itself.
 *      scripts/run-repo-checks.sh uses this for the tree-sitter corpus, whose
 *      step is bespoke: it runs `tree-sitter test --wasm` directly so it can
 *      skip gracefully when the resolved binary lacks the wasm feature, and
 *      that skip message is what the log has to carry.
 *   2. `tooling/<name>/.turbo/turbo-test.log`, which Turborepo writes for every
 *      `test` task it runs and replays on a cache hit. Since R4 this is where
 *      almost every count comes from, and it is why neither the hook nor CI has
 *      to run a package's suite a second time to count it.
 *
 * `logDir` is optional: a caller with nothing of its own to contribute passes
 * nothing and gets Turborepo's logs alone.
 */
function readCapturedLogIfPresent(logDir, name) {
  const candidates = [
    ...(logDir ? [path.join(logDir, `${name}.log`)] : []),
    path.join(REPO_ROOT, "tooling", name, ".turbo", "turbo-test.log"),
  ];
  for (const logPath of candidates) {
    if (fs.existsSync(logPath)) return fs.readFileSync(logPath, "utf8");
  }
  return null;
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

function collectPackageCounts(capture, previousStats) {
  const packages = {};
  for (const { key, npmScript } of TRACKED_PACKAGES) {
    packages[key] = capture.fromLogs
      ? resolvePackageCountFromLog(
          readCapturedLogIfPresent(capture.logDir, key),
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
function collectCorpusTestCount(capture, previousStats) {
  if (!capture.fromLogs) {
    // `npm run test`, not a bare `tree-sitter test --wasm`: the globally
    // resolved tree-sitter-cli binary may lack the wasm feature, but the
    // project's own devDependency (resolved by the npm script via
    // node_modules/.bin) always has it — the same reason AGENTS.md tells
    // humans to run this suite through `npm test`, not the CLI directly.
    return parseCorpusTestCount(runNpmScript("tree-sitter-satsuma", "test"));
  }

  const output = readCapturedLogIfPresent(capture.logDir, "tree-sitter-satsuma");
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

/**
 * How this run gets its numbers.
 *
 * `--from-logs` selects captured mode, and its directory argument is optional:
 * a caller that captured nothing of its own (CI, which lets Turborepo capture
 * everything) passes the bare flag. Without the flag the run is authoritative
 * and spawns each suite itself.
 *
 * The flag is deliberately explicit rather than inferred from whether Turborepo
 * logs happen to exist. A turbo log is current for the inputs that produced it,
 * but it survives a later source edit, so trusting one that no caller just
 * refreshed could report a count for code that has since changed.
 *
 * @returns {{fromLogs: boolean, logDir: string|null}}
 */
function parseCaptureMode(argv) {
  const flagIndex = argv.indexOf("--from-logs");
  if (flagIndex === -1) {
    return { fromLogs: false, logDir: null };
  }
  const next = argv[flagIndex + 1];
  // A following token is a directory unless it is itself a flag.
  const logDir = next && !next.startsWith("--") ? next : null;
  return { fromLogs: true, logDir };
}

/**
 * Bring the workspace's build output up to date, for spawn mode only.
 *
 * Spawn mode runs each package's `npm run test` and then execs the built CLI to
 * count its commands, and until feature 42's R4 both were kept honest by npm's
 * implicit `pretest` hook rebuilding dist/ first. R4 deleted those hooks — the
 * build order is Turborepo's now — so nothing in this script's own run produced
 * the output it measures. Every number would then describe whatever happened to
 * be on disk: a developer who adds a CLI command and runs this script directly,
 * exactly as CI's failure message tells them to, would commit a cliCommands
 * count one short and be told by CI that their file is out of date.
 *
 * Captured mode does not need this: it reads output a caller already produced
 * after its own build step.
 */
function buildWorkspace() {
  execFileSync("npm", ["run", "build:all"], { cwd: REPO_ROOT, stdio: "inherit" });
}

function main() {
  const capture = parseCaptureMode(process.argv.slice(2));
  const previousStats = readPreviousStats();

  if (!capture.fromLogs) {
    buildWorkspace();
  }

  const packages = collectPackageCounts(capture, previousStats);
  const parserCorpusTests = collectCorpusTestCount(capture, previousStats);
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

/**
 * Runs the Phase 0.5 probe runner's Python test suite as part of the repo's
 * `npm run test:scripts`, so a change to the runner is checked by the
 * pre-commit hook like everything else.
 *
 * The runner lives under `evals/` — Python, deliberately outside the npm
 * workspace and the Turborepo graph (PRD §"Where the code lives"). Its own
 * tests are `unittest`, which needs no dependency beyond python3; this file is
 * the bridge, following the same pattern as `probe-spreadsheets.test.mjs`.
 *
 * Where python3 is absent the suite skips rather than fails, matching the
 * graceful-skip convention the tree-sitter `--wasm` corpus tests use.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(here);
const runnerDir = join(repoRoot, "evals", "phase-0.5-probe", "runner");

/** True when a python3 that can run the suite is on PATH. */
const hasPython3 = (() => {
  try {
    execFileSync("python3", ["-c", "import unittest"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

test("the probe runner's own test suite passes", (t) => {
  if (!hasPython3) {
    t.skip("python3 unavailable");
    return;
  }
  // `-b` buffers the suite's own stdout so a passing run stays quiet; on
  // failure unittest replays it. spawnSync rather than execFileSync because
  // unittest writes its result line to *stderr*, and the assertion below is
  // only useful if the failure text comes with it.
  const result = spawnSync("python3", ["-m", "unittest", "-b"], {
    cwd: runnerDir,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, `probe runner unittest failed:\n${output}`);
  assert.match(output, /\bOK\b/, `probe runner unittest did not report OK:\n${output}`);
});

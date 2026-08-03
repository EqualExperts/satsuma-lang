/**
 * watch-and-test.test.mjs — contract tests for the sentinel watcher.
 *
 * Runs an isolated copy of the watcher with fake process commands. This proves
 * the agent-facing workflow enters through npm (and therefore the pretest build)
 * without launching Playwright or relying on a developer-machine browser.
 */

import { afterEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const WATCHER_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "watch-and-test.sh");
const RESULT_WAIT_TIMEOUT_MS = 5_000;
const RESULT_POLL_INTERVAL_MS = 25;

describe("watch-and-test sentinel workflow", () => {
  const runningWatchers = new Set();
  const temporaryDirectories = new Set();

  afterEach(() => {
    for (const watcher of runningWatchers) watcher.kill("SIGTERM");
    for (const directory of temporaryDirectories)
      rmSync(directory, { recursive: true, force: true });
    runningWatchers.clear();
    temporaryDirectories.clear();
  });

  it("runs npm test so the pretest build output is recorded before Playwright", async () => {
    // Calling npx directly bypasses npm's pretest lifecycle. The fake npm marker
    // represents build output and must be visible to an agent reading the result.
    const run = startWatcher("echo 'fresh build marker'");
    const results = await waitForResults(run.resultsPath, "fresh build marker");

    assert.equal(readFileSync(run.invocationPath, "utf8").trim(), "test -- --timeout=60000");
    assert.match(results, /fresh build marker/);
    assert.match(results, /run passed/);
  });

  it("records a failed build or test run instead of presenting stale results as green", async () => {
    // npm stops before Playwright when pretest fails; the watcher must preserve
    // that output and label the sentinel run as failed for its agent reader.
    const run = startWatcher("echo 'build failure marker'; exit 23");
    const results = await waitForResults(run.resultsPath, "run failed with exit code 23");

    assert.match(results, /build failure marker/);
    assert.match(results, /run failed with exit code 23/);
  });

  /** Start an isolated watcher whose npm executable runs the supplied shell body. */
  function startWatcher(npmBody) {
    const directory = mkdtempSync(join(tmpdir(), "satsuma-viz-watcher-"));
    const binDirectory = join(directory, "bin");
    const watcherPath = join(directory, "watch-and-test.sh");
    const invocationPath = join(directory, "npm-invocation.txt");
    const resultsPath = join(directory, ".playwright-results.txt");
    temporaryDirectories.add(directory);

    writeFileSync(join(directory, ".run-tests"), "");
    copyFileSync(WATCHER_PATH, watcherPath);
    chmodSync(watcherPath, 0o755);

    return createFakeCommandsAndSpawn({
      directory,
      binDirectory,
      invocationPath,
      npmBody,
      watcherPath,
      resultsPath,
    });
  }

  /** Install fake external commands, then start the watcher in its fixture directory. */
  function createFakeCommandsAndSpawn({
    directory,
    binDirectory,
    invocationPath,
    npmBody,
    watcherPath,
    resultsPath,
  }) {
    mkdirSync(binDirectory);
    const npmPath = join(binDirectory, "npm");
    const lsofPath = join(binDirectory, "lsof");
    writeFileSync(
      npmPath,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "${invocationPath}"\n${npmBody}\n`,
    );
    writeFileSync(lsofPath, "#!/usr/bin/env bash\nexit 1\n");
    chmodSync(npmPath, 0o755);
    chmodSync(lsofPath, 0o755);

    const watcher = spawn("bash", [watcherPath], {
      cwd: directory,
      env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` },
      stdio: "ignore",
    });
    runningWatchers.add(watcher);
    return { invocationPath, resultsPath };
  }

  /** Poll until the watcher has atomically appended the expected completion marker. */
  async function waitForResults(resultsPath, marker) {
    const deadline = Date.now() + RESULT_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const results = readFileSync(resultsPath, "utf8");
        if (results.includes(marker)) return results;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, RESULT_POLL_INTERVAL_MS));
    }
    assert.fail(`watcher results did not contain ${JSON.stringify(marker)}`);
  }
});

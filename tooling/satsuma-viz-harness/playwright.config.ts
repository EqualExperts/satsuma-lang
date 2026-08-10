/**
 * playwright.config.ts — Playwright configuration for the Satsuma viz harness.
 *
 * Runs browser-based end-to-end tests against the harness server.  The server
 * is started automatically via webServer and torn down at the end of the run.
 *
 * Chromium is the single target browser. It runs headless both on a developer
 * machine (`npx playwright install chromium` on first use) and inside the agent
 * sandbox, which ships a system Chromium at /usr/bin/chromium. Pinning to one
 * browser keeps the suite reproducible everywhere; the harness exercises the
 * same `satsuma-viz` web component regardless of engine.
 *
 * To run:  npx playwright install chromium   (first time on a dev machine)
 *          npm test                          (subsequent runs, pretest builds deps)
 */

import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/*
 * Chromium executable resolution.
 *
 * Playwright launches its own bundled browser by default, which a developer
 * obtains with `npx playwright install chromium`. The agent sandbox instead
 * ships a system Chromium at /usr/bin/chromium and does not download bundled
 * browsers (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD), so the resolver prefers an
 * explicit override, then that well-known system path, and only falls back to
 * Playwright's bundled browser when neither is present. An env override lets a
 * host point the suite at any Chrome-family binary it provides.
 */
const SYSTEM_CHROMIUM = "/usr/bin/chromium";
const CHROMIUM_EXECUTABLE_PATH =
  process.env.CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined);

/*
 * Chromium refuses to start without --no-sandbox when launched as root, which
 * is how the agent sandbox runs tests. A normal developer machine does not need
 * (and should not carry) it, so gate the flag on the effective uid rather than
 * shipping it unconditionally.
 */
const CHROMIUM_ARGS =
  typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : [];

/** Shared browser launch options: resolved executable plus root-only sandbox flag. */
const CHROMIUM_LAUNCH = {
  executablePath: CHROMIUM_EXECUTABLE_PATH,
  args: CHROMIUM_ARGS,
};

export default defineConfig({
  testDir: "./test",
  /* Maximum time one test can run */
  timeout: 30_000,
  /* Retry on CI, not locally */
  retries: 0,
  /* Reporter: show each test name with status */
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3333",
    /* Capture trace on failure for debugging */
    trace: "on-first-retry",
  },
  projects: [
    {
      // The semantic pass/fail suite — real clicks, real hovers, and
      // data-testid selectors, never pixel comparison. Tracks the rendered
      // `satsuma-viz` component the same way a user would.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: CHROMIUM_LAUNCH },
      // Semantic suite only — *.test.ts. Screenshot review specs live in
      // *.spec.ts and run under the dedicated screenshots project so a
      // contributor can choose to run only one or the other. The static
      // playground suite runs against the OTHER server (port 3334), so it is
      // excluded here and owned by the playground-static project below.
      testMatch: /.*\.test\.ts$/,
      testIgnore: /playground-static/,
    },
    {
      // Screenshot review project — emits the named PNG artifacts plus
      // screenshots/manifest.json described in archive/features/30-viz-test-suite-
      // expansion/PRD.md §"Screenshot artifacts for human and VLM review".
      // Artifacts are review-only, NOT golden baselines (see sl-mm7v).
      name: "screenshots",
      use: { ...devices["Desktop Chrome"], launchOptions: CHROMIUM_LAUNCH },
      testMatch: /.*\.spec\.ts$/,
    },
    {
      // Static playground smoke + privacy project (sl-xq0k): runs against the
      // published server-free bundle served by a dumb file server under the
      // GitHub Pages base path (/satsuma-lang/playground/), proving the bundle
      // itself — not the dev server — loads, seeds, renders, and never lets a
      // request carry source content.
      name: "playground-static",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: CHROMIUM_LAUNCH,
        baseURL: "http://127.0.0.1:3334/satsuma-lang/playground/",
      },
      testMatch: /playground-static\.test\.ts$/,
    },
  ],
  /* Start both servers before tests, shut them down after: the Node harness
   * server (chromium + screenshots projects) and the static playground file
   * server (playground-static project). The latter re-assembles the bundle
   * from the current dist/ first — a fast copy, not a rebuild. The URLs use
   * 127.0.0.1 because the harness server binds that address, while `localhost`
   * may resolve to the IPv6 loopback and trip the health check. */
  webServer: [
    {
      command: "node dist/server.js",
      url: "http://127.0.0.1:3333",
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: "node scripts/build-playground.mjs && node scripts/serve-playground.mjs",
      url: "http://127.0.0.1:3334/satsuma-lang/playground/index.html",
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});

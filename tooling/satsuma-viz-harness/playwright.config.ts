/**
 * playwright.config.ts — Playwright configuration for the Satsuma viz harness.
 *
 * Runs browser-based end-to-end tests against the harness server.  The server
 * is started automatically via webServer and torn down at the end of the run.
 *
 * Playwright execution is a required local developer-machine workflow for
 * Feature 29.  It is intentionally kept out of CI for this feature (see
 * features/29-viz-harness-and-shared-backend/PRD.md).
 *
 * To run:  npx playwright install --with-deps chromium  (first time)
 *          npm test  (subsequent runs)
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  /* Maximum time one test can run */
  timeout: 30_000,
  /* Retry on CI, not locally */
  retries: 0,
  /* Reporter: show each test name with status */
  reporter: "list",
  use: {
    baseURL: "http://localhost:3333",
    /* Capture trace on failure for debugging */
    trace: "on-first-retry",
  },
  projects: [
    {
      // Firefox is used because Chromium headless-shell and WebKit both segfault
      // in SwiftShader on some macOS ARM configurations.  Firefox's headless mode
      // does not depend on SwiftShader and runs reliably in this environment.
      // Both browsers exercise the same satsuma-viz web component code paths;
      // the choice of browser does not affect what the tests validate.
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      // Semantic pass/fail suite only — *.test.ts. Screenshot review specs
      // live in *.spec.ts and run under the dedicated screenshots project so
      // a contributor can choose to run only one or the other. The static
      // playground suite runs against the OTHER server (port 3334), so it is
      // excluded here and owned by the playground-static project below.
      testMatch: /.*\.test\.ts$/,
      testIgnore: /playground-static/,
    },
    {
      // Screenshot review project — emits the named PNG artifacts plus
      // screenshots/manifest.json described in features/30-viz-test-suite-
      // expansion/PRD.md §"Screenshot artifacts for human and VLM review".
      // Artifacts are review-only, NOT golden baselines (see sl-mm7v).
      name: "screenshots",
      use: { ...devices["Desktop Firefox"] },
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
        ...devices["Desktop Firefox"],
        baseURL: "http://localhost:3334/satsuma-lang/playground/",
      },
      testMatch: /playground-static\.test\.ts$/,
    },
  ],
  /* Start both servers before tests, shut them down after: the Node harness
   * server (firefox + screenshots projects) and the static playground file
   * server (playground-static project). The latter re-assembles the bundle
   * from the current dist/ first — a fast copy, not a rebuild. */
  webServer: [
    {
      command: "node dist/server.js",
      url: "http://localhost:3333",
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      command: "node scripts/build-playground.mjs && node scripts/serve-playground.mjs",
      url: "http://localhost:3334/satsuma-lang/playground/index.html",
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});

/**
 * screenshots.spec.ts — deterministic screenshot review workflow.
 *
 * This file is intentionally NOT a pass/fail regression suite. It produces
 * named PNG artifacts plus a manifest entry per shot, so a human reviewer (or
 * a VLM fed the manifest as visual context) can mark up rendering issues and
 * file follow-ups against specific fixtures and UI states.
 *
 * Each test step:
 *   1. loads a real fixture through the harness API,
 *   2. drives the UI into a documented state (overview, detail, filter, …),
 *   3. captures a full-page PNG into ./screenshots/, and
 *   4. appends an entry to ./screenshots/manifest.json describing the fixture,
 *      view mode, UI state, viewport, timestamp, and step name.
 *
 * Output is *intentionally* gitignored (see .gitignore in this package). The
 * screenshots are review artifacts, not golden baselines — semantic pass/fail
 * lives in harness.test.ts. See features/30-viz-test-suite-expansion/PRD.md
 * §"Screenshot artifacts for human and VLM review" and ticket sl-mm7v.
 *
 * Run via the screenshots Playwright project:
 *   npx playwright test --project=screenshots
 * In the agent workflow this runs automatically when you trigger the sentinel
 * watcher (watch-and-test.sh runs all projects).
 */

import { test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------- Output paths ----------

// Screenshots and the manifest are written to a sibling directory of the
// Playwright config so the watcher and contributors can find them in one
// well-known location. The directory is gitignored.
const SCREENSHOT_DIR = join(__dirname, "..", "screenshots");
const MANIFEST_PATH = join(SCREENSHOT_DIR, "manifest.json");

// Single canonical viewport for all review shots. A single size keeps the
// manifest readable and makes side-by-side comparison meaningful. If you need
// a different size for a specific shot, set it on the page in that step and
// record the actual viewport in the manifest entry.
const REVIEW_VIEWPORT = { width: 1440, height: 900 };

// ---------- Manifest ----------

interface ManifestEntry {
  /** Output PNG file name, relative to the screenshots/ directory. */
  file: string;
  /** Fixture path under examples/, as displayed by the harness fixture API. */
  fixture: string;
  /** View mode the harness was in when the shot was taken. */
  viewMode: "single" | "lineage";
  /** Theme the shot was captured in — both are captured for palette sign-off. */
  theme: "light" | "dark";
  /** Free-form description of the UI state captured (overview, detail, filter, …). */
  uiState: string;
  /** Viewport the shot was rendered at. */
  viewport: { width: number; height: number };
  /** ISO-8601 capture time. */
  timestamp: string;
  /** Playwright test step name (used to correlate shots back to this file). */
  step: string;
}

/** Both themes are captured for every named shot (Feature 32 palette sign-off). */
const THEMES = ["light", "dark"] as const;

// In-memory manifest accumulated across all steps in this file. Written to
// disk in afterAll so a partial run still leaves whatever it managed to
// capture, but the file always reflects a single coherent run.
const manifest: ManifestEntry[] = [];

test.beforeAll(() => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test.afterAll(() => {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
});

// ---------- Helpers (mirrors harness.test.ts) ----------

import { libraryUri } from "./harness-env";

// Deterministic virtual library URIs (sl-kd45) — no /api/fixtures round-trip.
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");
const nsPlatformUri = libraryUri("namespaces/ns-platform.stm");
const metricsUri = libraryUri("metrics-platform/metrics.stm");
const reportsUri = libraryUri("reports-and-models/pipeline.stm");
const ffgUri = libraryUri("filter-flatten-governance/filter-flatten-governance.stm");
const sapUri = libraryUri("sap-po-to-mfcs/pipeline.stm");

async function loadFixture(page: Page, fixtureUri: string): Promise<void> {
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${fixtureUri}"]`).click();
  await page.locator("[data-testid='viz-root']").waitFor({ state: "visible" });
  await page
    .locator("[data-testid='viz-root']")
    .waitFor({ state: "visible", timeout: 20_000 });
  // Wait for the layout pipeline to finish before screenshotting — otherwise
  // we capture the loading state instead of the rendered viz.
  await page.waitForFunction(
    () => document.querySelector("[data-testid='viz-root']")?.getAttribute("data-ready-state") === "ready",
    null,
    { timeout: 20_000 },
  );
}

async function setSingleFileMode(page: Page): Promise<void> {
  await page.locator(".toggle-btn[data-mode='single']").click();
}

async function openMapping(page: Page, mappingId: string): Promise<void> {
  await page.locator(`[data-testid='overview-mapping-card-${mappingId}']`).click();
  await page
    .locator(`[data-testid='mapping-detail-${mappingId}']`)
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
}

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector("[data-testid='viz-root']")?.getAttribute("data-ready-state") === "ready",
    null,
    { timeout: 15_000 },
  );
}

/**
 * Capture the current page as a named PNG and append a manifest entry.
 * The caller is responsible for driving the UI into the state being captured.
 */
async function capture(
  page: Page,
  args: {
    file: string;
    fixture: string;
    viewMode: "single" | "lineage";
    theme: "light" | "dark";
    uiState: string;
    step: string;
  },
): Promise<void> {
  const path = join(SCREENSHOT_DIR, args.file);
  await page.screenshot({ path, fullPage: true });
  manifest.push({
    file: args.file,
    fixture: args.fixture,
    viewMode: args.viewMode,
    theme: args.theme,
    uiState: args.uiState,
    viewport: REVIEW_VIEWPORT,
    timestamp: new Date().toISOString(),
    step: args.step,
  });
}

// ---------- Steps ----------
//
// Each test produces exactly one named review artifact from the PRD list.
// Tests are kept independent so a single failure does not block the rest of
// the gallery from being captured.

// Every named shot is captured once per theme. The ?theme= URL parameter
// deterministically selects the palette (see app.ts resolveInitialTheme), and
// the file name + manifest entry carry the theme so a reviewer can line up the
// light and dark versions of each shot side by side.
for (const theme of THEMES) {
  test.describe(`Screenshot review artifacts (${theme})`, () => {
    test.use({ viewport: REVIEW_VIEWPORT });

    test(`sfdc-overview-single-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await setSingleFileMode(page);
      await loadFixture(page, sfdcUri);
      await capture(page, {
        file: `sfdc-overview-single-${theme}.png`,
        fixture: "sfdc-to-snowflake/pipeline.stm",
        viewMode: "single",
        theme,
        uiState: "overview",
        step: `sfdc-overview-single-${theme}`,
      });
    });

    test(`sfdc-detail-opportunity-ingestion-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await setSingleFileMode(page);
      await loadFixture(page, sfdcUri);
      await openMapping(page, "opportunity-ingestion");
      await capture(page, {
        file: `sfdc-detail-opportunity-ingestion-${theme}.png`,
        fixture: "sfdc-to-snowflake/pipeline.stm",
        viewMode: "single",
        theme,
        uiState: "detail:opportunity-ingestion",
        step: `sfdc-detail-opportunity-ingestion-${theme}`,
      });
    });

    test(`namespaces-overview-lineage-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      // Default mode is lineage; ns-platform shows all namespaces in lineage mode.
      await loadFixture(page, nsPlatformUri);
      await capture(page, {
        file: `namespaces-overview-lineage-${theme}.png`,
        fixture: "namespaces/ns-platform.stm",
        viewMode: "lineage",
        theme,
        uiState: "overview:all-namespaces",
        step: `namespaces-overview-lineage-${theme}`,
      });
    });

    test(`namespaces-detail-namespaced-mapping-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await loadFixture(page, nsPlatformUri);
      await openMapping(page, "load-hub-contact");
      await capture(page, {
        file: `namespaces-detail-namespaced-mapping-${theme}.png`,
        fixture: "namespaces/ns-platform.stm",
        viewMode: "lineage",
        theme,
        uiState: "detail:vault::load-hub-contact",
        step: `namespaces-detail-namespaced-mapping-${theme}`,
      });
    });

    test(`metrics-overview-lineage-all-files-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await loadFixture(page, metricsUri);
      await capture(page, {
        file: `metrics-overview-lineage-all-files-${theme}.png`,
        fixture: "metrics-platform/metrics.stm",
        viewMode: "lineage",
        theme,
        uiState: "overview:file-filter=all",
        step: `metrics-overview-lineage-all-files-${theme}`,
      });
    });

    test(`metrics-overview-file-filter-sources-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await loadFixture(page, metricsUri);

      // Drive the file filter to the metric_sources.stm option, mirroring the
      // approach used in the toolbar file-filter test in harness.test.ts.
      const fileFilter = page.locator("[data-testid='toolbar-file-filter']");
      const options = await fileFilter
        .locator("option")
        .evaluateAll((opts) =>
          (opts as HTMLOptionElement[]).map((o) => ({
            value: o.value,
            label: o.textContent,
          })),
        );
      const sourcesOption = options.find((o) => o.label?.includes("metric_sources.stm"));
      if (!sourcesOption) {
        throw new Error(`metric_sources.stm option not found; got ${JSON.stringify(options)}`);
      }
      await fileFilter.selectOption(sourcesOption.value);
      await waitForReady(page);

      await capture(page, {
        file: `metrics-overview-file-filter-sources-${theme}.png`,
        fixture: "metrics-platform/metrics.stm",
        viewMode: "lineage",
        theme,
        uiState: "overview:file-filter=metric_sources.stm",
        step: `metrics-overview-file-filter-sources-${theme}`,
      });
    });

    test(`reports-overview-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await setSingleFileMode(page);
      await loadFixture(page, reportsUri);
      await capture(page, {
        file: `reports-overview-${theme}.png`,
        fixture: "reports-and-models/pipeline.stm",
        viewMode: "single",
        theme,
        uiState: "overview",
        step: `reports-overview-${theme}`,
      });
    });

    test(`filter-flatten-detail-completed-orders-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await setSingleFileMode(page);
      await loadFixture(page, ffgUri);
      await openMapping(page, "completed-orders");
      await capture(page, {
        file: `filter-flatten-detail-completed-orders-${theme}.png`,
        fixture: "filter-flatten-governance/filter-flatten-governance.stm",
        viewMode: "single",
        theme,
        uiState: "detail:completed-orders",
        step: `filter-flatten-detail-completed-orders-${theme}`,
      });
    });

    test(`filter-flatten-detail-order-line-facts-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await setSingleFileMode(page);
      await loadFixture(page, ffgUri);
      await openMapping(page, "order-line-facts");
      await capture(page, {
        file: `filter-flatten-detail-order-line-facts-${theme}.png`,
        fixture: "filter-flatten-governance/filter-flatten-governance.stm",
        viewMode: "single",
        theme,
        uiState: "detail:order-line-facts",
        step: `filter-flatten-detail-order-line-facts-${theme}`,
      });
    });

    test(`sap-po-layout-stability-${theme}`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
      await setSingleFileMode(page);
      await loadFixture(page, sapUri);
      await capture(page, {
        file: `sap-po-layout-stability-${theme}.png`,
        fixture: "sap-po-to-mfcs/pipeline.stm",
        viewMode: "single",
        theme,
        uiState: "overview",
        step: `sap-po-layout-stability-${theme}`,
      });
    });
  });
}

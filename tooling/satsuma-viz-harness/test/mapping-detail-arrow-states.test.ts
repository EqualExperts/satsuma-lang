/**
 * mapping-detail-arrow-states.test.ts — Playwright tests for the two arrow-table
 * states that stand in for absence, painted in a real browser.
 *
 * The rendering decisions themselves are covered as render output in
 * `@satsuma/viz`'s `mapping-detail-arrow-table.test.js`, against minimal model
 * fixtures. What only a browser can answer is whether the states appear at all
 * for the corpus mappings that motivated them, and whether the elements are
 * visible rather than merely present in the shadow tree:
 *
 *  - sl-jetk: `reports-and-models/pipeline.stm`'s consumer mappings are the
 *    documented demonstration of report/model consumers, and every one of them
 *    declares source and target schemas with no field arrows.
 *  - sl-k7i4: `sfdc-to-snowflake/pipeline.stm`'s `-> is_closed { "..." }` is the
 *    corpus's canonical target-only arrow, sitting in a Source column otherwise
 *    full of real field paths — the exact context in which a blank cell read as
 *    a rendering failure.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** Report/model consumers — mappings that declare no field arrows at all. */
const reportsUri = libraryUri("reports-and-models/pipeline.stm");
/** The canonical single-file pipeline, home of the `is_closed` derived arrow. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/**
 * Open the harness in single-file mode, so each fixture renders exactly the
 * mappings its own file declares (lineage mode pulls in imported files too).
 */
async function openHarnessInSingleFileMode(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const harness = window.__satsumaHarness;
    if (!harness?.setViewMode) return false; // app.js not evaluated yet
    harness.setViewMode("single");
    return true;
  });
}

/** Load a fixture through the picker and wait for the viz to report ready. */
async function loadFixture(page: Page, fixtureUri: string): Promise<void> {
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${fixtureUri}"]`).click();
  await page.locator("[data-testid='viz-root']").waitFor({ state: "visible" });
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

/** Open a mapping's detail view by clicking its overview card. */
async function openMapping(page: Page, mappingId: string) {
  await page.locator(`[data-testid='overview-mapping-card-${mappingId}']`).click();
  const detail = page.locator(`[data-testid='mapping-detail-${mappingId}']`).first();
  await expect(detail).toBeVisible({ timeout: 10_000 });
  return detail;
}

test.describe("A consumer mapping with no field arrows (sl-jetk)", () => {
  test("shows the stated empty state instead of a bare column header", async ({ page }) => {
    // `_weekly_sales_dashboard_report` declares two source schemas and one
    // target and nothing else. The panel must explain that, because a header
    // row above an empty body is what a failed load looks like.
    await openHarnessInSingleFileMode(page);
    await loadFixture(page, reportsUri);
    const detail = await openMapping(page, "weekly-sales-dashboard-report");

    const empty = detail.locator("[data-testid$='-arrow-table-empty']");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("no field-level arrows");

    // No table at all — not a table with the empty state tucked underneath it.
    await expect(detail.locator("[data-testid$='-arrow-table']")).toHaveCount(0);
  });

  test("still renders the full arrow table for a mapping that has arrows", async ({ page }) => {
    // The same fixture's `_customer_risk_report_pipeline` does declare arrows,
    // so it proves the empty branch is reached by emptiness and not by the
    // report/model shape in general.
    await openHarnessInSingleFileMode(page);
    await loadFixture(page, reportsUri);
    const detail = await openMapping(page, "customer-risk-report-pipeline");

    await expect(detail.locator("[data-testid$='-arrow-table']")).toBeVisible();
    await expect(detail.locator("[data-testid$='-arrow-table-empty']")).toHaveCount(0);
  });
});

test.describe("A sourceless derived arrow's Source cell (sl-k7i4)", () => {
  test("renders a visible derived marker where the source path would be", async ({ page }) => {
    // The marker must be painted inside the row for `is_closed`, in the Source
    // column, alongside rows that do carry real paths — the mixed column is the
    // whole reason a blank cell was unreadable.
    await openHarnessInSingleFileMode(page);
    await loadFixture(page, sfdcUri);
    const detail = await openMapping(page, "opportunity-ingestion");

    // Row test ids are `mapping-detail-{mappingId}-arrow-row-{targetField}`; the
    // marker hangs off its row's id (see _renderArrowRow).
    const marker = detail.locator(
      "[data-testid='mapping-detail-opportunity-ingestion-arrow-row-is-closed-source-derived']",
    );
    await expect(marker).toBeVisible();
    await expect(marker).toHaveText("derived");

    // The neighbouring rows are unchanged: a real source path still renders as
    // a field path, so the marker is a substitute for absence only.
    await expect(
      detail
        .locator(
          "[data-testid='mapping-detail-opportunity-ingestion-arrow-row-amount-usd'] .field-ref",
        )
        .first(),
    ).toBeVisible();

    // Distinguishable from a field path by more than its text: the marker is
    // deliberately not a `.field-ref`, so it cannot be read as a field named
    // "derived" and never picks up the highlight styling for real paths.
    const isFieldRef = await marker.evaluate((el) => el.classList.contains("field-ref"));
    expect(isFieldRef).toBe(false);
  });
});

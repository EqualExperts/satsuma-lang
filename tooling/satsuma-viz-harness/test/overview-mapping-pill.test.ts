/**
 * overview-mapping-pill.test.ts — an overview mapping pill paints its whole
 * label: icon, name and "N →s" arrow count, all inside the pill.
 *
 * The layout sizes each pill from an estimate of its label, and the renderer
 * pins the card to exactly that node width (edge anchors depend on it). The
 * estimate used to measure the name alone, with a char width too narrow for
 * the 13px/600 font, so a long name such as CustomerRecordToMailingList pushed
 * the count out past the pill's right edge. Only a rendered browser can see
 * this: the unit tests prove the estimate grows with the count, not that the
 * painted text fits the painted box.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** Many long mapping names (e.g. _monthly_recurring_revenue_pipeline). */
const metricsUri = libraryUri("metrics-platform/metrics.stm");

/** Sub-pixel slack between DOM boxes measured on the same layer. */
const TOLERANCE_PX = 1;

async function loadFixture(page: Page, fixtureUri: string): Promise<void> {
  await page.goto("/");
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${fixtureUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

test("every overview mapping pill shows its full name and arrow count inside the pill", async ({
  page,
}) => {
  await loadFixture(page, metricsUri);

  const pills = page.locator("[data-testid^='overview-mapping-card-']");
  await expect(pills.first()).toBeVisible();
  const count = await pills.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const pill = pills.nth(i);
    const id = await pill.getAttribute("title");
    const pillBox = await pill.boundingBox();
    const countBox = await pill.locator(".overview-mapping-count").boundingBox();
    if (!pillBox || !countBox) throw new Error(`pill ${id} has no rendered box or arrow count`);

    // The count must sit wholly inside the pill, not spill past its edge.
    expect(
      countBox.x + countBox.width,
      `arrow count of ${id} overflows the pill's right edge`,
    ).toBeLessThanOrEqual(pillBox.x + pillBox.width + TOLERANCE_PX);

    // Under the width cap the name must not be truncated either: the node
    // is meant to be sized for the whole label, not to rely on the ellipsis.
    const nameTruncated = await pill
      .locator(".overview-mapping-name")
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(nameTruncated, `name of ${id} is truncated`).toBe(false);
  }
});

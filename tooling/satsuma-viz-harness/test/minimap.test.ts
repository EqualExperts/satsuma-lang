/**
 * minimap.test.ts — the minimap is visible and shows the right objects (fmo-fghl).
 *
 * Two regressions are pinned here:
 *   1. Consumer pages style the <satsuma-viz> host element directly
 *      (`satsuma-viz { display: block }`), which overrides :host{display:flex}
 *      and used to collapse the flex chain that clamps .viewport to the
 *      visible panel. With tall content the bottom-anchored minimap was
 *      pushed below the clipped fold — invisible in overview mode.
 *   2. The mapping detail view fed the minimap the full-canvas ELK layout
 *      (all schemas in the file) instead of the rendered detail content, so
 *      its objects mirrored the overview rather than the open mapping.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** Any loadable fixture works as a starting buffer; sfdc is self-contained. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/** One source/target schema pair plus the mapping between them. */
function pair(n: number): string {
  return [
    `schema src_${n} {`,
    "  Id    ID          (pk)",
    "  Name  STRING(120)",
    "}",
    "",
    `schema tgt_${n} {`,
    "  key   VARCHAR(18)  (pk)",
    "  name  VARCHAR(120)",
    "}",
    "",
    `mapping load_${n} {`,
    `  source { src_${n} }`,
    `  target { tgt_${n} }`,
    "",
    "  Id -> key",
    "  Name -> name",
    "}",
    "",
  ].join("\n");
}

/** A document whose overview canvas is far taller than the browser window. */
function tallDoc(pairs: number): string {
  return Array.from({ length: pairs }, (_, i) => pair(i + 1)).join("\n");
}

/** Open the harness in single-file mode and replace the buffer with `text`. */
async function openWithBuffer(page: Page, text: string): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const harness = window.__satsumaHarness;
    if (!harness?.setViewMode) return false; // app.js not evaluated yet
    harness.setViewMode("single");
    return true;
  });
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${sfdcUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
  await page.locator("#source-input").fill(text);
  await expect(
    page.locator("[data-testid='overview-mapping-card-load-1']"),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("Minimap visibility and contents", () => {
  test("overview minimap stays inside the visible panel even when content is tall", async ({
    page,
  }) => {
    // Enough schema pairs that the overview canvas is several screens tall.
    // Pre-fix the viewport grew to content height and the bottom-anchored
    // minimap sat thousands of px below the fold, clipped by the host.
    await openWithBuffer(page, tallDoc(12));

    const minimap = page.locator("[data-testid='viz-minimap']");
    await expect(minimap).toBeVisible();
    await expect(minimap).toBeInViewport();
  });

  test("mapping detail minimap shows the detail content, not the file canvas", async ({
    page,
  }) => {
    await openWithBuffer(page, tallDoc(1));

    // dispatchEvent rather than a pointer click: opening the mapping is the
    // precondition here, not the subject (see view-persistence.test.ts).
    await page
      .locator("[data-testid='overview-mapping-card-load-1']")
      .dispatchEvent("click");
    await expect(
      page.locator("[data-testid='mapping-detail-load-1']").first(),
    ).toBeVisible({ timeout: 10_000 });

    const minimap = page.locator("[data-testid='viz-minimap']");
    await expect(minimap).toBeVisible({ timeout: 10_000 });
    await expect(minimap).toBeInViewport();

    // The detail view renders one source schema card, the mapping header,
    // the arrow table, and one target schema card → exactly 4 minimap rects.
    // The old bug drew the full-canvas layout instead: 2 rects (one per
    // schema in the file), mirroring the overview.
    await expect(minimap.locator("rect")).toHaveCount(4, { timeout: 10_000 });
  });
});

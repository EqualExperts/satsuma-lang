/**
 * view-persistence.test.ts — the mapping detail view survives live edits (sl-2ksz).
 *
 * Live editing replaces the viz model on every debounced keystroke. Before the
 * fix, <satsuma-viz> reset itself to the overview whenever its model property
 * changed, so a user inspecting a mapping detail was kicked back to the
 * overview after every edit. These tests pin the contract:
 *   1. An edit that keeps the selected mapping (same namespace + name)
 *      re-renders the detail view in place with the new model's content.
 *   2. An edit that renames the mapping falls back gracefully to the overview.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** Any loadable fixture works as a starting buffer; sfdc is self-contained. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/** Build a small two-schema document with one mapping named `mappingName`.
 *  `extraSourceField` lets an edit grow the source schema without touching
 *  the mapping — the change a user makes while studying a mapping detail. */
function doc(mappingName: string, extraSourceField = ""): string {
  return [
    "schema src_orders {",
    "  Id    ID          (pk)",
    "  Name  STRING(120)",
    ...(extraSourceField ? [`  ${extraSourceField}`] : []),
    "}",
    "",
    "schema tgt_orders {",
    "  order_key   VARCHAR(18)  (pk)",
    "  order_name  VARCHAR(120)",
    "}",
    "",
    `mapping ${mappingName} {`,
    "  source { src_orders }",
    "  target { tgt_orders }",
    "",
    "  Id -> order_key",
    "  Name -> order_name",
    "}",
    "",
  ].join("\n");
}

/** Open the harness in single-file mode and replace the buffer with `text`. */
async function openWithBuffer(page: Page, text: string): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => window.__satsumaHarness.setViewMode?.("single"));
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${sfdcUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
  await page.locator("#source-input").fill(text);
  // The one-mapping overview card proves the buffer replaced the fixture model.
  await expect(
    page.locator("[data-testid='overview-mapping-card-orders-load']"),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("Detail view persistence across live edits", () => {
  test("an edit that keeps the mapping re-renders the detail view in place", async ({
    page,
  }) => {
    await openWithBuffer(page, doc("orders_load"));

    // dispatchEvent rather than a pointer click: the tiny two-schema graph
    // sits partly under the minimap overlay, which intercepts real pointer
    // events. Opening the mapping is the precondition here, not the subject.
    await page
      .locator("[data-testid='overview-mapping-card-orders-load']")
      .dispatchEvent("click");
    const detail = page.locator("[data-testid='mapping-detail-orders-load']").first();
    await expect(detail).toBeVisible({ timeout: 10_000 });

    // Edit: add a field to the source schema, mapping untouched. The detail
    // view must stay open AND show the new model's content (the fresh field),
    // proving the selection re-bound to the rebuilt mapping rather than the
    // old view merely lingering unrendered.
    await page.locator("#source-input").fill(doc("orders_load", "Status  STRING(20)"));

    await expect(detail).toContainText("Status", { timeout: 10_000 });
    await expect(detail).toBeVisible();
    await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
      "data-view-mode",
      "detail",
    );
  });

  test("an edit that renames the mapping falls back to the overview", async ({ page }) => {
    await openWithBuffer(page, doc("orders_load"));

    // See above: dispatchEvent avoids minimap pointer interception.
    await page
      .locator("[data-testid='overview-mapping-card-orders-load']")
      .dispatchEvent("click");
    await expect(
      page.locator("[data-testid='mapping-detail-orders-load']").first(),
    ).toBeVisible({ timeout: 10_000 });

    // Renaming the mapping deletes the selected one; the only sensible place
    // for the user is back at the overview, now showing the renamed mapping.
    await page.locator("#source-input").fill(doc("orders_load_v2"));

    await expect(
      page.locator("[data-testid='overview-mapping-card-orders-load-v2']"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-testid^='mapping-detail-']")).toHaveCount(0);
    await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
      "data-view-mode",
      "overview",
    );
  });
});

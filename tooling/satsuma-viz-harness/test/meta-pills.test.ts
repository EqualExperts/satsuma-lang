/**
 * meta-pills.test.ts — metadata pills stack vertically and never widen the
 * card (sl-dw9x).
 *
 * xml-to-parquet's `commerce_order` schema carries `format xml` plus two
 * `namespace http://…` values. In the original layout those pills sat in one
 * nowrap row that SET the card's intrinsic width, rendering the card several
 * times wider than its field list with dead white space below
 * (meta-pill-wasted-space.jpg in features/34-live-editor-ux). The contract
 * now: one pill per row, the card's width is field/header-driven, and an
 * overlong value truncates inside the card with the full text in a tooltip.
 *
 * The truncation case is forced through the live editor: lengthening a
 * namespace URI in the buffer must leave the open detail card's width
 * untouched (the old bug grew the card with the value).
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

const xmlToParquetUri = libraryUri("xml-to-parquet/pipeline.stm");

/** The namespace URI as written in the fixture, and a much longer variant. */
const ORIGINAL_URI = "http://example.com/commerce/order/v2";
const LONG_URI_SUFFIX = "/with/many/extra/path/segments/that/no/card/should/ever/grow/to/fit";

async function openOrderLinesDetail(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${xmlToParquetUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
  // dispatchEvent: overview cards can sit under the minimap overlay.
  await page
    .locator("[data-testid='overview-mapping-card-order-lines']")
    .dispatchEvent("click");
  await expect(
    page.locator("[data-testid='mapping-detail-order-lines']").first(),
  ).toBeVisible({ timeout: 10_000 });
}

function sourceCard(page: Page) {
  return page
    .locator("[data-testid^='mapping-detail-order-lines-source-schema-card-commerce-order']")
    .first();
}

test("pills stack one per row inside the card, with tooltips", async ({ page }) => {
  await openOrderLinesDetail(page);

  const card = sourceCard(page);
  await expect(card).toBeVisible();
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("source card not rendered");

  const pills = card.locator(".meta-pill");
  const pillCount = await pills.count();
  expect(pillCount).toBeGreaterThanOrEqual(3); // format + two namespaces

  let lastBottom = -Infinity;
  for (let i = 0; i < pillCount; i++) {
    const box = await pills.nth(i).boundingBox();
    if (!box) throw new Error(`pill ${i} not rendered`);

    // One pill per row: each pill starts below the previous one.
    expect(box.y, `pill ${i} must be on its own row`).toBeGreaterThanOrEqual(lastBottom);
    lastBottom = box.y + box.height;

    // Every pill fits inside the card horizontally.
    expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);

    // The full value survives in the tooltip even when truncated on screen.
    expect(await pills.nth(i).getAttribute("title")).toBeTruthy();
  }
});

test("lengthening a namespace URI truncates the pill instead of widening the card", async ({
  page,
}) => {
  await openOrderLinesDetail(page);

  const card = sourceCard(page);
  const before = await card.boundingBox();
  if (!before) throw new Error("source card not rendered");

  // Live-edit the buffer: make the namespace URI absurdly long. The detail
  // view survives the rebuild (sl-2ksz), so the same card re-renders in place.
  const buffer = await page.locator("#source-input").inputValue();
  expect(buffer).toContain(ORIGINAL_URI);
  await page
    .locator("#source-input")
    .fill(buffer.replace(ORIGINAL_URI, ORIGINAL_URI + LONG_URI_SUFFIX));

  // The rebuilt pill carries the full long URI in its tooltip…
  const longPill = card.locator(`.meta-pill[title*="${LONG_URI_SUFFIX}"]`);
  await expect(longPill).toBeVisible({ timeout: 10_000 });

  // …is genuinely truncated on screen (its content overflows its box)…
  const overflow = await longPill.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "the long URI must overflow the pill, not stretch it").toBeGreaterThan(10);

  // …and the card kept its field-driven width. The original bug grew the
  // card by the full length of the value.
  const after = await card.boundingBox();
  if (!after) throw new Error("source card vanished after edit");
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
});

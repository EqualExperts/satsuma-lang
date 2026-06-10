/**
 * mapping-field-meta.test.ts — all authored metadata is visible in the
 * detail view (sl-6x1o).
 *
 * Two classes of metadata used to vanish silently:
 *
 *   1. Meta on the mapping declaration itself — `mapping m (merge upsert,
 *      match_on customer_id)` — never reached the model, so the central
 *      mapping header showed only source/target/join/filter.
 *   2. Field-level key-value meta that is not a recognised constraint tag —
 *      `classification "CONFIDENTIAL"`, `mask redact` — was dropped by the
 *      CONSTRAINT_TAGS whitelist, so governance annotations were invisible.
 *
 * merge-strategies carries mapping-level meta; governance.stm carries field
 * kv meta. Both must render.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

const mergeStrategiesUri = libraryUri("merge-strategies/pipeline.stm");
const governanceUri = libraryUri("filter-flatten-governance/governance.stm");

/** Load a fixture and open the named mapping's detail view. */
async function openMappingDetail(
  page: Page,
  fixtureUri: string,
  mappingTestId: string,
): Promise<void> {
  await page.goto("/");
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${fixtureUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
  // dispatchEvent: overview cards can sit under the minimap overlay.
  await page
    .locator(`[data-testid='overview-mapping-card-${mappingTestId}']`)
    .dispatchEvent("click");
  await expect(
    page.locator(`[data-testid='mapping-detail-${mappingTestId}']`).first(),
  ).toBeVisible({ timeout: 10_000 });
}

test("mapping-level metadata renders in the detail header", async ({ page }) => {
  // `customer upsert` is declared as (merge upsert, match_on customer_id):
  // both entries must appear in the central mapping block's header alongside
  // the source/target rows.
  await openMappingDetail(page, mergeStrategiesUri, "customer-upsert");

  const header = page.locator("[data-testid='mapping-detail-customer-upsert-header']");
  await expect(
    header.locator("[data-testid='mapping-detail-customer-upsert-meta-merge']"),
  ).toContainText("merge upsert");
  await expect(
    header.locator("[data-testid='mapping-detail-customer-upsert-meta-match-on']"),
  ).toContainText("match_on customer_id");
});

test("non-constraint field metadata renders as pills on the field row", async ({ page }) => {
  // crm_customers.first_name is (pii, classification "CONFIDENTIAL",
  // mask redact): pii stays a constraint badge, and the two kv entries must
  // appear as key+value pills instead of being silently dropped.
  await openMappingDetail(page, governanceUri, "customer-360-assembly");

  const fieldRow = page
    .locator("[data-testid$='-field-first-name']")
    .first();
  await expect(fieldRow).toBeVisible();

  const pills = fieldRow.locator(".badge.field-meta");
  await expect(pills.filter({ hasText: "classification" })).toContainText("CONFIDENTIAL");
  await expect(pills.filter({ hasText: "mask" })).toContainText("redact");

  // The pii shield badge must be unaffected by the new pills.
  await expect(fieldRow.locator(".badge.pii")).toBeVisible();
});

/**
 * card-annotations.test.ts — a schema's `note` and a field's `//!` / `//?`
 * comments are visible on the cards a reader actually sees.
 *
 * Two separate gaps hid them. The compact overview card filtered `note` out
 * of its metadata pills and never rendered the notes section the full card
 * has, so a schema note appeared in the mapping view but not the overview.
 * And field comments never reached the model at all: the backend looked
 * trailing comments up with `indexOf` on a fresh `.children` array, which
 * never matches a web-tree-sitter node, so neither view drew a badge. The
 * unit tests pin the model and the layout estimate; only a rendered card
 * proves the note text and the badges are painted.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** sfdc_opportunity carries `note "SFDC Opportunity Object"` and a //! on ARR_Override__c. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");
const SCHEMA_NOTE = "SFDC Opportunity Object";
const COMMENTED_FIELD = "ARR_Override__c";
const FIELD_WARNING = "manual override used by Finance";

async function loadSfdc(page: Page): Promise<void> {
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
}

/** The field row for `name` inside a schema card. */
function fieldRow(card: ReturnType<Page["locator"]>, name: string) {
  return card.locator(".field-row").filter({
    has: card.page().locator(".field-name", { hasText: name }),
  });
}

test("the overview card shows the schema's note text without a click", async ({ page }) => {
  await loadSfdc(page);
  const card = page.locator("sz-schema-card[data-testid='overview-schema-card-sfdc-opportunity']");
  await expect(card.locator(".note-content")).toHaveText(SCHEMA_NOTE);
});

test("an expanded overview card badges a field's //! comment", async ({ page }) => {
  await loadSfdc(page);
  const card = page.locator("sz-schema-card[data-testid='overview-schema-card-sfdc-opportunity']");
  await card.locator(".header-toggle").click();
  const badge = fieldRow(card, COMMENTED_FIELD).locator(".comment-badge.warning");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("title", new RegExp(FIELD_WARNING));
});

test("the mapping view's source card badges a field's //! comment", async ({ page }) => {
  await loadSfdc(page);
  await page.locator("[data-testid='overview-mapping-card-opportunity-ingestion']").click();
  const card = page.locator(
    "[data-testid='mapping-detail-opportunity-ingestion-source-schema-card-sfdc-opportunity']",
  );
  await expect(card).toBeVisible({ timeout: 10_000 });
  const badge = fieldRow(card, COMMENTED_FIELD).locator(".comment-badge.warning");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute("title", new RegExp(FIELD_WARNING));
});

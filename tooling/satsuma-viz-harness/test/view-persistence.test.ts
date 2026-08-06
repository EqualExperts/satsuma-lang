/**
 * view-persistence.test.ts — the mapping detail view survives live edits (sl-2ksz),
 * and the chain view does too (sl-nswc, PRD 36 R4's Feature-34-R1 guarantee).
 *
 * Live editing replaces the viz model on every debounced keystroke. Before the
 * fix, <satsuma-viz> reset itself to the overview whenever its model property
 * changed, so a user inspecting a mapping detail was kicked back to the
 * overview after every edit. These tests pin the contract:
 *   1. An edit that keeps the selected mapping (same namespace + name)
 *      re-renders the detail view in place with the new model's content.
 *   2. An edit that renames the mapping falls back gracefully to the overview.
 *
 * The chain view's equivalent guarantee (_reconcileViewState in
 * satsuma-viz.ts, "Feature 34 R1" cited by name) works differently: a
 * FieldChainModel isn't reconstructible from a VizModel alone, so instead of
 * rebinding locally the component re-dispatches the same "field-lineage"
 * event the original entry point used, asking the host to retrace against
 * the fresh model. That only round-trips through a real host — the harness's
 * own app.ts wiring added alongside this suite (buildFieldChain ->
 * openFieldChain) — so only a real browser proves the retrace actually
 * happens, not just that the event was re-dispatched (which sz-chain-view's
 * own unit tests already prove at the component level).
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
  // The one-mapping overview card proves the buffer replaced the fixture model.
  await expect(page.locator("[data-testid='overview-mapping-card-orders-load']")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Detail view persistence across live edits", () => {
  test("an edit that keeps the mapping re-renders the detail view in place", async ({ page }) => {
    await openWithBuffer(page, doc("orders_load"));

    // dispatchEvent rather than a pointer click: the tiny two-schema graph
    // sits partly under the minimap overlay, which intercepts real pointer
    // events. Opening the mapping is the precondition here, not the subject.
    await page.locator("[data-testid='overview-mapping-card-orders-load']").dispatchEvent("click");
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
    await page.locator("[data-testid='overview-mapping-card-orders-load']").dispatchEvent("click");
    await expect(page.locator("[data-testid='mapping-detail-orders-load']").first()).toBeVisible({
      timeout: 10_000,
    });

    // Renaming the mapping deletes the selected one; the only sensible place
    // for the user is back at the overview, now showing the renamed mapping.
    await page.locator("#source-input").fill(doc("orders_load_v2"));

    await expect(page.locator("[data-testid='overview-mapping-card-orders-load-v2']")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("[data-testid^='mapping-detail-']")).toHaveCount(0);
    await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
      "data-view-mode",
      "overview",
    );
  });
});

/**
 * Three schemas, two mappings, one traceable field (stg_customers.email):
 * upstream to raw_customers.email, downstream to dim_customers.email.
 * `emailTransform` lets an edit change the upstream arrow's classification
 * without touching the chain's shape — the smallest edit that still proves a
 * fresh trace happened, rather than a stale chain merely lingering onscreen.
 */
function chainDoc(emailTransform = "", emailFieldName = "email"): string {
  return [
    "schema raw_customers {",
    "  id     ID           (pk)",
    "  email  STRING(120)",
    "}",
    "",
    "schema stg_customers {",
    "  id             VARCHAR(20)   (pk)",
    `  ${emailFieldName}  VARCHAR(120)`,
    "}",
    "",
    "schema dim_customers {",
    "  customer_key  VARCHAR(20)   (pk)",
    "  email         VARCHAR(120)",
    "}",
    "",
    "mapping stage_customers {",
    "  source { raw_customers }",
    "  target { stg_customers }",
    "",
    "  id -> id",
    `  email -> ${emailFieldName}${emailTransform}`,
    "}",
    "",
    "mapping load_dim_customers {",
    "  source { stg_customers }",
    "  target { dim_customers }",
    "",
    "  id -> customer_key",
    `  ${emailFieldName} -> email`,
    "}",
    "",
  ].join("\n");
}

test.describe("Chain view persistence across live edits", () => {
  /** Open the harness in single-file mode, load a starting buffer, then replace it with `text`. */
  async function openWithChainBuffer(page: Page, text: string): Promise<void> {
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
    await expect(page.locator("[data-testid='overview-schema-card-stg-customers']")).toBeVisible({
      timeout: 10_000,
    });
  }

  /** Expand stg_customers' compact card and click its email field's lineage icon. */
  async function openEmailChain(page: Page): Promise<void> {
    const card = page.locator("sz-schema-card[data-testid^='overview-schema-card-stg-customers']");
    await card.locator(".header-toggle").click();
    // This fixture's small three-schema graph can leave the just-expanded
    // card's field row outside the SVG canvas's current pan/zoom viewBox — a
    // transform Playwright's DOM-level "scroll into view" cannot follow
    // (sv-embb, caught flaking on this exact interaction). Re-fit first,
    // exactly as a human would with the toolbar's own button.
    await page.locator("[data-testid='toolbar-fit']").click();
    await page
      .locator("[data-testid='overview-schema-card-stg-customers-field-email-lineage']")
      .click({ force: true });
    await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
      "data-view-mode",
      "chain",
      { timeout: 10_000 },
    );
  }

  test("an edit that keeps the chain's focus field re-traces against the new model", async ({
    page,
  }) => {
    await openWithChainBuffer(page, chainDoc());
    await openEmailChain(page);

    const upstreamHop = page.locator("[data-testid^='chain-hop-upstream-1-raw-customers-email']");
    await expect(upstreamHop).toHaveAttribute("data-classification", "none");

    // Add a transform to the upstream arrow — the focus field (stg_customers.email)
    // is untouched, but the retrace must pick up the new classification, proving
    // the host actually re-traced against the fresh model rather than the stale
    // chain merely staying onscreen.
    await page.locator("#source-input").fill(chainDoc(" { trim }"));

    await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
      "data-view-mode",
      "chain",
    );
    await expect(page.locator("[data-testid='chain-focus']")).toContainText("stg_customers");
    await expect(upstreamHop).toHaveAttribute("data-classification", "nl", { timeout: 10_000 });
  });

  test("an edit that removes the chain's focus field falls back to the overview", async ({
    page,
  }) => {
    await openWithChainBuffer(page, chainDoc());
    await openEmailChain(page);

    // Renaming stg_customers.email deletes the field the chain is focused on
    // (its schema survives, its path does not) — _chainFieldStillExists must
    // say no, and the component must fall back rather than render a stale or
    // broken trace.
    await page.locator("#source-input").fill(chainDoc("", "email_address"));

    await expect(
      page.locator("[data-testid='overview-schema-card-stg-customers-field-email-address']"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
      "data-view-mode",
      "overview",
    );
    await expect(page.locator("[data-testid='chain-view']")).toHaveCount(0);
  });
});

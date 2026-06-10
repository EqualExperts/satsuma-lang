/**
 * collapse.test.ts — Playwright tests for the collapsible source pane (sl-1qte).
 *
 * These validate the three properties of the collapse/expand toggle:
 *   1. Collapsing hands the source pane's width to the viz — a geometry
 *      assertion that the <satsuma-viz> host widens by the reclaimed column
 *      (reflow via the grid column change, not an overlay on top of the viz).
 *   2. Re-expanding restores the editor and returns the viz to its prior width.
 *   3. The collapsed/expanded state survives a reload via localStorage.
 *
 * The pane collapses to a thin re-expand rail (#editor-expand-rail); the source
 * editor and its toolbar are display:none while collapsed, so the rail is the
 * only way back — it must be visible and clickable in the collapsed state.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** A self-contained single-file pipeline; any rendered fixture works here. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/** Open the harness with a fixture rendered, so the viz host has real content. */
async function openWithFixture(page: Page): Promise<void> {
  await page.goto(`/?fixture=${encodeURIComponent(sfdcUri)}`);
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

/** Measure the on-screen width of the viz host element. */
async function vizWidth(page: Page): Promise<number> {
  const box = await page.locator("[data-testid='viz-root']").boundingBox();
  if (!box) throw new Error("viz-root not rendered");
  return box.width;
}

// The source column is half the window (640px at Playwright's default 1280px
// viewport) and the collapsed rail 26px (index.html :root variables), so a
// genuine reflow reclaims ~614px. Asserting against a conservative lower bound
// keeps the test robust to minor style tweaks while still failing hard if the
// pane merely overlays the viz (delta ≈ 0).
const MIN_RECLAIMED_WIDTH = 300;

test.describe("Collapsible source pane", () => {
  test("collapsing reflows the viz to the reclaimed width and re-expanding restores it", async ({
    page,
  }) => {
    await openWithFixture(page);
    const expandedWidth = await vizWidth(page);

    // Collapse: the editor disappears, the rail appears, and the viz host must
    // genuinely widen by the surrendered column (geometry, not overlay).
    await page.locator("#editor-collapse-btn").click();
    await expect(page.locator("#source-editor")).toBeHidden();
    await expect(page.locator("#editor-expand-rail")).toBeVisible();
    expect(await vizWidth(page)).toBeGreaterThan(expandedWidth + MIN_RECLAIMED_WIDTH);

    // The automation contract mirrors the state and records the toggle.
    expect(
      await page.evaluate(() => window.__satsumaHarness.editorCollapsed),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        window.__satsumaHarness.events.filter((e) => e.type === "editor-collapse"),
      ),
    ).toEqual([expect.objectContaining({ detail: { collapsed: true } })]);

    // Expand via the rail: the editor returns and the viz gives the width back.
    await page.locator("#editor-expand-rail").click();
    await expect(page.locator("#source-editor")).toBeVisible();
    await expect(page.locator("#editor-expand-rail")).toBeHidden();
    expect(await vizWidth(page)).toBeCloseTo(expandedWidth, 0);
    expect(
      await page.evaluate(() => window.__satsumaHarness.editorCollapsed),
    ).toBe(false);
  });

  test("the collapsed state survives a reload via localStorage", async ({ page }) => {
    await openWithFixture(page);
    await page.locator("#editor-collapse-btn").click();
    await expect(page.locator("#editor-expand-rail")).toBeVisible();

    // A fresh page load must come back collapsed — the preference is persisted,
    // not session state, so it outlives the document/buffer restore path.
    await page.reload();
    await expect(page.locator("#editor-expand-rail")).toBeVisible();
    await expect(page.locator("#source-editor")).toBeHidden();
    expect(
      await page.evaluate(() => window.__satsumaHarness.editorCollapsed),
    ).toBe(true);

    // And it is symmetric: expanding then reloading comes back expanded.
    await page.locator("#editor-expand-rail").click();
    await page.reload();
    await expect(page.locator("#source-editor")).toBeVisible();
    expect(
      await page.evaluate(() => window.__satsumaHarness.editorCollapsed),
    ).toBe(false);
  });
});

test.describe("Collapse affordance discoverability (sl-i0db)", () => {
  // The Feature 34 review flagged the original bare ◀ glyph as "useless —
  // more obvious hint needed". Both directions must now say what they do in
  // words, and stay keyboard-operable with accessible names.
  test("both directions are labelled in words and carry accessible names", async ({
    page,
  }) => {
    await openWithFixture(page);

    const collapseBtn = page.locator("#editor-collapse-btn");
    await expect(collapseBtn).toHaveText(/Hide source/);
    await expect(collapseBtn).toHaveAttribute("aria-label", "Hide the source pane");

    await collapseBtn.click();
    const rail = page.locator("#editor-expand-rail");
    await expect(rail).toBeVisible();
    await expect(rail).toHaveText(/Show source/);
    await expect(rail).toHaveAttribute("aria-label", "Show the source pane");
  });

  test("collapse and re-expand work with the keyboard alone", async ({ page }) => {
    await openWithFixture(page);

    // Focus + Enter on the collapse handle, then on the rail: both are real
    // <button>s, so activation must not depend on a pointer.
    await page.locator("#editor-collapse-btn").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#editor-expand-rail")).toBeVisible();

    await page.locator("#editor-expand-rail").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#editor-expand-rail")).toBeHidden();
    await expect(page.locator("#source-input")).toBeVisible();
  });
});

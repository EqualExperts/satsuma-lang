/**
 * chrome.test.ts — public playground chrome (sl-ohxn, sl-7pdf).
 *
 * The playground is a public product surface, not an internal test rig. These
 * tests pin the Feature 34 chrome decisions: the header is the Satsuma brand
 * (logo + wordmark) with no internal toggles or status badges, and Export SVG
 * downloads a real, self-contained artifact entirely client-side.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

const buyToOmUri = libraryUri("contracts/buy-to-om-order.stm");

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

test.describe("Branded header (sl-ohxn)", () => {
  test("the header is the Satsuma logo + wordmark, with no internal chrome", async ({
    page,
  }) => {
    await page.goto("/");

    // Logo must actually load (a broken image still occupies layout space).
    const logo = page.locator("#header-logo");
    await expect(logo).toBeVisible();
    expect(
      await logo.evaluate((img) => (img as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);

    // Wordmark is exactly "Satsuma" — no "viz harness" suffix.
    await expect(page.locator("#header h1")).toHaveText(/^\s*Satsuma\s*$/);

    // The internal lineage/single toggle and the ready badge are gone; the
    // theme toggle and the local-only privacy note both stay.
    await expect(page.locator("#view-mode-toggle")).toHaveCount(0);
    await expect(page.locator("#harness-ready-badge")).toHaveCount(0);
    await expect(page.locator("#theme-toggle")).toBeVisible();
    await expect(page.locator("#privacy-note")).toBeVisible();
  });

  test("lineage is the default view mode without a visible toggle", async ({ page }) => {
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => window.__satsumaHarness?.viewMode))
      .toBe("lineage");
  });
});

test.describe("Export SVG (sl-7pdf)", () => {
  test("the toolbar button says what it does and downloads a self-contained SVG", async ({
    page,
  }) => {
    await loadFixture(page, buyToOmUri);

    const exportBtn = page.locator("[data-testid='toolbar-export']");
    await expect(exportBtn).toHaveText(/Export SVG/);

    // Clicking must produce a real artifact, client-side (nothing leaves the
    // browser): a .svg download whose content is standalone — well-formed and
    // with every var(--sz-*) theme token already inlined to a literal colour.
    const downloadPromise = page.waitForEvent("download");
    await exportBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.svg$/);

    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("<svg");
    expect(content).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(content).not.toContain("var(");
  });
});

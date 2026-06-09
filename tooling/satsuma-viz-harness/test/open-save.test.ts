/**
 * open-save.test.ts — Playwright tests for client-only Open / Save (sl-nopd).
 *
 * These validate the playground's privacy contract for local files:
 *   1. Open reads a chosen .stm entirely in the browser — the text replaces
 *      the editor buffer, the filename becomes the document label, the viz
 *      re-renders from it, and NO network request fires during the action
 *      (file content is never uploaded).
 *   2. The opened file lands in the library as a user document ("Your
 *      documents"), distinct from the built-in examples.
 *   3. Save downloads the LIVE buffer as a Blob with a default filename
 *      derived from the document label: the opened file's own name, or the
 *      basename of a built-in's path, with untitled.stm as the last resort.
 */

import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { libraryUri } from "./harness-env";

/** A self-contained single-file pipeline used as the pre-open state. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/** Open the harness with the sfdc fixture rendered. */
async function openWithFixture(page: Page): Promise<void> {
  await page.goto(`/?fixture=${encodeURIComponent(sfdcUri)}`);
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

// The file the tests "choose" in the Open dialog: a valid one-schema document
// whose schema name appears nowhere in the bundled corpus, so its card in the
// overview proves the viz re-rendered from the opened text.
const OPENED_FILENAME = "my-pipeline.stm";
const OPENED_DOC = [
  "schema opened_from_disk {",
  "  Id    ID          (pk)",
  "  Label STRING(64)",
  "}",
  "",
].join("\n");

/** Choose OPENED_DOC in the (hidden) file input, as if picked in the dialog. */
async function openLocalFile(page: Page): Promise<void> {
  await page.locator("#file-open-input").setInputFiles({
    name: OPENED_FILENAME,
    mimeType: "text/plain",
    buffer: Buffer.from(OPENED_DOC),
  });
}

test.describe("Open a local file (client-only)", () => {
  test("the chosen file replaces the buffer, relabels, re-renders — with zero network requests", async ({
    page,
  }) => {
    await openWithFixture(page);

    // Record every request from this point on. Open + the resulting re-render
    // must be fully client-side: the parser WASM is already loaded and the
    // model is built in-browser, so the action should fire NO requests at all
    // (the privacy AC — file content is never uploaded).
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await openLocalFile(page);

    // The file's text replaces the editor buffer and the label is the filename.
    await expect(page.locator("#source-input")).toHaveValue(OPENED_DOC);
    await expect(page.locator("#fixture-picker-name")).toHaveText(OPENED_FILENAME);

    // The viz re-rendered from the opened text: its unique schema is on screen
    // and the sfdc cards are gone.
    await expect(
      page.locator("[data-testid^='overview-schema-card-']", {
        hasText: "opened_from_disk",
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-testid^='overview-schema-card-']")).toHaveCount(1);

    expect(requests).toEqual([]);

    // The library gained a user document under "Your documents".
    await page.locator("#fixture-picker-btn").click();
    const userSection = page.locator(".fixture-section-header", { hasText: "Your documents" });
    await expect(userSection).toBeVisible();
    await expect(
      page.locator(".fixture-item", { hasText: OPENED_FILENAME }),
    ).toBeVisible();
  });
});

test.describe("Save to local (client-only download)", () => {
  test("downloads the live buffer named after a built-in's basename", async ({ page }) => {
    await openWithFixture(page);

    // The built-in's label is its corpus path ("sfdc-to-snowflake/pipeline.stm");
    // a download cannot contain slashes, so the default name is the basename.
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#file-save-btn").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("pipeline.stm");

    // The downloaded bytes are exactly the live buffer — proof the save path
    // serialises the editor content client-side rather than fetching anything.
    const buffer = await page.locator("#source-input").inputValue();
    const downloadPath = await download.path();
    expect(await readFile(downloadPath, "utf8")).toBe(buffer);
  });

  test("after Open, Save defaults to the opened filename", async ({ page }) => {
    // The default-name chain (PRD §4): an opened file's own name wins over any
    // fixture-derived name.
    await openWithFixture(page);
    await openLocalFile(page);
    await expect(page.locator("#fixture-picker-name")).toHaveText(OPENED_FILENAME);

    const downloadPromise = page.waitForEvent("download");
    await page.locator("#file-save-btn").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(OPENED_FILENAME);
    expect(await readFile(await download.path(), "utf8")).toBe(OPENED_DOC);
  });
});

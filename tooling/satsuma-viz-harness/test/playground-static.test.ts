/**
 * playground-static.test.ts — the published bundle under a non-root base path.
 *
 * Runs ONLY in the playground-static Playwright project, whose baseURL is
 * http://localhost:3334/satsuma-lang/playground/ — a dumb static file server
 * (scripts/serve-playground.mjs) reproducing the GitHub Pages topology. The
 * regular suite exercises the dev server; these tests prove the BUNDLE:
 *   1. It loads and renders a seeded example with every request resolving
 *      page-relative inside the base path (no root-absolute refs, no /api/*,
 *      no Node process — the server here cannot answer anything dynamic).
 *   2. The privacy guarantee holds as a tested property: once loaded, edit,
 *      Open, and Save complete with ZERO further network requests, so no
 *      request can possibly carry source content (feature 33 AC 11/§risks).
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** A seeded built-in known to render multiple schema cards. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/** Load the playground page (relative to the project's non-root baseURL). */
async function openPlayground(page: Page): Promise<void> {
  await page.goto(`./?fixture=${encodeURIComponent(sfdcUri)}`);
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

// A minimal valid edit used to prove client-side re-rendering in the bundle.
const STATIC_EDIT_DOC = [
  "schema static_bundle_only {",
  "  Id    ID          (pk)",
  "  Name  STRING(64)",
  "}",
  "",
].join("\n");

test.describe("Static playground bundle (non-root base path)", () => {
  test("loads, seeds the library, and renders an example entirely from the base path", async ({
    page,
  }) => {
    // Capture every request the page makes from the very first navigation:
    // each one must resolve inside /satsuma-lang/playground/, proving all
    // asset URLs (scripts, WASM, examples.json) are page-relative. A single
    // root-absolute reference would escape the prefix and 404 on Pages.
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    await openPlayground(page);

    // The viz rendered a seeded example — the library came from the bundled
    // examples.json, because this server has no fixture API to fall back to.
    await expect(
      page.locator("[data-testid^='overview-schema-card-']").first(),
    ).toBeVisible();

    // The picker is populated from the seeded localStorage library.
    await page.locator("#fixture-picker-btn").click();
    expect(await page.locator(".fixture-item").count()).toBeGreaterThan(10);

    expect(requests.length).toBeGreaterThan(0);
    for (const url of requests) {
      expect(url, `request escaped the base path: ${url}`).toContain(
        "/satsuma-lang/playground/",
      );
    }
  });

  test("edit, Open, and Save complete with zero network requests (privacy guarantee)", async ({
    page,
  }) => {
    await openPlayground(page);

    // From here on, NOTHING should touch the network: parsing, model building,
    // rendering, file reading, and downloading are all in-page. Zero requests
    // is the strongest possible form of "no request carries source content".
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

    // Edit: the buffer replaces the model and the viz re-renders client-side.
    await page.locator("#source-input").fill(STATIC_EDIT_DOC);
    await expect(
      page.locator("[data-testid^='overview-schema-card-']", {
        hasText: "static_bundle_only",
      }),
    ).toBeVisible({ timeout: 10_000 });

    // Open: a local file lands in the library via in-browser file reading.
    await page.locator("#file-open-input").setInputFiles({
      name: "private-mapping.stm",
      mimeType: "text/plain",
      buffer: Buffer.from(STATIC_EDIT_DOC),
    });
    await expect(page.locator("#fixture-picker-name")).toHaveText("private-mapping.stm");

    // Save: the buffer downloads as a Blob.
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#file-save-btn").click();
    await downloadPromise;

    expect(requests).toEqual([]);
  });
});

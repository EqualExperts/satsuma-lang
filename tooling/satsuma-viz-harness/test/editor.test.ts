/**
 * editor.test.ts — Playwright browser tests for the live source editor (sl-p1r9).
 *
 * These validate the four properties the editable source pane must hold:
 *   1. The pane is editable and the highlight layer tracks the buffer
 *      character-for-character (the basis for caret/colour alignment).
 *   2. Wide lines scroll horizontally with the highlight layer locked to the
 *      textarea's scroll offset (a real geometry assertion at a non-zero offset).
 *   3. An edit re-renders the visualization on a debounce.
 *   4. An empty/invalid intermediate buffer keeps the last good visualization and
 *      shows the parse-status indicator instead of blanking the canvas.
 *
 * The editor is a transparent <textarea id="source-input"> over a coloured
 * <pre id="source-highlight">; see src/client/editor.ts for the overlay design.
 */

import { test, expect, type Page } from "@playwright/test";
// The typed window.__satsumaHarness global is declared once in harness-env.ts
// from the app's exported interface.
import { libraryUri } from "./harness-env";

// ---------- Helpers ----------

/** The sfdc-to-snowflake document URI — a self-contained single-file pipeline. */
const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/**
 * Open the harness in single-file mode and load the sfdc fixture into the editor.
 * Single-file mode keeps the model scoped to the editor buffer (no import merge),
 * so edits to the buffer fully determine the rendered schema cards.
 */
async function openWithFixture(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator(".toggle-btn[data-mode='single']").click();
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${sfdcUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

/** Count the schema cards currently rendered in the overview. */
function schemaCards(page: Page) {
  return page.locator("[data-testid^='overview-schema-card-']");
}

// A minimal, self-contained valid document with exactly one schema. Used to prove
// an edit re-renders: replacing the multi-schema sfdc buffer with this collapses
// the overview to a single schema card.
const SINGLE_SCHEMA_DOC = [
  "schema playground_only {",
  "  Id    ID          (pk)",
  "  Name  STRING(120)",
  "}",
  "",
].join("\n");

// ---------- Tests ----------

test.describe("Live editor — editing and highlighting", () => {
  test.beforeEach(async ({ page }) => {
    await openWithFixture(page);
  });

  test("the source pane is editable and the highlight layer tracks the buffer", async ({
    page,
  }) => {
    // The textarea is the single source of truth; the highlight <pre> must mirror
    // its text exactly so colours sit under the caret. Type a fresh document and
    // assert the highlight layer's text content equals the buffer, and that real
    // token spans were produced (not plain text).
    const input = page.locator("#source-input");
    await input.fill(SINGLE_SCHEMA_DOC);

    await expect.poll(async () =>
      page.locator("#source-highlight").evaluate((el) => el.textContent),
    ).toBe(SINGLE_SCHEMA_DOC);

    // `schema` is a keyword; `ID` and `STRING` are data types — all must be
    // tokenized into their respective token classes (not left as plain text).
    await expect(page.locator("#source-highlight .tok-kw").first()).toHaveText("schema");
    await expect(
      page.locator("#source-highlight .tok-type", { hasText: "STRING" }),
    ).toHaveCount(1);
  });

  test("wide lines scroll horizontally with the highlight layer locked to the caret", async ({
    page,
  }) => {
    // A line wider than the pane must scroll left/right rather than wrap, and the
    // coloured layer must shift in lock-step so colours stay under the caret at a
    // non-zero scroll offset. We measure a token's on-screen x before and after a
    // horizontal scroll and assert it moved by exactly the scroll delta.
    const WIDE_COMMENT = `// ${"wide-".repeat(60)}end`;
    await page.locator("#source-input").fill(`${WIDE_COMMENT}\n${SINGLE_SCHEMA_DOC}`);

    const SCROLL_BY = 120; // px; comfortably inside the wide line's overflow

    const token = page.locator("#source-highlight .tok-comment").first();
    const before = await token.boundingBox();
    if (!before) throw new Error("comment token not rendered");

    // Scroll the editable layer horizontally and notify the overlay's scroll sync.
    await page.locator("#source-input").evaluate((el, dx) => {
      (el as HTMLTextAreaElement).scrollLeft = dx;
      el.dispatchEvent(new Event("scroll"));
    }, SCROLL_BY);

    // The highlight layer's scroll offset must equal the textarea's exactly.
    const offsets = await page.evaluate(() => ({
      input: (document.getElementById("source-input") as HTMLTextAreaElement).scrollLeft,
      highlight: (document.getElementById("source-highlight") as HTMLElement).scrollLeft,
    }));
    expect(offsets.input).toBe(SCROLL_BY);
    expect(offsets.highlight).toBe(SCROLL_BY);

    // The token must have moved left by the scroll delta (geometry alignment).
    const after = await token.boundingBox();
    if (!after) throw new Error("comment token not rendered after scroll");
    expect(after.x).toBeCloseTo(before.x - SCROLL_BY, 0);
  });
});

test.describe("Live editor — debounced re-render and resilience", () => {
  test.beforeEach(async ({ page }) => {
    await openWithFixture(page);
  });

  test("editing the buffer re-renders the visualization on a debounce", async ({ page }) => {
    // sfdc declares four schemas. Replacing the buffer with a one-schema document
    // must rebuild the model and collapse the overview to a single schema card —
    // proof that edits, not just fixture loads, drive the viz.
    await expect(schemaCards(page)).toHaveCount(4);

    await page.locator("#source-input").fill(SINGLE_SCHEMA_DOC);

    await expect(schemaCards(page)).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator("[data-testid^='overview-schema-card-']")).toContainText(
      "playground_only",
    );
  });

  test("an empty buffer keeps the last good viz and shows the parse-status indicator", async ({
    page,
  }) => {
    // A mid-edit buffer that yields no model must NOT blank the canvas: the
    // previous good visualization is retained and an unobtrusive indicator
    // signals that the displayed viz is stale relative to the buffer.
    await expect(schemaCards(page)).toHaveCount(4);

    await page.locator("#source-input").fill("");

    // The indicator appears and the harness reports the displayed viz as stale.
    await expect(page.locator("#parse-status")).toBeVisible({ timeout: 5_000 });
    await expect
      .poll(async () => page.evaluate(() => window.__satsumaHarness.parseStatus))
      .toBe("stale");

    // Crucially, the previous four schema cards are still on screen.
    await expect(schemaCards(page)).toHaveCount(4);

    // Dismissing the indicator hides it without restoring/altering the viz.
    await page.locator("#parse-status-dismiss").click();
    await expect(page.locator("#parse-status")).toBeHidden();
    await expect(schemaCards(page)).toHaveCount(4);
  });
});

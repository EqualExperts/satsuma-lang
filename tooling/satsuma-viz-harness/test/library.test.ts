/**
 * library.test.ts — Playwright tests for the seeded document library (AC 7).
 *
 * The library's seed/merge/persist SEMANTICS are unit-tested in Node
 * (test/unit/library.test.mjs); these browser tests cover only what a unit
 * test cannot — the end-to-end loop through real localStorage and a reload:
 *   1. A first visit seeds the picker with the whole bundled corpus.
 *   2. An edit to a built-in example survives a reload (the editor restores
 *      the edited source, and the picker marks the document as edited).
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

const sfdcUri = libraryUri("sfdc-to-snowflake/pipeline.stm");

/** Open the harness with the sfdc built-in loaded and rendered. */
async function openWithFixture(page: Page): Promise<void> {
  await page.goto(`/?fixture=${encodeURIComponent(sfdcUri)}`);
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

// The corpus ships ~24 examples; a healthy seed must populate well beyond a
// handful. A conservative floor keeps the test stable as examples are added.
const MIN_SEEDED_EXAMPLES = 10;

// Replacement source for the edit-survives-reload case: small, valid, and
// containing a schema name that exists nowhere in the bundled corpus, so its
// presence after reload can only come from the persisted edit.
const EDITED_DOC = [
  "schema edited_survivor {",
  "  Id    ID          (pk)",
  "  Note  STRING(40)",
  "}",
  "",
].join("\n");

test.describe("Seeded document library", () => {
  test("a first visit seeds the picker with the bundled example corpus", async ({ page }) => {
    // Playwright contexts start with empty localStorage, so this IS the
    // first-visit path: the picker contents can only come from the bundled
    // examples.json seed (feature 33 AC 7).
    await page.goto("/");
    await page.locator("#fixture-picker-btn").click();
    expect(await page.locator(".fixture-item").count()).toBeGreaterThan(MIN_SEEDED_EXAMPLES);
    await expect(page.locator(`.fixture-item[data-uri="${sfdcUri}"]`)).toBeVisible();
  });

  test("an edited built-in survives a reload and is marked as edited", async ({ page }) => {
    // The no-silent-data-loss rule (sl-kd45): a user's edit to a built-in is
    // persisted, restored after a reload, and visibly flagged so Restore
    // original is discoverable.
    await openWithFixture(page);
    await page.locator("#source-input").fill(EDITED_DOC);

    // The re-rendered viz proves the debounced library update flushed (the
    // edit is in the library entry, not just the keystroke buffer).
    await expect(
      page.locator("[data-testid^='overview-schema-card-']", { hasText: "edited_survivor" }),
    ).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.locator("#source-input")).toHaveValue(EDITED_DOC);

    // The picker row carries the edited marker (●) for the modified built-in.
    await page.locator("#fixture-picker-btn").click();
    await expect(page.locator(`.fixture-item[data-uri="${sfdcUri}"]`)).toContainText("●");
  });
});

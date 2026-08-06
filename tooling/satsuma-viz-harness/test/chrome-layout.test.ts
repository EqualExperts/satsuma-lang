/**
 * chrome-layout.test.ts — Playwright tests for two pieces of viz chrome whose
 * defects are only observable once the component is painted at a real width.
 *
 *  - sl-zsv6: the toolbar is a flex row of controls that all hold their own
 *    width. Narrower than its contents, it pushed the trailing file filter past
 *    its right edge and wrapped the title onto two lines instead. Neither is
 *    visible to a unit test: both are consequences of flex resolution in a
 *    laid-out box.
 *
 *  - sl-yedr: a compact card's top rounding comes from the host's overflow clip,
 *    which `:host([compact-expanded])` deliberately lifts. The header carries a
 *    fallback rule, but only fires as `:first-child` — so a namespaced card,
 *    whose pill row sits above the header, rendered square top corners when
 *    expanded. Only a browser resolves which rule won and what radius the
 *    painted element actually has.
 *
 * Both are checked in light and dark: the fixes are geometry, so a theme must
 * not change them, and a token-driven radius that resolved in one palette only
 * would be exactly the kind of regression this file exists to catch.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/**
 * The multi-namespace platform entry point — the fixture that renders the most
 * toolbar controls (both the namespace and the file filter appear, because it
 * has namespaces AND imports across files) and the only one whose overview
 * cards carry namespace pills. Both bugs were reported against it.
 */
const nsPlatformUri = libraryUri("namespaces/ns-platform.stm");

/**
 * The viewport the bugs were reported at. The harness's own default is 1280px
 * wide; sl-zsv6 was observed at 1440x900 with the source pane open, which is
 * the narrower viz column of the two, so this is the tighter of the two cases.
 */
const REPORTED_VIEWPORT = { width: 1440, height: 900 };

/** Load a fixture through the picker and wait for the viz to report ready. */
async function loadFixture(page: Page, fixtureUri: string): Promise<void> {
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${fixtureUri}"]`).click();
  await page.locator("[data-testid='viz-root']").waitFor({ state: "visible" });
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

test.describe("Toolbar layout at the reported viewport (sl-zsv6)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`the title stays on one line and every control stays inside the toolbar (${theme})`, async ({
      page,
    }) => {
      await page.setViewportSize(REPORTED_VIEWPORT);
      await page.goto(`/?theme=${theme}`);
      await loadFixture(page, nsPlatformUri);

      // The source pane is open (the harness default) — the reported condition,
      // and the one that leaves the viz its narrowest column.
      await expect(page.locator("#source-editor")).toBeVisible();

      // A span renders one client rect per line box, so a wrapped title has two.
      // This is the direct form of "the title does not wrap": it does not depend
      // on knowing the font's line height.
      const titleLineBoxes = await page
        .locator("satsuma-viz .toolbar-title")
        .evaluate((el) => el.getClientRects().length);
      expect(titleLineBoxes, "toolbar title wrapped onto more than one line").toBe(1);

      // The file filter is the last control in the toolbar for this fixture, so
      // it is the one that used to overflow. Every control must sit within the
      // toolbar's own content box — the toolbar is allowed to grow taller
      // (it wraps deliberately), never to hide a control past its right edge.
      const overflow = await page.locator("satsuma-viz .toolbar").evaluate((toolbar) => {
        const box = toolbar.getBoundingClientRect();
        return [...toolbar.children]
          .map((child) => {
            const r = child.getBoundingClientRect();
            return { right: r.right, bottom: r.bottom, cls: child.className };
          })
          .filter((r) => r.right > box.right + 1 || r.bottom > box.bottom + 1);
      });
      expect(overflow, "toolbar controls painted outside the toolbar box").toEqual([]);

      // And the filter is genuinely reachable, not merely inside a zero-size box.
      const filter = page.locator("[data-testid='toolbar-file-filter']");
      await expect(filter).toBeVisible();
      const filterBox = await filter.boundingBox();
      expect(filterBox?.width ?? 0).toBeGreaterThan(0);
    });
  }
});

test.describe("Namespaced compact card corners when expanded (sl-yedr)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`an expanded namespaced card keeps its rounded top corners (${theme})`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await loadFixture(page, nsPlatformUri);

      // Any namespaced card exercises the rule; the `raw` layer's cards are the
      // fixture's sources and always present.
      const card = page.locator("sz-schema-card[data-testid^='overview-schema-card-raw-']").first();
      const pillRow = card.locator("[data-testid$='-namespace-pill']");
      await expect(pillRow).toBeVisible();

      await card.locator(".header-toggle").click();
      // The reflected attribute is what lifts the host's overflow clip, so the
      // fallback rounding matters only once it is present.
      await expect(card).toHaveAttribute("compact-expanded", "");

      // The pill row is the top of the card, so it is the element whose corners
      // a reader sees. Assert both halves of that claim: it sits at the very top
      // of the card's content box, and it paints the card radius rather than 0.
      const geometry = await card.evaluate((host) => {
        const row = host.shadowRoot?.querySelector<HTMLElement>("[data-testid$='-namespace-pill']");
        if (!row) throw new Error("namespace pill row not rendered");
        const style = getComputedStyle(row);
        const hostStyle = getComputedStyle(host);
        return {
          // The row starts inside the host's 1px border, so the offset to compare
          // against is the border width — not zero.
          topOffset:
            row.getBoundingClientRect().top -
            host.getBoundingClientRect().top -
            parseFloat(hostStyle.borderTopWidth),
          topLeft: style.borderTopLeftRadius,
          topRight: style.borderTopRightRadius,
          cardRadius: hostStyle.getPropertyValue("--sz-card-radius").trim(),
        };
      });

      expect(geometry.topOffset).toBeCloseTo(0, 0);
      // Equal to the shared card-radius token, not merely non-zero: that is what
      // "matching non-namespaced cards" means, and it fails loudly if the token
      // and the fallback rule ever diverge.
      expect(geometry.topLeft).toBe(geometry.cardRadius);
      expect(geometry.topRight).toBe(geometry.cardRadius);
    });
  }
});

/**
 * edge-anchors.test.ts — overview edge anchor dots sit ON the rendered cards
 * (sl-wixe).
 *
 * The layout unit tests (satsuma-viz/test/overview-anchors.test.js) pin the
 * anchor MATH; these tests pin the RENDERED result, which historically broke
 * three separate ways: the edge SVG was mounted 24px above the card layer,
 * non-namespaced compact cards drew a 24px filler bar the layout didn't know
 * about, and mapping pills padded themselves instead of matching their node.
 * Each dot must therefore lie on a card's left or right border, vertically
 * centred on the visible header — in both themes, with and without
 * namespaces. Tolerance is ±1.5px (sub-pixel rounding of SVG vs DOM boxes).
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** Non-namespaced fixture: schema cards + mapping pills in the global scope. */
const buyToOmUri = libraryUri("contracts/buy-to-om-order.stm");
/** Multi-namespace fixture: every card carries a namespace pill row. */
const nsPlatformUri = libraryUri("namespaces/ns-platform.stm");

const TOLERANCE_PX = 1.5;

/** Geometry constants mirrored from satsuma-viz/src/layout/geometry.ts. */
const HEADER_HEIGHT = 40;
const NAMESPACE_PILL_HEIGHT = 24;

interface Box {
  left: number;
  right: number;
  top: number;
  height: number;
  kind: "mapping" | "card";
  hasPill: boolean;
  /** For schema/metric/fragment cards: the rendered header's vertical midpoint. */
  headerMidY: number | null;
}

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

/** Collect every positioned card's border geometry and chrome shape. */
async function cardBoxes(page: Page): Promise<Box[]> {
  const cards = page.locator(".positioned-card");
  const count = await cards.count();
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const box = await card.boundingBox();
    if (!box) continue;
    const kind = (await card.getAttribute("class"))?.includes("mapping-node")
      ? ("mapping" as const)
      : ("card" as const);
    // Mapping pills render the namespace chip inline; the layout reserves
    // chip space only for named namespaces, detectable from the node id
    // (mapping:<ns>:<id> vs mapping:_:<id>).
    const hasPill =
      kind === "mapping" &&
      !((await card.getAttribute("data-node-id")) ?? "").startsWith("mapping:_:");
    // Schema/metric/fragment cards all render a .header bar; the dot must
    // sit at ITS rendered midpoint — measuring it (rather than re-deriving
    // it from pill detection) asserts the user-facing property directly.
    let headerMidY: number | null = null;
    if (kind === "card") {
      const headerBox = await card.locator(".header").first().boundingBox();
      if (headerBox) headerMidY = headerBox.y + headerBox.height / 2;
    }
    boxes.push({
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      height: box.height,
      kind,
      hasPill,
      headerMidY,
    });
  }
  return boxes;
}

/** The y where an edge anchor must sit for a given card. */
function expectedAnchorY(box: Box): number {
  if (box.kind === "mapping") {
    const pillOffset = box.hasPill ? NAMESPACE_PILL_HEIGHT : 0;
    return box.top + pillOffset + (box.height - pillOffset) / 2;
  }
  // The rendered header midpoint; falls back to the geometry formula only if
  // the header was not measurable (never expected in practice).
  return box.headerMidY ?? box.top + HEADER_HEIGHT / 2;
}

/** Assert every anchor dot lies on some card's border at its header midpoint. */
async function assertDotsOnCards(page: Page): Promise<void> {
  const boxes = await cardBoxes(page);
  expect(boxes.length).toBeGreaterThan(0);

  const dots = page.locator("sz-overview-edge-layer circle.anchor-dot");
  const dotCount = await dots.count();
  expect(dotCount).toBeGreaterThan(0);

  for (let i = 0; i < dotCount; i++) {
    const dotBox = await dots.nth(i).boundingBox();
    if (!dotBox) throw new Error(`anchor dot ${i} not rendered`);
    const cx = dotBox.x + dotBox.width / 2;
    const cy = dotBox.y + dotBox.height / 2;

    const touchesACard = boxes.some(
      (b) =>
        (Math.abs(cx - b.left) <= TOLERANCE_PX || Math.abs(cx - b.right) <= TOLERANCE_PX) &&
        Math.abs(cy - expectedAnchorY(b)) <= TOLERANCE_PX,
    );
    expect(
      touchesACard,
      `anchor dot ${i} at (${cx.toFixed(1)}, ${cy.toFixed(1)}) must sit on a card border ` +
        `at its header midpoint; cards: ${JSON.stringify(boxes.map((b) => ({ l: b.left, r: b.right, y: expectedAnchorY(b) })))}`,
    ).toBe(true);
  }
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`Overview edge anchors — ${theme} theme`, () => {
    test(`dots sit on non-namespaced cards at the header midpoint (${theme})`, async ({
      page,
    }) => {
      await loadFixture(page, buyToOmUri);
      await page.locator(`#theme-toggle .toggle-btn[data-theme='${theme}']`).click();
      await assertDotsOnCards(page);
    });

    test(`dots sit on namespaced cards below the pill row (${theme})`, async ({ page }) => {
      await loadFixture(page, nsPlatformUri);
      await page.locator(`#theme-toggle .toggle-btn[data-theme='${theme}']`).click();
      await assertDotsOnCards(page);
    });
  });
}

test("card chrome matches the geometry contract: no filler bar, 40px header", async ({
  page,
}) => {
  // Anchor math measures from the card top: header midpoint is at
  // top + (pill ? 24 : 0) + 20. The old 24px filler bar shifted the visible
  // header down without the layout knowing. Assert the actual chrome: the
  // header starts at the card top when there is no namespace pill, exactly
  // one pill-row down when there is, and is exactly HEADER_HEIGHT tall.
  await loadFixture(page, buyToOmUri);

  const cards = page.locator(".positioned-card:not(.mapping-node)");
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const cardBox = await card.boundingBox();
    const headerBox = await card.locator(".header").first().boundingBox();
    if (!cardBox || !headerBox) throw new Error(`card ${i} not rendered`);

    const hasPill = (await card.locator("[data-testid$='-namespace-pill']").count()) > 0;
    const expectedHeaderTop = cardBox.y + (hasPill ? NAMESPACE_PILL_HEIGHT : 0);

    expect(
      Math.abs(headerBox.y - expectedHeaderTop),
      `card ${i}: header must start ${hasPill ? "one pill-row below" : "at"} the card top ` +
        `(got ${headerBox.y}, expected ${expectedHeaderTop})`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(
      Math.abs(headerBox.height - HEADER_HEIGHT),
      `card ${i}: header height must be ${HEADER_HEIGHT}px (got ${headerBox.height})`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  }
});

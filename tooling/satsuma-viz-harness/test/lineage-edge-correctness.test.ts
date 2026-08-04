/**
 * lineage-edge-correctness.test.ts — browser coverage for field-line rendering.
 *
 * These tests exercise the complete browser pipeline from authored Satsuma to
 * VizModel, ELK field edges, and rendered schema-card coverage. They focus on
 * cases where the old layout made a confident but false lineage claim.
 */
import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

/** Fixture with computed targets and ordinary mapped and unmapped fields. */
const governanceUri = libraryUri("filter-flatten-governance/filter-flatten-governance.stm");

/** Load one library document in single-file mode and wait for both layouts. */
async function loadFixture(page: Page, fixtureUri: string): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => {
    const harness = window.__satsumaHarness;
    if (!harness?.setViewMode) return false;
    harness.setViewMode("single");
    return true;
  });
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${fixtureUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

/** Open a named overview mapping card and return its rendered detail component. */
async function openMapping(page: Page, mappingId: string) {
  await page.locator(`[data-testid='overview-mapping-card-${mappingId}']`).click();
  const detail = page.locator(`[data-testid='mapping-detail-${mappingId}']`).first();
  await expect(detail).toBeVisible({ timeout: 10_000 });
  return detail;
}

test.describe("field-line rendering correctness", () => {
  test("a computed target is mapped without inventing a same-named source edge (lgc-4bxl)", async ({
    page,
  }) => {
    // `active_line_count` is computed and has no source. The browser layout must
    // contain no sourceless edge, while the rendered target row remains covered;
    // that filled port distinguishes it from the genuinely unmapped source row.
    await loadFixture(page, governanceUri);

    const layoutEvidence = await page.locator("[data-testid='viz-root']").evaluate((element) => {
      const layout = (
        element as unknown as {
          _layout: {
            edges: Array<{
              sourceField: string;
              targetField: string;
              arrow: { sourceFields: string[] };
            }>;
          };
        }
      )._layout;
      return {
        sourcelessEdges: layout.edges.filter((edge) => edge.arrow.sourceFields.length === 0).length,
        directOrderIdEdges: layout.edges.filter(
          (edge) => edge.sourceField === "event_id" && edge.targetField === "order_id",
        ).length,
      };
    });
    expect(layoutEvidence.sourcelessEdges).toBe(0);
    expect(layoutEvidence.directOrderIdEdges).toBeGreaterThan(0);

    const detail = await openMapping(page, "completed-orders");
    const computedTarget = detail.locator(
      "[data-testid='mapping-detail-completed-orders-target-schema-card-completed-orders-parquet-field-active-line-count']",
    );
    const unusedSource = detail.locator(
      "[data-testid='mapping-detail-completed-orders-source-schema-card-customer-profiles-field-first-name']",
    );
    await expect(computedTarget).toHaveAttribute("data-coverage", "mapped");
    await expect(unusedSource).toHaveAttribute("data-coverage", "unmapped");
  });
});

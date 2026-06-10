/**
 * metric-endpoints.test.ts — metrics render as mapping endpoints in the
 * detail view (sl-cw68).
 *
 * Metrics (`schema X (metric, …)`) live in ns.metrics, not ns.schemas. The
 * detail view used to resolve mapping endpoints only against schemas, so a
 * mapping targeting a metric rendered a completely EMPTY target column
 * (metric-target-missing.jpg in features/34-live-editor-ux). These tests pin
 * both directions: a pipeline mapping writing INTO a metric shows the metric
 * card as the target, and a downstream mapping reading FROM a metric shows
 * it as a source — fields, metric metadata pills, and coverage intact.
 */

import { test, expect, type Page } from "@playwright/test";
import { libraryUri } from "./harness-env";

const metricsUri = libraryUri("metrics-platform/metrics.stm");

async function loadMetricsFixture(page: Page, mode: "lineage" | "single"): Promise<void> {
  await page.goto("/");
  await page.evaluate((m) => window.__satsumaHarness.setViewMode?.(m), mode);
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${metricsUri}"]`).click();
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

test("a mapping targeting a metric renders the metric card in the TARGET column", async ({
  page,
}) => {
  await loadMetricsFixture(page, "lineage");

  // dispatchEvent rather than a pointer click — overview cards can sit under
  // the minimap overlay, which intercepts real pointer events.
  await page
    .locator("[data-testid='overview-mapping-card-conversion-rate-pipeline']")
    .dispatchEvent("click");
  const detail = page
    .locator("[data-testid='mapping-detail-conversion-rate-pipeline']")
    .first();
  await expect(detail).toBeVisible({ timeout: 10_000 });

  // The target column must contain the conversion_rate metric card — not be
  // empty — with its measure fields and metric metadata pills visible.
  const targetCard = page.locator(
    "[data-testid^='mapping-detail-conversion-rate-pipeline-target-schema-card-conversion-rate']",
  ).first();
  await expect(targetCard).toBeVisible();
  await expect(targetCard).toContainText("pipeline_stage");
  await expect(targetCard).toContainText("value");
  // grain/slice declarations surface as metadata pills so the card still
  // reads as a metric rather than a plain table.
  await expect(targetCard).toContainText("grain");
  await expect(targetCard).toContainText("monthly");
});

// A downstream mapping that READS from a metric. Appended to the fixture
// buffer via the live editor — also exercising edit-driven re-render on a
// metric-bearing document. conversion_rate is declared in metrics.stm itself,
// so single-file mode keeps it resolvable without imports.
const METRIC_SOURCE_MAPPING = [
  "",
  "schema win_rate_report {",
  "  stage   STRING(50)",
  "  region  STRING(50)",
  "}",
  "",
  "mapping _win_rate_report_load {",
  "  source { conversion_rate }",
  "  target { win_rate_report }",
  "",
  "  pipeline_stage -> stage",
  "  region -> region",
  "}",
  "",
].join("\n");

test("a mapping sourcing from a metric renders the metric card in the SOURCES column", async ({
  page,
}) => {
  await loadMetricsFixture(page, "single");

  // Append the metric-consuming mapping to the buffer and wait for its
  // overview card to appear (proves the model rebuilt with the new mapping).
  const buffer = await page.locator("#source-input").inputValue();
  await page.locator("#source-input").fill(buffer + METRIC_SOURCE_MAPPING);
  const mappingCard = page.locator(
    "[data-testid='overview-mapping-card-win-rate-report-load']",
  );
  await expect(mappingCard).toBeVisible({ timeout: 10_000 });

  // The appended mapping lays out at the canvas edge — under the minimap.
  await mappingCard.dispatchEvent("click");
  const detail = page.locator("[data-testid='mapping-detail-win-rate-report-load']").first();
  await expect(detail).toBeVisible({ timeout: 10_000 });

  const sourceCard = page.locator(
    "[data-testid^='mapping-detail-win-rate-report-load-source-schema-card-conversion-rate']",
  ).first();
  await expect(sourceCard).toBeVisible();
  await expect(sourceCard).toContainText("pipeline_stage");
  await expect(sourceCard).toContainText("value");
});

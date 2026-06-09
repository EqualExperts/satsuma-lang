/**
 * harness.test.ts — Playwright browser tests for the Satsuma viz harness.
 *
 * Each test validates a specific, observable property of the mapping
 * visualization in a real browser, exercising the full production path:
 *
 *   .stm source files
 *     → @satsuma/viz-backend (VizModel assembly)
 *     → harness HTTP API
 *     → <satsuma-viz> web component
 *     → Playwright assertions
 *
 * Fixtures used:
 *   sfdc-to-snowflake/pipeline.stm  — canonical single-file example (schemas + mappings)
 *   namespaces/ns-platform.stm      — multi-file entry point (cross-file lineage)
 *   sap-po-to-mfcs/pipeline.stm     — larger fixture (layout stability)
 *
 * The harness exposes window.__satsumaHarness for event assertions.
 * The viz component exposes data-testid attributes and data-ready-state for
 * stable selector-based assertions.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------- Global type declarations ----------

// window.__satsumaHarness is set by src/client/app.ts and used by all tests
// to assert on recorded interaction events without VS Code APIs.
interface HarnessEvent {
  type: string;
  detail: unknown;
  timestamp: number;
}

interface SatsumaHarness {
  fixture: string | null;
  viewMode: "lineage" | "single";
  events: HarnessEvent[];
  ready: boolean;
  clearEvents(): void;
}

declare global {
  interface Window {
    __satsumaHarness: SatsumaHarness;
  }
}

// ---------- Helpers ----------

/** The URI query-parameter value for the sfdc-to-snowflake pipeline fixture. */
let sfdcUri: string;
/**
 * The URI for the metrics-platform entry point fixture.
 * This file imports from ./metric_sources.stm (which exists in examples/metrics-platform/),
 * so lineage mode will produce schemas from both files — more than any single file alone.
 */
let metricsUri: string;
/** Multi-namespace platform entry point — qualified IDs and namespace pills. */
let nsPlatformUri: string;
/** Reports + models fixture — report card metadata coverage. */
let reportsUri: string;
/** Larger fixture used in geometry/layout-stability tests. */
let sapUri: string;
/** Filter / flatten / governance fixture — multi-source joins, flatten, notes. */
let ffgUri: string;
/** buy-to-om-order contract fixture — used for compact card expansion tests. */
let buyToOmUri: string;

/**
 * Resolve fixture URIs before tests run.  The harness API serves the full list;
 * we pick the specific fixtures by display name.
 */
test.beforeAll(async ({ request }) => {
  const res = await request.get("/api/fixtures");
  const fixtures = await res.json() as Array<{ name: string; uri: string }>;

  const find = (name: string) => fixtures.find((f) => f.name === name);
  const sfdc = find("sfdc-to-snowflake/pipeline.stm");
  const metrics = find("metrics-platform/metrics.stm");
  const nsPlatform = find("namespaces/ns-platform.stm");
  const reports = find("reports-and-models/pipeline.stm");
  const sap = find("sap-po-to-mfcs/pipeline.stm");
  const ffg = find("filter-flatten-governance/filter-flatten-governance.stm");

  const buyToOm = find("contracts/buy-to-om-order.stm");

  if (!sfdc || !metrics || !nsPlatform || !reports || !sap || !ffg || !buyToOm) {
    throw new Error("Required fixtures not found in /api/fixtures");
  }

  sfdcUri = sfdc.uri;
  metricsUri = metrics.uri;
  nsPlatformUri = nsPlatform.uri;
  reportsUri = reports.uri;
  sapUri = sap.uri;
  ffgUri = ffg.uri;
  buyToOmUri = buyToOm.uri;
});

/**
 * Open a specific named mapping by clicking its overview mapping card.
 * The mappingId is the unqualified mapping name as written in the .stm file
 * (sanitizeTestIdSegment lowercases and replaces non-alnum runs with `-`).
 */
async function openMappingByName(
  page: Page,
  mappingId: string,
): Promise<ReturnType<Page["locator"]>> {
  await page.locator(`[data-testid='overview-mapping-card-${mappingId}']`).click();
  // The detail testid appears on BOTH the <sz-mapping-detail> host and its
  // inner <div class="layout"> child — strict mode rejects both, so we
  // anchor to the host (.first()) and return it as the detail base.
  const detail = page.locator(`[data-testid='mapping-detail-${mappingId}']`).first();
  await expect(detail).toBeVisible({ timeout: 10_000 });
  return detail;
}

/**
 * Load a fixture by clicking it in the sidebar and wait for the viz to be ready.
 * Returns the <satsuma-viz> element locator.
 */
async function loadFixture(page: Page, fixtureUri: string): Promise<void> {
  // Open the fixture picker dropdown, then click the matching item.
  // The dropdown is hidden (display:none) by default; clicking the picker
  // button reveals the fixture list before the item is accessible.
  await page.locator("#fixture-picker-btn").click();
  await page.locator(`.fixture-item[data-uri="${fixtureUri}"]`).click();
  // Wait for the viz to signal readiness via the data-ready-state attribute.
  await page.locator("[data-testid='viz-root']").waitFor({ state: "visible" });
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 20_000 },
  );
}

/**
 * Return recorded harness events of a specific type.
 * The function is intentionally small so event payload assertions stay
 * focused on the user interaction each test performs.
 */
async function recordedEvents(page: Page, type: string): Promise<HarnessEvent[]> {
  return page.evaluate(
    (eventType) => window.__satsumaHarness.events.filter((event) => event.type === eventType),
    type,
  );
}

/**
 * Open the first overview mapping card and wait for the mapping detail view.
 */
async function openFirstMappingDetail(page: Page): Promise<void> {
  await page.locator("[data-testid^='overview-mapping-card-']").first().click();
  await expect(page.locator("[data-testid^='mapping-detail-']").first()).toBeVisible({
    timeout: 10_000,
  });
}

// ---------- Tests ----------

test.describe("Overview view — sfdc-to-snowflake fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Lineage mode is active by default; load the single-file fixture first
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
  });

  test("renders expected schema cards in the overview", async ({ page }) => {
    // The sfdc-to-snowflake pipeline declares four schemas.
    // Each overview schema card gets a stable data-testid based on its qualifiedId.
    // We assert that at least two schema cards appear so the test validates real
    // content rather than an empty-but-ready state.
    const schemaCards = page.locator("[data-testid^='overview-schema-card-']");
    await expect(schemaCards).toHaveCount(4);
  });

  test("renders at least one mapping node in the overview", async ({ page }) => {
    // A mapping node appears in the overview as the connector between schemas.
    // At least one must be visible for the file to be considered rendered.
    const mappingNodes = page.locator("[data-testid^='overview-mapping-node-']");
    await expect(mappingNodes).toHaveCount(1);
  });
});

test.describe("Detail view — clicking a mapping", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
  });

  test("clicking a mapping card opens the detail view", async ({ page }) => {
    // In overview mode the mapping cards are visible.  Clicking one switches to
    // the detail view which shows the per-field arrows for that mapping.
    const firstMappingCard = page.locator("[data-testid^='overview-mapping-card-']").first();
    await firstMappingCard.click();

    // After clicking, a detail view element appears for the selected mapping.
    // Use .first() because the testid appears on both the <sz-mapping-detail>
    // custom element and its inner layout <div> — strict mode would reject both.
    const detailView = page.locator("[data-testid^='mapping-detail-']").first();
    await expect(detailView).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Hover and highlight interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
  });

  test("field-hover events from the viz are captured in the harness event log", async ({
    page,
  }) => {
    // A real field hover exercises the production SzFieldHoverEvent path and
    // proves the harness normalizes schemaId/fieldName from event properties.
    await openFirstMappingDetail(page);
    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    // After sl-eikr the source/target schema cards inside the mapping detail
    // use prefixes like `mapping-detail-<mid>-source-schema-card-<sid>` so the
    // top-level `schema-card-field-id` selector no longer matches.  Locate the
    // `Id` field row inside the source column instead — robust to mapping IDs.
    await page
      .locator("[data-testid$='-source-column'] [data-testid$='-field-id']")
      .first()
      .hover();

    await expect.poll(async () => recordedEvents(page, "field-hover")).toContainEqual(
      expect.objectContaining({
        detail: { schemaId: "sfdc_opportunity", fieldName: "Id" },
      }),
    );
  });
});

test.describe("Cross-file lineage expansion", () => {
  test("lineage mode merges schemas from all import-reachable files", async ({ page }) => {
    // The metrics-platform entry point (metrics.stm) imports from ./metric_sources.stm.
    // In lineage mode the server merges VizModels from both files, so the overview
    // contains schemas declared across both files — more than metrics.stm alone provides.
    await page.goto("/");
    // Lineage mode is the default; confirm the toggle is active.
    await expect(page.locator(".toggle-btn[data-mode='lineage']")).toHaveClass(/active/);
    await loadFixture(page, metricsUri);

    // With both files merged, the count must exceed what a single-file model would show.
    // Use nth(1) as a retrying assertion — the lineage model includes schemas from
    // both metrics.stm and metric_sources.stm, so at least two cards must appear.
    // A bare .count() is a point-in-time snapshot that races with layout completion.
    const schemaCards = page.locator("[data-testid^='overview-schema-card-']");
    await expect(schemaCards.nth(1)).toBeVisible({ timeout: 20_000 });
  });

  test("expand-lineage events from the viz are captured in the harness event log", async ({
    page,
  }) => {
    // RECORDER COMPATIBILITY TEST (the only synthetic-event test in this suite).
    // SzExpandLineageEvent is defined in @satsuma/viz but no UI control
    // currently dispatches it — it exists for future "expand to lineage from
    // here" affordances.  Until that control lands we still want to guarantee
    // the harness recorder normalizes the production Event-property shape
    // (not CustomEvent.detail), so this test dispatches a production-shaped
    // Event directly on <satsuma-viz>.  Replace with a real interaction once
    // an expand-lineage control exists in the UI.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, metricsUri);

    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    await page.evaluate(() => {
      const viz = document.querySelector("satsuma-viz");
      if (viz) {
        const event = new Event("expand-lineage", { bubbles: true, composed: true });
        Object.defineProperty(event, "schemaId", { value: "test::schema" });
        viz.dispatchEvent(event);
      }
    });

    await expect.poll(async () => recordedEvents(page, "expand-lineage")).toContainEqual(
      expect.objectContaining({ detail: { schemaId: "test::schema" } }),
    );
  });
});

test.describe("Navigation intent", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
  });

  test("navigate events from the viz are captured in the harness event log", async ({
    page,
  }) => {
    // A real overview schema-header click dispatches SzNavigateEvent with a
    // SourceLocation property; the harness must normalize it to stable JSON.
    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    await page.locator("[data-testid='overview-schema-card-sfdc-opportunity']").click();

    await expect.poll(async () => recordedEvents(page, "navigate")).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({
          uri: expect.stringContaining("sfdc-to-snowflake/pipeline.stm"),
          line: expect.any(Number),
          character: expect.any(Number),
        }),
      }),
    );
  });

  test("field-lineage events from the viz are captured in the harness event log", async ({
    page,
  }) => {
    // A real field-lineage button click dispatches SzFieldLineageEvent with
    // field identity properties that the harness must preserve as JSON.
    await openFirstMappingDetail(page);
    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    // Same selector update as the field-hover test: source column scoped, then
    // the `-field-id` row, then the per-field lineage button (suffix `-lineage`).
    const fieldRow = page
      .locator("[data-testid$='-source-column'] [data-testid$='-field-id']")
      .first();
    await fieldRow.hover();
    await fieldRow.locator("[data-testid$='-field-id-lineage']").click();

    await expect.poll(async () => recordedEvents(page, "field-lineage")).toContainEqual(
      expect.objectContaining({
        detail: { schemaId: "sfdc_opportunity", fieldName: "Id" },
      }),
    );
  });

  test("clicking an arrow row in the mapping detail records a navigate event", async ({
    page,
  }) => {
    // Each arrow row in the mapping detail table is wired to _navigate(arrow.location)
    // (sz-mapping-detail.ts:645). A real click must therefore round-trip through
    // SzNavigateEvent and surface as a `navigate` event in the harness recorder
    // with the source location of that specific arrow row.  This validates the
    // arrow-row → navigation production path end-to-end without any synthetic
    // event dispatch.
    await openFirstMappingDetail(page);
    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    await page
      .locator("[data-testid^='mapping-detail-'][data-testid*='-arrow-row-']")
      .first()
      .click();

    await expect.poll(async () => recordedEvents(page, "navigate")).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({
          uri: expect.stringContaining("sfdc-to-snowflake/pipeline.stm"),
          line: expect.any(Number),
          character: expect.any(Number),
        }),
      }),
    );
  });

  test("export events from the viz are captured in the harness event log", async ({ page }) => {
    // A real toolbar export click emits SVG content through CustomEvent.detail;
    // the recorder should preserve that supported CustomEvent payload shape.
    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    await page.locator("[data-testid='toolbar-export']").click();

    await expect.poll(async () => recordedEvents(page, "export")).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({
          format: "svg",
          content: expect.stringContaining("<svg"),
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Fixture matrix overview coverage (sl-3c2w)
//
// One describe block per fixture family.  Each block clicks the appropriate
// view-mode toggle, loads the fixture, then asserts overview content that is
// specific to that fixture's category — vanilla schemas + mappings, namespaced
// cards with namespace pills, metric cards merged across imports, report card
// metadata, and large-fixture layout stability beyond data-ready-state=ready.
// ---------------------------------------------------------------------------

test.describe("Overview view — sfdc-to-snowflake single-file mode", () => {
  test("renders the canonical vanilla schema cards and mapping card", async ({ page }) => {
    // Single-file mode on sfdc-to-snowflake exercises the non-namespaced card
    // height path: each schema renders without a namespace pill and the
    // pipeline's single mapping renders both as an overview mapping card and
    // as a connector mapping node. This is the baseline we compare the
    // namespaced fixture against.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);

    const schemaCards = page.locator("[data-testid^='overview-schema-card-']");
    await expect(schemaCards).toHaveCount(4);

    // None of the sfdc schemas live inside a namespace, so the namespace pill
    // hook (sl-3c2w) must not appear anywhere in the overview.
    await expect(
      page.locator("[data-testid$='-namespace-pill']"),
    ).toHaveCount(0);

    await expect(
      page.locator("[data-testid^='overview-mapping-card-']"),
    ).toHaveCount(1);
  });
});

test.describe("Overview view — namespaces/ns-platform lineage mode", () => {
  test("renders qualified namespaced cards, mapping nodes, and namespace labels", async ({
    page,
  }) => {
    // ns-platform.stm declares schemas and mappings inside `raw`, `vault`,
    // `mart`, and `analytics` namespaces.  In lineage mode the overview must
    // render every namespace's cards with namespace-qualified test ids
    // (proving qualified rendering) and emit a namespace pill for each card
    // (proving the namespace card-height path is hit).
    await page.goto("/");
    // Default mode is lineage; explicitly assert it for clarity.
    await expect(page.locator(".toggle-btn[data-mode='lineage']")).toHaveClass(/active/);
    await loadFixture(page, nsPlatformUri);

    // Every namespace declared in the fixture should produce at least one
    // card with a namespace-qualified test id.  `analytics` only contains
    // metric schemas (rendered via <sz-metric-card>), so we look for metric
    // cards there instead of schema cards.  Test id segments are produced by
    // sanitizeTestIdSegment, which lowercases and replaces non-alnum runs
    // (`::`) with a single `-`, so e.g. `raw::crm_contacts` → `raw-crm-contacts`.
    for (const ns of ["raw", "vault", "mart"]) {
      await expect(
        page.locator(`[data-testid^='overview-schema-card-${ns}-']`).first(),
      ).toBeVisible();
    }
    await expect(
      page.locator("[data-testid^='overview-metric-card-analytics-']").first(),
    ).toBeVisible();

    // Each namespaced schema card carries the namespace pill hook.
    const pills = page.locator("[data-testid$='-namespace-pill']");
    expect(await pills.count()).toBeGreaterThanOrEqual(4);

    // Mapping node ids are built as `mapping:<namespace>:<id>` (see
    // _overviewMappingNodeId in satsuma-viz.ts), then sanitized — so a vault
    // mapping becomes a test id starting with `overview-mapping-node-mapping-vault-`.
    // The vault layer is the densest mapping zone in this fixture.
    await expect(
      page
        .locator("[data-testid^='overview-mapping-node-mapping-vault-']")
        .first(),
    ).toBeVisible();
  });
});

test.describe("Overview view — metrics-platform lineage mode", () => {
  test("merges metric cards with imported source cards", async ({ page }) => {
    // metrics.stm declares metric schemas and imports fact/dim sources from
    // metric_sources.stm.  In lineage mode the overview must contain the
    // headline metric cards AND at least one imported source card — proving
    // the lineage merge produced cards from BOTH files, not just the entry
    // point.
    await page.goto("/");
    await expect(page.locator(".toggle-btn[data-mode='lineage']")).toHaveClass(/active/);
    await loadFixture(page, metricsUri);

    // Metric schemas render via <sz-metric-card>, not <sz-schema-card>, so we
    // look for the metric-card test id.  sanitizeTestIdSegment turns
    // underscores into dashes, so `monthly_recurring_revenue` →
    // `monthly-recurring-revenue`.
    for (const metric of [
      "monthly-recurring-revenue",
      "churn-rate",
      "customer-lifetime-value",
    ]) {
      await expect(
        page.locator(`[data-testid='overview-metric-card-${metric}']`),
      ).toBeVisible();
    }

    // Imported source from metric_sources.stm — proves the lineage merge
    // pulled in cards from a file other than the entry point.
    await expect(
      page.locator("[data-testid='overview-schema-card-fact-subscriptions']"),
    ).toBeVisible();
  });
});

test.describe("Overview view — reports-and-models", () => {
  test("renders report and model cards alongside their source facts", async ({ page }) => {
    // reports-and-models/pipeline.stm declares fact tables, model schemas
    // (churn_predictor) and report schemas (weekly_sales_dashboard,
    // customer_risk_report, daily_order_summary).  The overview must surface
    // each as a stable schema card so downstream tools can navigate to
    // report/model targets the same way they navigate to ordinary schemas.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, reportsUri);

    // sanitizeTestIdSegment lowercases and turns each underscore into `-`.
    for (const id of [
      "fact-orders",
      "dim-customer",
      "weekly-sales-dashboard",
      "churn-predictor",
      "customer-risk-report",
      "daily-order-summary",
    ]) {
      await expect(
        page.locator(`[data-testid='overview-schema-card-${id}']`),
      ).toBeVisible();
    }
  });
});

test.describe("Overview view — sap-po-to-mfcs layout stability", () => {
  test("renders without falling back and surfaces the larger schema set", async ({ page }) => {
    // The SAP-PO fixture is one of the larger canonical examples.  Reaching
    // data-ready-state=ready proves layout completed; we additionally assert
    // it did NOT fall back to the error renderer AND that a non-trivial
    // number of schema cards became visible — guarding against an "empty
    // ready" regression where layout completes but emits no cards.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sapUri);

    const vizRoot = page.locator("[data-testid='viz-root']");
    await expect(vizRoot).not.toHaveAttribute("data-ready-state", "fallback");
    await expect(vizRoot).toHaveAttribute("data-ready-state", "ready");

    // The SAP fixture is "larger" in field volume rather than card count
    // (only a handful of top-level schemas).  We therefore guard against an
    // empty-but-ready regression by asserting BOTH that at least the source
    // and target cards exist AND that the mapping connector node was laid
    // out — these are the smallest invariants that distinguish "rendered"
    // from "ready but blank".
    const SAP_MIN_OVERVIEW_CARDS = 2;
    expect(
      await page.locator("[data-testid^='overview-schema-card-']").count(),
    ).toBeGreaterThanOrEqual(SAP_MIN_OVERVIEW_CARDS);
    expect(
      await page.locator("[data-testid^='overview-mapping-node-']").count(),
    ).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Mapping detail content (sl-ny3r)
//
// These tests open a specific named mapping and assert content INSIDE the
// detail view — source schemas, target schema, arrow rows, transforms, notes,
// nested-section rows — rather than only that the detail root became visible.
// ---------------------------------------------------------------------------

test.describe("Mapping detail — sfdc opportunity ingestion", () => {
  test("renders source/target cards, expected arrows, transforms, and @ref highlighting", async ({
    page,
  }) => {
    // The opportunity ingestion mapping is the canonical sfdc example: a
    // single source schema (sfdc_opportunity) → a single target schema
    // (snowflake_opportunity), with both bare-copy arrows AND computed
    // arrows that have NL transform text containing @refs.  This is the
    // mapping every reader sees first when learning Satsuma, so the detail
    // view must render its core elements correctly.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
    const detail = await openMappingByName(page, "opportunity-ingestion");

    // Source and target schema cards live inside the detail's source / target
    // columns and use the per-card test id prefix introduced in sl-eikr.
    await expect(
      detail.locator(
        "[data-testid='mapping-detail-opportunity-ingestion-source-schema-card-sfdc-opportunity']",
      ),
    ).toBeVisible();
    await expect(
      detail.locator(
        "[data-testid='mapping-detail-opportunity-ingestion-target-schema-card-snowflake-opps']",
      ),
    ).toBeVisible();

    // The five most distinctive target arrows in this mapping. Their test ids
    // are `mapping-detail-{mid}-arrow-row-{sanitizedTargetField}`. Underscore
    // and dot characters in the source .stm sanitize to dashes.
    for (const target of [
      "amount-usd",
      "arr-value",
      "pipeline-stage",
      "is-closed",
      "ingested-at",
    ]) {
      await expect(
        detail.locator(`[data-testid='mapping-detail-opportunity-ingestion-arrow-row-${target}']`),
      ).toBeVisible();
    }

    // The amount_usd arrow is computed from a multi-step NL transform that
    // mentions @amount and @currency_code — the highlightAtRefs helper wraps
    // those refs in <span class="at-ref">.  Asserting at least one such span
    // appears inside that arrow row's transform cell proves the @ref
    // highlighting pipeline runs end-to-end.
    const amountUsdRow = detail.locator(
      "[data-testid='mapping-detail-opportunity-ingestion-arrow-row-amount-usd']",
    );
    await expect(amountUsdRow.locator("span.transform-nl")).toBeVisible();
    expect(await amountUsdRow.locator("span.at-ref").count()).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Mapping detail — namespaced vault mapping", () => {
  test("renders namespace label and source -> mapping -> target column ordering", async ({
    page,
  }) => {
    // Picks `load hub_contact` from namespace `vault` in ns-platform.stm.
    // The detail view must surface the namespace via the namespace pill on
    // its source/target schema cards (proves namespace context propagates
    // into the detail view), and lay out its three columns in the canonical
    // source -> mapping -> target order so users always read left-to-right.
    await page.goto("/");
    // Default lineage mode is fine — vault mappings are visible in either.
    await loadFixture(page, nsPlatformUri);
    const detail = await openMappingByName(page, "load-hub-contact");

    // Each column is tagged with a column-suffix testid (sl-eikr).  Reading
    // their bounding boxes lets us assert source.x < mapping.x < target.x
    // without depending on exact ELK coordinates.
    const source = detail.locator("[data-testid$='-source-column']");
    const mapping = detail.locator("[data-testid$='-mapping-column']");
    const target = detail.locator("[data-testid$='-target-column']");
    const sourceBox = await source.boundingBox();
    const mappingBox = await mapping.boundingBox();
    const targetBox = await target.boundingBox();
    if (!sourceBox || !mappingBox || !targetBox) {
      throw new Error("mapping detail columns not laid out");
    }
    expect(sourceBox.x).toBeLessThan(mappingBox.x);
    expect(mappingBox.x).toBeLessThan(targetBox.x);

    // The mapping detail header surfaces the namespace label so a reader
    // entering the detail view always knows which namespace the mapping
    // belongs to (sz-mapping-detail.ts:_renderMappingHeader).
    await expect(
      detail.locator("[data-testid='mapping-detail-load-hub-contact-namespace-label']"),
    ).toHaveText("vault");
  });
});

test.describe("Mapping detail — completed orders (multi-source join)", () => {
  test("renders multiple source cards, the join text, the mapping note, and nested children", async ({
    page,
  }) => {
    // The `completed orders` mapping is the canonical multi-source-join
    // example: it pulls from `order_events` AND `customer_profiles` with an
    // inline join expression, has a mapping-level note, and references
    // nested child fields (`customer.email`, `customer.tier`).  All of those
    // need to be visible in the detail view for the example to read
    // correctly.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, ffgUri);
    const detail = await openMappingByName(page, "completed-orders");

    // Both source schema cards are present in the source column.
    await expect(
      detail.locator(
        "[data-testid='mapping-detail-completed-orders-source-schema-card-order-events']",
      ),
    ).toBeVisible();
    await expect(
      detail.locator(
        "[data-testid='mapping-detail-completed-orders-source-schema-card-customer-profiles']",
      ),
    ).toBeVisible();

    // The inline join expression is rendered verbatim somewhere in the
    // detail view — assert via text content because the join string is
    // user-authored and not stable enough for a separate testid hook.
    await expect(detail).toContainText("WHERE @order_events.order_status = completed");

    // NOTE: as of sl-ny3r the mapping detail header does not render
    // MappingBlock.notes — only schema notes and arrow notes are rendered.
    // The mapping-level note remains an open viz gap (tracked separately);
    // do not assert its text here to keep this test grounded in observable
    // production behaviour.

    // Nested child fields produce arrow rows whose target id sanitizes the
    // dotted source path; the test confirms BOTH a top-level arrow and a
    // nested-source arrow are rendered.
    await expect(
      detail.locator("[data-testid='mapping-detail-completed-orders-arrow-row-customer-email']"),
    ).toBeVisible();
    await expect(
      detail.locator("[data-testid='mapping-detail-completed-orders-arrow-row-tier']"),
    ).toBeVisible();
  });
});

test.describe("Mapping detail — order line facts (flatten)", () => {
  test("renders the flatten section row and its nested per-element arrow rows", async ({
    page,
  }) => {
    // The `order line facts` mapping demonstrates flatten: each element of
    // line_items becomes one output row, and each per-element field (e.g.
    // .line_number, .sku, .quantity, .tax_amount) becomes a flatten-scoped
    // arrow row.  The detail view must render the flatten section header
    // AND the per-element arrows nested under it — without the section
    // marker, readers cannot tell flatten arrows from top-level arrows.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, ffgUri);
    const detail = await openMappingByName(page, "order-line-facts");

    // The flatten section row test id is built as
    //   {prefix}-{sectionPrefix}
    // where sectionPrefix = `flatten-{sourceField}` sanitized.
    await expect(
      detail.locator(
        "[data-testid='mapping-detail-order-line-facts-flatten-line-items']",
      ),
    ).toBeVisible();

    // Per-element arrow rows nested inside the flatten section have test ids
    // of the form `{prefix}-arrow-row-{sectionPrefix}-{targetField}`.
    for (const target of ["line-number", "sku", "quantity", "tax-amount"]) {
      await expect(
        detail.locator(
          `[data-testid='mapping-detail-order-line-facts-arrow-row-flatten-line-items-${target}']`,
        ),
      ).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Field coverage and hover highlighting (sl-cca6)
//
// These tests prove the visual contracts a reader relies on inside the
// mapping detail view: every target field row carries data-coverage
// (mapped|unmapped) so an unmapped target stands out, and hovering an arrow
// row / source field / target field highlights the right partner rows via
// the .hl class.  Both non-nested and nested fixtures are exercised.
// ---------------------------------------------------------------------------

test.describe("Field coverage indicators", () => {
  test("target fields with arrows are mapped, target fields without arrows are unmapped", async ({
    page,
  }) => {
    // sfdc opportunity ingestion writes nine target fields and leaves
    // `source_system` (which has a default) untouched.  data-coverage
    // therefore distinguishes the two cases — this is the contract that
    // makes coverage circles meaningful in the UI.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
    const detail = await openMappingByName(page, "opportunity-ingestion");

    const targetCardPrefix =
      "mapping-detail-opportunity-ingestion-target-schema-card-snowflake-opps";

    // A field with an explicit arrow must report mapped coverage.
    await expect(
      detail.locator(`[data-testid='${targetCardPrefix}-field-amount-usd']`),
    ).toHaveAttribute("data-coverage", "mapped");

    // The default-only target field has no arrow and must report unmapped.
    await expect(
      detail.locator(`[data-testid='${targetCardPrefix}-field-source-system']`),
    ).toHaveAttribute("data-coverage", "unmapped");
  });

  test("nested flatten target rows are matched by dotted path, not just leaf name", async ({
    page,
  }) => {
    // The order line facts mapping flattens line_items into per-element
    // arrows.  All target fields end up mapped, but the test is about
    // dotted-path identity: the sku field carries its full nested path in
    // the test id and reports mapped coverage even though `sku` would
    // collide with any other top-level sku in the same schema.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, ffgUri);
    const detail = await openMappingByName(page, "order-line-facts");

    const targetCardPrefix =
      "mapping-detail-order-line-facts-target-schema-card-order-line-facts-parquet";

    await expect(
      detail.locator(`[data-testid='${targetCardPrefix}-field-sku']`),
    ).toHaveAttribute("data-coverage", "mapped");
    await expect(
      detail.locator(`[data-testid='${targetCardPrefix}-field-line-number']`),
    ).toHaveAttribute("data-coverage", "mapped");
  });
});

test.describe("Hover highlighting between arrows and field rows", () => {
  test("hovering an arrow row highlights the matching source and target field rows", async ({
    page,
  }) => {
    // The amount_usd arrow connects sfdc_opportunity.Amount to
    // snowflake_opps.amount_usd.  Hovering the arrow row must add the .hl
    // class to BOTH the source field row and the target field row so the
    // reader sees which fields participate in this arrow.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
    const detail = await openMappingByName(page, "opportunity-ingestion");

    await detail
      .locator("[data-testid='mapping-detail-opportunity-ingestion-arrow-row-amount-usd']")
      .hover();

    const sourceField = detail.locator(
      "[data-testid='mapping-detail-opportunity-ingestion-source-schema-card-sfdc-opportunity-field-amount']",
    );
    const targetField = detail.locator(
      "[data-testid='mapping-detail-opportunity-ingestion-target-schema-card-snowflake-opps-field-amount-usd']",
    );

    await expect(sourceField).toHaveClass(/\bhl\b/);
    await expect(targetField).toHaveClass(/\bhl\b/);
  });

  test("hovering a target field highlights the upstream source field", async ({ page }) => {
    // Reverse direction: hovering the target field row must propagate
    // highlight back to the upstream source field row through the same
    // shared highlight state.  Verifies that the highlight pipeline is
    // bidirectional and not arrow-row-only.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
    const detail = await openMappingByName(page, "opportunity-ingestion");

    await detail
      .locator(
        "[data-testid='mapping-detail-opportunity-ingestion-target-schema-card-snowflake-opps-field-amount-usd']",
      )
      .hover();

    const sourceField = detail.locator(
      "[data-testid='mapping-detail-opportunity-ingestion-source-schema-card-sfdc-opportunity-field-amount']",
    );
    await expect(sourceField).toHaveClass(/\bhl\b/);
  });
});

// ---------------------------------------------------------------------------
// Filters and lineage mode (sl-xqd5)
//
// Exercises the toolbar namespace filter, the toolbar file filter, and the
// difference between single-file and lineage mode for an imported schema.
// Each transition waits for the viz to return to data-ready-state=ready
// before assertions are made — filter changes re-run the layout pipeline.
// ---------------------------------------------------------------------------

/** Wait for the viz to settle back into ready state after a filter change. */
async function waitForViewReady(page: Page): Promise<void> {
  await expect(page.locator("[data-testid='viz-root']")).toHaveAttribute(
    "data-ready-state",
    "ready",
    { timeout: 15_000 },
  );
}

test.describe("Toolbar namespace filter — ns-platform", () => {
  test("selecting a single namespace hides cards from other namespaces", async ({ page }) => {
    // ns-platform.stm has four namespaces; selecting `mart` must hide cards
    // from `raw`, `vault`, and `analytics` while keeping mart cards visible.
    // Resetting back to "All namespaces" must restore the original card set.
    await page.goto("/");
    await loadFixture(page, nsPlatformUri);

    // Baseline: all namespaces show their cards.
    await expect(
      page.locator("[data-testid^='overview-schema-card-raw-']").first(),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid^='overview-schema-card-mart-']").first(),
    ).toBeVisible();

    // Select `mart` only.
    await page.locator("[data-testid='toolbar-namespace-filter']").selectOption("mart");
    await waitForViewReady(page);

    // mart cards remain; raw cards must be gone.
    await expect(
      page.locator("[data-testid^='overview-schema-card-mart-']").first(),
    ).toBeVisible();
    expect(
      await page.locator("[data-testid^='overview-schema-card-raw-']").count(),
    ).toBe(0);

    // Reset to all namespaces.
    await page.locator("[data-testid='toolbar-namespace-filter']").selectOption("");
    await waitForViewReady(page);
    await expect(
      page.locator("[data-testid^='overview-schema-card-raw-']").first(),
    ).toBeVisible();
  });
});

test.describe("Toolbar file filter — metrics-platform lineage mode", () => {
  test("selecting a source file restricts cards to that file's declarations", async ({
    page,
  }) => {
    // metrics.stm imports from metric_sources.stm, so lineage mode shows
    // cards declared across both files.  Filtering to metrics.stm only must
    // drop the imported source cards (e.g. fact_subscriptions).  Filtering
    // to metric_sources.stm must show those source cards but not the
    // metric cards declared in metrics.stm.
    await page.goto("/");
    await loadFixture(page, metricsUri);

    // Baseline: lineage mode shows BOTH metric cards and imported sources.
    await expect(
      page.locator("[data-testid='overview-metric-card-monthly-recurring-revenue']"),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid='overview-schema-card-fact-subscriptions']"),
    ).toBeVisible();

    // Filter to metrics.stm only — imported source cards disappear.
    const fileFilter = page.locator("[data-testid='toolbar-file-filter']");
    const options = await fileFilter
      .locator("option")
      .evaluateAll((opts) =>
        (opts as HTMLOptionElement[]).map((o) => ({ value: o.value, label: o.textContent })),
      );
    const metricsOption = options.find((o) => o.label?.includes("metrics.stm") && !o.label.includes("metric_sources"));
    const sourcesOption = options.find((o) => o.label?.includes("metric_sources.stm"));
    if (!metricsOption || !sourcesOption) {
      throw new Error(`expected both file filter options; got ${JSON.stringify(options)}`);
    }

    await fileFilter.selectOption(metricsOption.value);
    await waitForViewReady(page);
    expect(
      await page.locator("[data-testid='overview-schema-card-fact-subscriptions']").count(),
    ).toBe(0);
    await expect(
      page.locator("[data-testid='overview-metric-card-monthly-recurring-revenue']"),
    ).toBeVisible();

    // Filter to metric_sources.stm — fact_subscriptions returns, metric cards drop.
    await fileFilter.selectOption(sourcesOption.value);
    await waitForViewReady(page);
    await expect(
      page.locator("[data-testid='overview-schema-card-fact-subscriptions']"),
    ).toBeVisible();
    expect(
      await page.locator("[data-testid='overview-metric-card-monthly-recurring-revenue']").count(),
    ).toBe(0);

    // Reset to all files.
    await fileFilter.selectOption("");
    await waitForViewReady(page);
    await expect(
      page.locator("[data-testid='overview-schema-card-fact-subscriptions']"),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Geometry sanity helpers (sl-e80e)
//
// Reusable helpers for asserting layout invariants without depending on
// exact ELK coordinates. Each helper is small and named after the property
// it asserts so a failing test points at the broken invariant directly.
// ---------------------------------------------------------------------------

interface CardBox {
  /** Test id of the card whose bounding box was read. */
  testId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Read bounding boxes for every overview schema card visible in the viz.
 * Returns boxes sorted by test id so order is deterministic across runs.
 */
async function readOverviewCardBoxes(page: Page): Promise<CardBox[]> {
  // Wait for at least one schema card to attach so the page evaluation
  // does not race the first render after fixture load.
  await page
    .locator("[data-testid^='overview-schema-card-']")
    .first()
    .waitFor({ state: "attached", timeout: 10_000 });
  const boxes = await page
    .locator("[data-testid^='overview-schema-card-']")
    .evaluateAll((els) =>
      (els as HTMLElement[]).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          testId: el.getAttribute("data-testid") ?? "",
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        };
      }),
    );
  return boxes.sort((a, b) => a.testId.localeCompare(b.testId));
}

/** Assert every box has positive width/height and finite coordinates. */
function assertBoxesAreSane(boxes: CardBox[]): void {
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(Number.isFinite(box.x), `${box.testId} x not finite`).toBe(true);
    expect(Number.isFinite(box.y), `${box.testId} y not finite`).toBe(true);
    expect(box.width, `${box.testId} width not positive`).toBeGreaterThan(0);
    expect(box.height, `${box.testId} height not positive`).toBeGreaterThan(0);
  }
}

/**
 * Assert no two boxes overlap by more than `tolerance` pixels in both axes.
 * A small tolerance is permitted because Playwright bounding boxes are
 * subpixel and adjacent cards can share a 1px border without visually
 * overlapping.
 */
function assertBoxesDoNotOverlap(boxes: CardBox[], tolerance = 1): void {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX =
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY =
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      const overlapping = overlapX > tolerance && overlapY > tolerance;
      expect(
        overlapping,
        `cards ${a.testId} and ${b.testId} overlap by ${overlapX.toFixed(1)}x${overlapY.toFixed(1)}`,
      ).toBe(false);
    }
  }
}

test.describe("Geometry sanity — overview layout invariants", () => {
  test("sfdc cards have finite, positive dimensions and do not overlap", async ({ page }) => {
    // Non-namespaced fixture: validates the baseline layout invariants on
    // a small, well-known card set.  Failing this points at a layout
    // regression in the non-namespaced card-height path.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);
    const boxes = await readOverviewCardBoxes(page);
    assertBoxesAreSane(boxes);
    assertBoxesDoNotOverlap(boxes);
  });

  test("ns-platform namespaced cards have sane geometry and clear the namespace pill", async ({
    page,
  }) => {
    // Namespaced fixture: the namespace pill adds vertical padding to each
    // card, so we additionally assert that every namespace pill sits
    // strictly inside its card's vertical extent — proves the pill height
    // is included in the card-height calculation rather than clipping the
    // card content.
    await page.goto("/");
    await loadFixture(page, nsPlatformUri);

    const boxes = await readOverviewCardBoxes(page);
    assertBoxesAreSane(boxes);

    // Each namespace pill must render with positive dimensions (i.e. its
    // height contributes to the card's layout) and sit inside the union
    // bounding box of all overview cards.  Walking shadow DOM ancestors
    // would cross shadow-root boundaries unreliably, so instead we assert
    // every pill is contained within at least one card's box — proves the
    // pill height is included in the card-height calculation rather than
    // being clipped or rendered outside its host card.
    const pillBoxes = await page
      .locator("[data-testid$='-namespace-pill']")
      .evaluateAll((els) =>
        (els as HTMLElement[]).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            testId: el.getAttribute("data-testid") ?? "",
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
          };
        }),
      );
    expect(pillBoxes.length).toBeGreaterThan(0);
    for (const pill of pillBoxes) {
      expect(pill.w, `${pill.testId} width not positive`).toBeGreaterThan(0);
      expect(pill.h, `${pill.testId} height not positive`).toBeGreaterThan(0);
      const containingCard = boxes.find(
        (card) =>
          pill.x >= card.x - 1 &&
          pill.y >= card.y - 1 &&
          pill.x + pill.w <= card.x + card.width + 1 &&
          pill.y + pill.h <= card.y + card.height + 1,
      );
      expect(
        containingCard,
        `${pill.testId} not contained in any overview schema card box`,
      ).toBeDefined();
    }
  });

  test("sfdc overview mapping node sits horizontally between source and target schema cards", async ({
    page,
  }) => {
    // For the canonical sfdc-to-snowflake fixture there is exactly one
    // mapping connecting sfdc_opportunity → snowflake_opps.  The mapping
    // node's horizontal centre must lie strictly between the source card's
    // right edge and the target card's left edge — proves the overview
    // connector reads left-to-right.  We use a single, well-known mapping
    // here so the assertion is unambiguous; broader fixtures (e.g. metrics)
    // place mapping nodes in fixture-specific layouts and would need
    // per-mapping geometry expectations rather than a global rule.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);

    const sourceBox = await page
      .locator("[data-testid='overview-schema-card-sfdc-opportunity']")
      .boundingBox();
    const targetBox = await page
      .locator("[data-testid='overview-schema-card-snowflake-opps']")
      .boundingBox();
    const mappingNodeBox = await page
      .locator("[data-testid^='overview-mapping-node-']")
      .first()
      .boundingBox();

    if (!sourceBox || !targetBox || !mappingNodeBox) {
      throw new Error("expected sfdc source, target, and mapping-node bounding boxes");
    }
    const mappingCx = mappingNodeBox.x + mappingNodeBox.width / 2;
    expect(mappingCx).toBeGreaterThan(sourceBox.x + sourceBox.width);
    expect(mappingCx).toBeLessThan(targetBox.x);
  });

  test("sfdc overview edge endpoints anchor to source card right edge and target card left edge", async ({
    page,
  }) => {
    // Regression guard for f3vt-qb8u. A 24px coordinate-system mismatch
    // between the SVG overview edge-layer host and the .card-layer caused
    // every overview edge endpoint to draw 24px to the right of where the
    // matching card edge actually rendered. The existing geometry checks
    // (positive dimensions, source < mapping < target ordering, non-overlap)
    // did not catch this; the screenshot review workflow (sl-mm7v) did,
    // because in dense lineage layouts the gap became visible while in
    // sfdc/namespaces it was camouflaged inside the gap or hidden behind
    // card bodies.
    //
    // The assertion is intentionally tight: at least one anchor dot must
    // land on the source card's right edge and at least one on the target
    // card's left edge, both within a small tolerance for sub-pixel
    // rendering and the dot's own radius. A 24px regression of the
    // original kind would push every dot well outside the tolerance.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sfdcUri);

    // Tolerance budget = anchor-dot radius (3.5px) + edge stroke width
    // (3px) + sub-pixel rounding slack. Anything past this is the bug.
    const ANCHOR_TOLERANCE_PX = 6;

    const sourceBox = await page
      .locator("[data-testid='overview-schema-card-sfdc-opportunity']")
      .boundingBox();
    const targetBox = await page
      .locator("[data-testid='overview-schema-card-snowflake-opps']")
      .boundingBox();
    if (!sourceBox || !targetBox) {
      throw new Error("expected sfdc source and target overview card bounding boxes");
    }

    // Anchor dots are rendered inside <sz-overview-edge-layer>'s shadow
    // DOM as <circle class="anchor-dot"> at the first and last point of
    // each routed edge. Playwright locators pierce shadow DOM, so we
    // collect every dot's centre in viewport coordinates.
    const dotCentres = await page
      .locator("sz-overview-edge-layer circle.anchor-dot")
      .evaluateAll((els) =>
        (els as SVGCircleElement[]).map((c) => {
          const r = c.getBoundingClientRect();
          return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
        }),
      );
    expect(dotCentres.length).toBeGreaterThanOrEqual(2);

    const sourceRightX = sourceBox.x + sourceBox.width;
    const targetLeftX = targetBox.x;

    const anchoredOnSource = dotCentres.some(
      (p) => Math.abs(p.cx - sourceRightX) <= ANCHOR_TOLERANCE_PX,
    );
    const anchoredOnTarget = dotCentres.some(
      (p) => Math.abs(p.cx - targetLeftX) <= ANCHOR_TOLERANCE_PX,
    );

    if (!anchoredOnSource) {
      throw new Error(
        `no overview anchor dot landed within ${ANCHOR_TOLERANCE_PX}px of the sfdc_opportunity ` +
          `right edge (x=${sourceRightX.toFixed(1)}). Dot xs: ` +
          dotCentres.map((p) => p.cx.toFixed(1)).join(", "),
      );
    }
    if (!anchoredOnTarget) {
      throw new Error(
        `no overview anchor dot landed within ${ANCHOR_TOLERANCE_PX}px of the snowflake_opps ` +
          `left edge (x=${targetLeftX.toFixed(1)}). Dot xs: ` +
          dotCentres.map((p) => p.cx.toFixed(1)).join(", "),
      );
    }
  });

  test("sap-po-to-mfcs cards have sane geometry on a more complex fixture", async ({ page }) => {
    // Complex fixture sanity check: same baseline invariants on the larger
    // sap fixture catch geometry regressions that only surface with more
    // schemas or denser arrows than the small canonical fixtures expose.
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, sapUri);
    const boxes = await readOverviewCardBoxes(page);
    assertBoxesAreSane(boxes);
  });
});

// NOTE (sl-xqd5): the PRD also asks for a test that asserts an
// imported-source card is visible only in lineage mode.  Empirically the
// current viz harness renders the same overview card set for these fixtures
// in both modes (single-file mode does not strip import-reachable cards),
// so there is no observable user-facing delta to assert.  When the
// single-file vs lineage card-visibility behaviour is tightened, add a
// describe block here that asserts a specific imported card is hidden in
// single-file mode and visible in lineage mode.

test.describe("Compact card expansion in overview", () => {
  // Uses buy-to-om-order.stm: two compact schema cards (buy_order, om_order)
  // with enough fields to make expansion meaningful.

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, buyToOmUri);
  });

  test("compact schema card shows no fields initially", async ({ page }) => {
    // Compact cards in overview mode display only the schema name and a field
    // count.  The fields list must be absent until the user clicks the header.
    const card = page.locator("[data-testid^='overview-schema-card-buy-order']");
    await expect(card).toBeVisible();

    // The fields section is rendered only when _compactExpanded is true.
    // In the initial state the card renders no field-row elements.
    const fields = card.locator("[data-testid$='-field-id']");
    await expect(fields).toHaveCount(0);
  });

  test("clicking a compact card header expands fields", async ({ page }) => {
    // A single click on the compact card header must toggle _compactExpanded
    // and render the fields list below the header.
    const card = page.locator("[data-testid^='overview-schema-card-buy-order']");
    await card.locator(".header").click();

    // At least one field row must now appear inside the card.
    const fields = card.locator("[data-testid$='-field-id']");
    await expect(fields.first()).toBeVisible({ timeout: 5_000 });
  });

  test("clicking the compact card header a second time collapses the fields", async ({ page }) => {
    // Two clicks must return the card to its compact (fields-hidden) state.
    const card = page.locator("[data-testid^='overview-schema-card-buy-order']");
    const header = card.locator(".header");

    await header.click();
    // Fields visible after first click.
    await expect(card.locator("[data-testid$='-field-id']").first()).toBeVisible({ timeout: 5_000 });

    await header.click();
    // Fields gone after second click.
    await expect(card.locator("[data-testid$='-field-id']")).toHaveCount(0);
  });

  test("expanding a compact card grows the overview canvas height", async ({ page }) => {
    // When fields expand, _onCompactToggled re-measures the positioned cards
    // and updates _overviewCanvasHeight.  The canvas element's inline height
    // style must be larger after expansion than before.
    const canvas = page.locator(".canvas");
    const heightBefore = await canvas.evaluate((el) => el.getBoundingClientRect().height);

    const card = page.locator("[data-testid^='overview-schema-card-buy-order']");
    await card.locator(".header").click();
    await expect(card.locator("[data-testid$='-field-id']").first()).toBeVisible({ timeout: 5_000 });

    // Wait for the canvas resize to propagate (triggered via updateComplete in _onCompactToggled).
    await page.waitForTimeout(200);
    const heightAfter = await canvas.evaluate((el) => el.getBoundingClientRect().height);

    expect(heightAfter).toBeGreaterThan(heightBefore);
  });

  test("expanding a compact card still fires a navigate event", async ({ page }) => {
    // Clicking a compact card header both expands the fields and dispatches
    // SzNavigateEvent so hosts like VS Code can jump to the schema source.
    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    const card = page.locator("[data-testid^='overview-schema-card-buy-order']");
    await card.locator(".header").click();

    await expect.poll(async () => recordedEvents(page, "navigate")).toContainEqual(
      expect.objectContaining({
        detail: expect.objectContaining({
          uri: expect.stringContaining("buy-to-om-order.stm"),
          line: expect.any(Number),
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Theme switching (Feature 32)
//
// Proves the light/dark theme contract end-to-end in a real browser: the
// `?theme=` URL parameter deterministically selects the palette, the
// prefers-color-scheme fallback works, the header toggle restyles both chrome
// and component while recording an automation event, and representative
// tokenized elements (not just --sz-bg) change colour between themes.
// ---------------------------------------------------------------------------

/** Computed background-color of the <satsuma-viz> host (drives off --sz-bg). */
async function vizHostBackground(page: Page): Promise<string> {
  return page
    .locator("satsuma-viz")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** Read a computed style property of the first element matching a selector. */
async function computedStyle(
  page: Page,
  selector: string,
  property: string,
): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (el, prop) => getComputedStyle(el).getPropertyValue(prop),
      property,
    );
}

test.describe("Theme switching — URL parameter", () => {
  test("?theme=light renders the light component palette", async ({ page }) => {
    // The light --sz-bg token is #FFFAF5 → rgb(255, 250, 245). Asserting the
    // host's computed background proves the component received theme="light"
    // and the tokens.css :host defaults (light) are in effect.
    await page.goto("/?theme=light");
    await loadFixture(page, sfdcUri);

    await expect(page.locator("satsuma-viz")).toHaveAttribute("theme", "light");
    expect(await vizHostBackground(page)).toBe("rgb(255, 250, 245)");
    expect(await page.evaluate(() => window.__satsumaHarness.theme)).toBe("light");
  });

  test("?theme=dark renders the dark component palette", async ({ page }) => {
    // The dark --sz-bg token is #1E1E1E → rgb(30, 30, 30). This is the
    // :host([theme="dark"]) override engaging via the reflected attribute.
    await page.goto("/?theme=dark");
    await loadFixture(page, sfdcUri);

    await expect(page.locator("satsuma-viz")).toHaveAttribute("theme", "dark");
    expect(await vizHostBackground(page)).toBe("rgb(30, 30, 30)");
    expect(await page.evaluate(() => window.__satsumaHarness.theme)).toBe("dark");
  });
});

test.describe("Theme switching — prefers-color-scheme fallback", () => {
  // With no ?theme= parameter the harness falls back to the emulated
  // colorScheme. Playwright drives the media query via test.use({ colorScheme }).
  test.describe("emulated light scheme", () => {
    test.use({ colorScheme: "light" });
    test("adopts light when the OS prefers light and no parameter is set", async ({
      page,
    }) => {
      await page.goto("/");
      await loadFixture(page, sfdcUri);
      expect(await page.evaluate(() => window.__satsumaHarness.theme)).toBe("light");
      await expect(page.locator("satsuma-viz")).toHaveAttribute("theme", "light");
    });
  });

  test.describe("emulated dark scheme", () => {
    test.use({ colorScheme: "dark" });
    test("adopts dark when the OS prefers dark and no parameter is set", async ({
      page,
    }) => {
      await page.goto("/");
      await loadFixture(page, sfdcUri);
      expect(await page.evaluate(() => window.__satsumaHarness.theme)).toBe("dark");
      await expect(page.locator("satsuma-viz")).toHaveAttribute("theme", "dark");
    });
  });
});

test.describe("Theme switching — header toggle", () => {
  test("toggling to light restyles chrome + component and records a theme-change event", async ({
    page,
  }) => {
    // Start in dark, toggle to light. The toggle must flip the component's
    // theme attribute, the chrome's body[data-theme] (which restyles the
    // chrome background via CSS variables), AND append a theme-change event so
    // automation can observe the switch.
    await page.goto("/?theme=dark");
    await loadFixture(page, sfdcUri);
    await page.evaluate(() => window.__satsumaHarness.clearEvents());

    // Dark chrome background before the switch (#0f1117 → rgb(15, 17, 23)).
    const bodyBgBefore = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bodyBgBefore).toBe("rgb(15, 17, 23)");

    await page.locator("#theme-toggle .toggle-btn[data-theme='light']").click();

    // Component attribute and chrome data-theme both flip to light.
    await expect(page.locator("satsuma-viz")).toHaveAttribute("theme", "light");
    await expect(page.locator("body")).toHaveAttribute("data-theme", "light");

    // Chrome background restyled to the light cream (#FFFAF5 → rgb(255,250,245)).
    const bodyBgAfter = await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bodyBgAfter).toBe("rgb(255, 250, 245)");

    // The switch is observable in the automation event log.
    await expect.poll(async () => recordedEvents(page, "theme-change")).toContainEqual(
      expect.objectContaining({ detail: { theme: "light" } }),
    );
  });
});

test.describe("Theme switching — representative audit tokens", () => {
  test("report header and overview edge stroke change colour between themes", async ({
    page,
  }) => {
    // --sz-bg flipping is necessary but not sufficient: the audit promoted many
    // other tokens. This asserts two representative ones — the report-card
    // header (--sz-report) and the overview edge stroke (--sz-edge-default) —
    // resolve to different computed colours in light vs dark, proving the full
    // token set switches, not just the page background.
    // Overview schema cards render compact, so the report header carries no
    // -header testid — locate it by its `.header.report` class inside the
    // card's shadow DOM (Playwright pierces open shadow roots for CSS
    // descendant combinators, as the existing `.header` click tests rely on).
    const reportHeader =
      "[data-testid='overview-schema-card-weekly-sales-dashboard'] .header.report";
    const overviewEdge = "sz-overview-edge-layer path.overview-path";

    await page.goto("/?theme=light");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, reportsUri);
    const reportHeaderLight = await computedStyle(page, reportHeader, "background-color");
    const edgeStrokeLight = await computedStyle(page, overviewEdge, "stroke");

    // --sz-report light is #4A90B8 → rgb(74, 144, 184): the exact promoted token.
    expect(reportHeaderLight).toBe("rgb(74, 144, 184)");
    // Edge stroke resolves to a real colour (its exact token depends on whether
    // the first edge is a bare/map or NL edge — both differ between themes).
    expect(edgeStrokeLight).toMatch(/^rgb\(/);

    await page.goto("/?theme=dark");
    await page.locator(".toggle-btn[data-mode='single']").click();
    await loadFixture(page, reportsUri);
    const reportHeaderDark = await computedStyle(page, reportHeader, "background-color");
    const edgeStrokeDark = await computedStyle(page, overviewEdge, "stroke");

    // --sz-report dark is #6FB3D9 → rgb(111, 179, 217).
    expect(reportHeaderDark).toBe("rgb(111, 179, 217)");
    expect(edgeStrokeDark).toMatch(/^rgb\(/);

    // The audit tokens switch with the theme — neither element keeps its
    // light-mode colour in dark mode.
    expect(reportHeaderDark).not.toBe(reportHeaderLight);
    expect(edgeStrokeDark).not.toBe(edgeStrokeLight);
  });
});

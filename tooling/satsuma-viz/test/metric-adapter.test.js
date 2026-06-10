// metric-adapter.test.js — metrics resolve as mapping endpoints (sl-cw68).
//
// The mapping detail view and the layout's field-port builder both consume
// metric endpoints through metricAsSchemaCard / metricFieldEntries. These
// tests pin the adaptation contract: every measure field survives with its
// name/type/notes, and the metric-specific declarations (grain, slices,
// filter) surface as metadata pills so the detail view still says "this is a
// metric". A regression here re-opens the empty-TARGET-column bug.
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///metrics.stm", line: 7, character: 0 };

/** A representative metric: label, grain, slices, filter, and two measures. */
const conversionRate = {
  id: "conversion_rate",
  qualifiedId: "conversion_rate",
  label: "Opportunity win rate",
  source: ["fact_opportunities", "dim_stage"],
  grain: "monthly",
  slices: ["pipeline_stage", "region"],
  filter: "is_deleted = false",
  fields: [
    {
      name: "won_count",
      type: "INT64",
      notes: [],
      location: loc,
    },
    {
      name: "win_rate",
      type: "DECIMAL(5,2)",
      notes: [{ text: "won / total", location: loc }],
      location: loc,
    },
  ],
  notes: [],
  comments: [],
  location: loc,
};

describe("metric → schema-card adaptation", () => {
  it("adapts every measure field, preserving name, type, and notes", async () => {
    const { metricFieldEntries } = await import("../dist/satsuma-viz.js");
    const fields = metricFieldEntries(conversionRate);

    assert.equal(fields.length, 2);
    assert.deepEqual(
      fields.map((f) => [f.name, f.type]),
      [["won_count", "INT64"], ["win_rate", "DECIMAL(5,2)"]],
    );
    // Lean MetricFieldEntry has no constraints/comments/children — the
    // adaptation must supply the empty collections schema consumers expect.
    for (const f of fields) {
      assert.deepEqual(f.constraints, []);
      assert.deepEqual(f.comments, []);
      assert.deepEqual(f.children, []);
    }
    assert.equal(fields[1].notes[0].text, "won / total");
  });

  it("presents a metric as a schema card with its declarations as metadata pills", async () => {
    const { metricAsSchemaCard } = await import("../dist/satsuma-viz.js");
    const card = metricAsSchemaCard(conversionRate);

    assert.equal(card.qualifiedId, "conversion_rate");
    assert.equal(card.label, "Opportunity win rate");
    assert.equal(card.fields.length, 2);
    // grain/slices/filter must stay visible — they are what makes the
    // endpoint a metric rather than a table.
    assert.deepEqual(card.metadata, [
      { key: "metric", value: "conversion_rate" },
      { key: "grain", value: "monthly" },
      { key: "slice", value: "pipeline_stage, region" },
      { key: "filter", value: "is_deleted = false" },
    ]);
    // Schema-shaped consumers iterate spreads; a metric has none.
    assert.deepEqual(card.spreads, []);
  });

  it("omits metadata pills for declarations the metric does not have", async () => {
    const { metricAsSchemaCard } = await import("../dist/satsuma-viz.js");
    const bare = { ...conversionRate, label: null, grain: null, slices: [], filter: null };
    const card = metricAsSchemaCard(bare);

    assert.deepEqual(card.metadata, [{ key: "metric", value: "conversion_rate" }]);
    assert.equal(card.label, null);
  });
});

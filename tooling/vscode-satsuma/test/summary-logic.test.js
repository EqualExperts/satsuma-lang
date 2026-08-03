/**
 * summary-logic.test.js — parsing and section formatting of
 * `satsuma summary --json` output (sl-6osm).
 *
 * The "show summary" command previously read fields the CLI never emits
 * (e.g. a `note` on mappings/fragments/transforms/metrics, and `files`
 * instead of `fileCount`), so every section but Schemas silently rendered
 * without its detail and the file count was never printed at all. These
 * tests pin the corrected shape against the CLI's real envelope.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSummaryResponse,
  buildSummarySections,
} = require("../dist/client/commands/summary-logic.js");

/** Minimal one-of-each-section response matching the CLI's real --json shape. */
function sampleResponse() {
  return {
    schemas: [{ name: "customers", fieldCount: 3, note: "PII redacted" }],
    metrics: [{ name: "revenue", fieldCount: 1, displayName: "Revenue", grain: "day" }],
    mappings: [{ name: "load_customers", arrowCount: 2, sources: ["raw"], targets: ["dim"] }],
    fragments: [{ name: "address", fieldCount: 4 }],
    transforms: [{ name: "trim_upper" }],
    fileCount: 2,
  };
}

describe("parseSummaryResponse", () => {
  it("parses a well-formed envelope", () => {
    assert.deepEqual(parseSummaryResponse(JSON.stringify(sampleResponse())), sampleResponse());
  });

  it("returns undefined for unparseable JSON", () => {
    assert.equal(parseSummaryResponse("not json"), undefined);
  });
});

describe("buildSummarySections", () => {
  it("formats a mapping by its real sources/targets/arrowCount, not a fabricated note", () => {
    // The CLI never emits `note` on a mapping — only schemas carry one.
    const [, mappingsSection] = buildSummarySections(sampleResponse());
    assert.equal(mappingsSection.label, "Mappings");
    assert.equal(mappingsSection.items[0], "  load_customers  raw → dim  [2 arrows]");
  });

  it("formats a metric with its display name and grain", () => {
    const sections = buildSummarySections(sampleResponse());
    const metricsSection = sections.find((s) => s.label === "Metrics");
    assert.equal(metricsSection.items[0], '  revenue "Revenue"  [1 field]  grain=day');
  });

  it("formats a schema's note, the one section that actually has one", () => {
    const sections = buildSummarySections(sampleResponse());
    const schemasSection = sections.find((s) => s.label === "Schemas");
    assert.equal(schemasSection.items[0], "  customers  [3 fields] — PII redacted");
  });

  it("omits sections with no items", () => {
    // The original command rendered "Notes"/"Arrows" headings for keys the
    // CLI never populates; sections must disappear entirely when empty,
    // not render as an empty heading.
    const empty = {
      schemas: [],
      metrics: [],
      mappings: [],
      fragments: [],
      transforms: [],
      fileCount: 0,
    };
    assert.deepEqual(buildSummarySections(empty), []);
  });
});

/**
 * coverage-logic.test.js — shaping of mapping-coverage results (sl-89id).
 *
 * The gutter overlay and status bar are driven entirely by these two pure
 * transformations; regressions here mean wrong hover labels, icons on the
 * wrong files, or a wrong coverage percentage in the status bar.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  groupCoverageByUri,
  computeTargetCoverageStats,
} = require("../dist/client/commands/coverage-logic.js");

/** Minimal two-schema coverage result spanning two files. */
function sampleSchemas() {
  return [
    {
      schemaId: "customers",
      role: "source",
      fields: [
        { path: "id", uri: "file:///ws/src.stm", line: 2, mapped: true },
        { path: "internal_note", uri: "file:///ws/src.stm", line: 3, mapped: false },
      ],
    },
    {
      schemaId: "dim_customer",
      role: "target",
      fields: [
        { path: "customer_id", uri: "file:///ws/tgt.stm", line: 5, mapped: true },
        { path: "segment", uri: "file:///ws/tgt.stm", line: 6, mapped: false },
        // Nested path: must appear as a marker but not count toward the
        // status-bar percentage (its parent already counts).
        { path: "address.city", uri: "file:///ws/tgt.stm", line: 7, mapped: true },
      ],
    },
  ];
}

describe("groupCoverageByUri", () => {
  it("groups markers under the file each field lives in", () => {
    // Fields from different schemas land in different files; an icon in the
    // wrong file would mislabel a different schema's field entirely.
    const byUri = groupCoverageByUri(sampleSchemas());
    assert.deepEqual([...byUri.keys()].sort(), [
      "file:///ws/src.stm",
      "file:///ws/tgt.stm",
    ]);
    assert.equal(byUri.get("file:///ws/src.stm").mapped.length, 1);
    assert.equal(byUri.get("file:///ws/src.stm").unmapped.length, 1);
    assert.equal(byUri.get("file:///ws/tgt.stm").mapped.length, 2);
  });

  it("labels hovers by schema role: source usage vs target mapping", () => {
    // A source field is "used", a target field is "mapped" — swapping the
    // vocabulary makes the hover claim the opposite data-flow direction.
    const byUri = groupCoverageByUri(sampleSchemas());
    assert.equal(
      byUri.get("file:///ws/src.stm").mapped[0].hoverMessage,
      "**id** — used as source",
    );
    assert.equal(
      byUri.get("file:///ws/src.stm").unmapped[0].hoverMessage,
      "**internal_note** — not used as source",
    );
    assert.equal(
      byUri.get("file:///ws/tgt.stm").unmapped[0].hoverMessage,
      "**segment** — unmapped",
    );
  });
});

describe("computeTargetCoverageStats", () => {
  it("counts only top-level target fields toward the percentage", () => {
    // address.city is nested: counting it would report 2/3 mapped instead of
    // the 1/2 the user sees at the schema's top level.
    const stats = computeTargetCoverageStats(sampleSchemas());
    assert.deepEqual(stats, { mapped: 1, total: 2, pct: 50 });
  });

  it("returns undefined when the result has no target schema", () => {
    // Without a target there is no meaningful percentage — the status bar
    // must stay hidden rather than show a fabricated 0%.
    const sourceOnly = sampleSchemas().filter((s) => s.role === "source");
    assert.equal(computeTargetCoverageStats(sourceOnly), undefined);
  });

  it("reports 0% for an empty target schema instead of dividing by zero", () => {
    const stats = computeTargetCoverageStats([
      { schemaId: "empty", role: "target", fields: [] },
    ]);
    assert.deepEqual(stats, { mapped: 0, total: 0, pct: 0 });
  });
});

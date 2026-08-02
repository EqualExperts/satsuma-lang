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
        { path: "id", uri: "file:///ws/src.stm", line: 2, mapped: true, state: "covered" },
        {
          path: "internal_note",
          uri: "file:///ws/src.stm",
          line: 3,
          mapped: false,
          state: "uncovered",
        },
      ],
    },
    {
      schemaId: "dim_customer",
      role: "target",
      fields: [
        {
          path: "customer_id",
          uri: "file:///ws/tgt.stm",
          line: 5,
          mapped: true,
          state: "covered",
          tier: "declared",
        },
        { path: "segment", uri: "file:///ws/tgt.stm", line: 6, mapped: false, state: "uncovered" },
        // `address` is a record — structure, not data — so ADR-034 counts its
        // leaf and not the record itself. Three leaf-bearing entries here yield
        // a denominator of 3: customer_id, segment, address.city.
        {
          path: "address",
          uri: "file:///ws/tgt.stm",
          line: 7,
          mapped: true,
          state: "covered",
          tier: "nl",
        },
        {
          path: "address.city",
          uri: "file:///ws/tgt.stm",
          line: 8,
          mapped: true,
          state: "covered",
          tier: "nl",
        },
      ],
    },
  ];
}

describe("groupCoverageByUri", () => {
  it("groups markers under the file each field lives in", () => {
    // Fields from different schemas land in different files; an icon in the
    // wrong file would mislabel a different schema's field entirely.
    const byUri = groupCoverageByUri(sampleSchemas());
    assert.deepEqual([...byUri.keys()].sort(), ["file:///ws/src.stm", "file:///ws/tgt.stm"]);
    assert.equal(byUri.get("file:///ws/src.stm").mapped.length, 1);
    assert.equal(byUri.get("file:///ws/src.stm").unmapped.length, 1);
    // Three mapped entries in tgt.stm: customer_id, the `address` record and
    // address.city. The gutter marks every entry, records included — unlike the
    // percentage, which counts leaves only.
    assert.equal(byUri.get("file:///ws/tgt.stm").mapped.length, 3);
  });

  it("labels hovers by schema role: source usage vs target mapping", () => {
    // A source field is "used", a target field is "mapped" — swapping the
    // vocabulary makes the hover claim the opposite data-flow direction.
    const byUri = groupCoverageByUri(sampleSchemas());
    assert.equal(byUri.get("file:///ws/src.stm").mapped[0].hoverMessage, "**id** — used as source");
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
  it("counts leaves, agreeing with satsuma coverage rather than its own rule", () => {
    // 3cc-t6uo: this counted top-level fields only, so it reported 1/2 (50%)
    // where `satsuma coverage` reported 2/3 (67%) for the same mapping — a
    // twelve-field `address` record counted as one unit, and one mapped leaf read
    // as a fully covered record. Two percentages for one mapping, and a user with
    // the terminal open beside the editor could not tell which was wrong. The
    // count now comes from core's summarizeFieldCoverage.
    const stats = computeTargetCoverageStats(sampleSchemas());
    assert.deepEqual(stats, { mapped: 2, total: 3, pct: 67, mappedNl: 1 });
  });

  it("reports how much of the figure is inferred from prose", () => {
    // ADR-036 would have turned one disagreement into two. The status bar carries
    // the tier split so a reviewer can tell declared coverage from an @ref.
    const declaredOnly = [
      {
        schemaId: "t",
        role: "target",
        fields: [
          {
            path: "a",
            uri: "file:///t.stm",
            line: 1,
            mapped: true,
            state: "covered",
            tier: "declared",
          },
        ],
      },
    ];
    assert.deepEqual(computeTargetCoverageStats(declaredOnly), {
      mapped: 1,
      total: 1,
      pct: 100,
      mappedNl: 0,
    });
  });

  it("returns undefined when the result has no target schema", () => {
    // Without a target there is no meaningful percentage — the status bar
    // must stay hidden rather than show a fabricated 0%.
    const sourceOnly = sampleSchemas().filter((s) => s.role === "source");
    assert.equal(computeTargetCoverageStats(sourceOnly), undefined);
  });

  it("reports 0% for an empty target schema instead of dividing by zero", () => {
    const stats = computeTargetCoverageStats([{ schemaId: "empty", role: "target", fields: [] }]);
    assert.deepEqual(stats, { mapped: 0, total: 0, pct: 0, mappedNl: 0 });
  });
});

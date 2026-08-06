/**
 * mapping-detail-arrow-table.test.js — what the arrow table renders for the two
 * mapping shapes that carry no ordinary source → target row.
 *
 * Both shapes are first-class Satsuma constructs that used to render as absence:
 *
 *   - A consumer mapping (report/model) declares `source {}` and `target {}` and
 *     no arrows at all. The table printed its four column headers over an empty
 *     body, which reads as a half-loaded panel (sl-jetk).
 *   - A target-only arrow (`-> is_closed { "..." }`) has no source field. Its
 *     Source cell was blank, indistinguishable from a source path the viz had
 *     failed to resolve (sl-k7i4).
 *
 * These cases are written against the component's render output because that is
 * where the decision lives — the model already carries the empty `sourceFields`
 * and empty block arrays faithfully. Whether the resulting element is *painted*
 * as intended is a browser question, covered by the viz harness's
 * `mapping-detail-arrow-states.test.ts`.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const LOC = { uri: "file:///test.stm", line: 0, character: 0 };

/** An arrow entry in the viz model's shape; `sourceFields` is the axis under test. */
function arrow(sourceFields, targetField) {
  return {
    sourceFields,
    targetField,
    transform: null,
    metadata: [],
    comments: [],
    location: LOC,
  };
}

/**
 * A mapping block carrying nothing but the arrows under test.
 *
 * Every container list defaults to empty, so a case that passes no arrows is
 * exactly the no-field-arrows consumer shape (sl-jetk) with no further setup.
 */
function mappingBlock(arrows = []) {
  return {
    id: "consumer",
    sourceRefs: ["src"],
    targetRef: "tgt",
    arrows,
    eachBlocks: [],
    flattenBlocks: [],
    nestedArrows: [],
    sourceBlock: null,
    metadata: [],
    notes: [],
    comments: [],
    location: LOC,
  };
}

/**
 * Render the detail view and return its markup as text, with template values
 * interleaved in source order — the same serialization the schema-card tests
 * use, so a value substituted into an attribute or a cell is visible here.
 */
function renderText(detail) {
  const serialize = (value) => {
    if (value == null) return "";
    if (Array.isArray(value)) return value.map(serialize).join("");
    if (typeof value === "object" && value.strings && "values" in value) {
      return value.strings
        .map((s, i) => s + (i < value.values.length ? serialize(value.values[i]) : ""))
        .join("");
    }
    return String(value);
  };
  return serialize(detail.render());
}

/** A detail view bound to `mapping`, with no schema cards to either side. */
async function makeDetail(mapping) {
  const mod = await import("../dist/satsuma-viz.js");
  const detail = new mod.SzMappingDetail();
  detail.mapping = mapping;
  detail.sourceSchemas = [];
  detail.targetSchema = null;
  return detail;
}

describe("arrow table for a mapping with no field arrows (sl-jetk)", () => {
  it("states that the mapping maps whole schemas instead of heading nothing", async () => {
    // The empty state must SAY what the mapping declares. A reader seeing a
    // header row with no rows beneath it cannot tell a legitimate consumer
    // mapping from a panel that failed to load.
    const text = renderText(await makeDetail(mappingBlock()));

    assert.match(text, /arrow-table-empty/);
    assert.match(text, /no field-level arrows/);
  });

  it("omits the column headers when there are no rows to head", async () => {
    // Column headers are only meaningful over rows. Asserting the header text
    // is absent (not merely that the empty state is present) is what pins the
    // fix: an empty state rendered *underneath* a bare header would still be
    // the reported bug.
    const text = renderText(await makeDetail(mappingBlock()));

    assert.doesNotMatch(text, /<th>Source<\/th>/);
    assert.doesNotMatch(text, /<th>Transform<\/th>/);
    assert.doesNotMatch(text, /<th>Target<\/th>/);
  });

  it("keeps the table and its headers as soon as one arrow exists", async () => {
    // The empty branch must be reached only by the genuinely empty mapping —
    // one arrow returns the full table, headers included.
    const text = renderText(await makeDetail(mappingBlock([arrow(["a"], "b")])));

    assert.match(text, /<th>Source<\/th>/);
    assert.match(text, /<th>Target<\/th>/);
    assert.doesNotMatch(text, /arrow-table-empty/);
  });
});

describe("Source cell of a sourceless derived arrow (sl-k7i4)", () => {
  it("names the derived construct rather than leaving the cell blank", async () => {
    // `-> is_closed { "..." }` is a target-only arrow: the value comes from the
    // transform, not from a source field. The cell must say so, because a blank
    // cell is what a dropped source path also looks like.
    const text = renderText(await makeDetail(mappingBlock([arrow([], "is_closed")])));

    assert.match(text, /source-derived/);
    assert.match(text, /derived</);
    // The marker explains itself on hover, so the meaning does not depend on
    // the reader already knowing the construct.
    assert.match(text, /title="No source field: this target is derived from the transform"/);
  });

  it("styles the marker as prose, never as a field path", async () => {
    // Sharing `.field-ref` would make the marker read as a field literally
    // named "derived" and would pick up the highlight treatment meant for real
    // paths. The marker must therefore carry its own class only.
    const text = renderText(await makeDetail(mappingBlock([arrow([], "is_closed")])));
    const sourceCell = text.slice(0, text.indexOf("arrow-icon"));

    assert.doesNotMatch(sourceCell, /field-ref/);
  });

  it("leaves an arrow that does have a source field untouched", async () => {
    // The marker is a substitute for absence, not a decoration: an arrow with a
    // real source renders that path as a field-ref and no marker.
    const text = renderText(await makeDetail(mappingBlock([arrow(["Amount"], "amount_usd")])));

    assert.match(text, /field-ref source-ref-item/);
    assert.match(text, /Amount/);
    assert.doesNotMatch(text, /source-derived/);
  });
});

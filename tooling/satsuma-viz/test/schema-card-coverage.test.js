/**
 * schema-card-coverage.test.js — What the schema card's header ratio counts.
 *
 * The card used to compute its own coverage figures, counting every node —
 * records included — in both numerator and denominator, so one covered leaf
 * lifted the numerator once per ancestor level. `satsuma coverage`, the VS Code
 * status bar and this card then reported three different percentages for one
 * mapping (sl-hcan). ADR-034 settles the rule — leaves only, on each leaf's own
 * flag — and states that consumers must not compute their own denominators.
 *
 * These cases pin the card's end of that: the figures it renders, and the
 * depth-invariance property that makes them comparable between schemas. The
 * counting rule itself is core's, and is tested there.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildCoveredFieldSet } from "@satsuma/core/coverage-paths";

const LOC = { uri: "file:///test.stm", line: 0, character: 0 };

/** A leaf field declaration in the viz model's shape. */
function leaf(name, type = "STRING") {
  return {
    name,
    type,
    constraints: [],
    metadata: [],
    notes: [],
    comments: [],
    children: [],
    location: LOC,
  };
}

/** A record field declaration wrapping the given children. */
function record(name, children) {
  return { ...leaf(name, "record"), children };
}

/** A schema card payload carrying nothing but the fields under test. */
function schemaCard(fields) {
  return {
    id: "tgt",
    qualifiedId: "tgt",
    kind: "schema",
    label: null,
    fields,
    notes: [],
    comments: [],
    metadata: [],
    location: LOC,
    hasExternalLineage: false,
    spreads: [],
  };
}

/**
 * Render a card and return its markup as text, with template values
 * interleaved in source order — the ratio is `${covered}/${total}`, so only an
 * interleaved serialization can tell "1/4" from "4/1".
 */
function renderText(card) {
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
  return serialize(card.render());
}

/** A card bound to `fields`, with `covered` schema-local paths marked mapped. */
async function makeCard(fields, covered = [], { compact = false } = {}) {
  const mod = await import("../dist/satsuma-viz.js");
  const card = new mod.SzSchemaCard();
  card.schema = schemaCard(fields);
  card.mappedFields = buildCoveredFieldSet(covered);
  card.compact = compact;
  return card;
}

// The figure named in sl-hcan: one scalar beside a three-leaf record, with a
// single leaf of that record covered.
const AMOUNT_AND_ADDRESS = [
  leaf("amount", "DECIMAL"),
  record("address", [leaf("city"), leaf("line1"), leaf("postcode")]),
];

describe("sz-schema-card header ratio (sl-hcan)", () => {
  it("counts leaves only, excluding the record that contains them", async () => {
    // 1 of 4 leaves — not 2 of 5, which is what counting `address` itself in
    // both halves produced. The old figure claimed 40% coverage of a schema
    // `satsuma coverage` reports as 25%.
    const card = await makeCard(AMOUNT_AND_ADDRESS, ["address.city"]);
    assert.match(renderText(card), /header-count[^>]*>1\/4</);
  });

  it("reports the same ratio however deeply the same leaves are nested", async () => {
    // Depth invariance is what makes one card's percentage comparable with
    // another's. Counting containers broke it: re-nesting four leaves three
    // levels deep moved the denominator without a field being added.
    const flat = await makeCard([leaf("a"), leaf("b"), leaf("c"), leaf("d")], ["a"]);
    const deep = await makeCard(
      [
        leaf("a"),
        record("outer", [leaf("b"), record("mid", [leaf("c"), record("in", [leaf("d")])])]),
      ],
      ["a"],
    );
    assert.match(renderText(flat), /header-count[^>]*>1\/4</);
    assert.match(renderText(deep), /header-count[^>]*>1\/4</);
  });

  it("names partly mapped records in the tooltip, keeping them out of the ratio", async () => {
    // Containers are excluded from the percentage, so the count beside it is
    // the only place a reviewer learns that a record needs attention. A record
    // with one covered and two uncovered leaves is the reviewable state.
    const card = await makeCard(AMOUNT_AND_ADDRESS, ["address.city"]);
    assert.match(renderText(card), /1\/4 leaf fields mapped \(25%\) — 1 record partly mapped/);
  });

  it("says nothing about records when none is partly mapped", async () => {
    // A fully covered or wholly uncovered record is already legible from the
    // field rows; only the partial state is worth a phrase.
    const card = await makeCard(AMOUNT_AND_ADDRESS, [
      "address.city",
      "address.line1",
      "address.postcode",
    ]);
    const text = renderText(card);
    assert.match(text, /3\/4 leaf fields mapped \(75%\)/);
    assert.doesNotMatch(text, /partly mapped/);
  });

  it("counts fields the same way on a compact card as on an expanded one", async () => {
    // One card must not answer "how many fields?" two ways depending on which
    // form it is rendered in — the compact header showed 5 for the schema the
    // expanded header denominated in 4.
    const card = await makeCard(AMOUNT_AND_ADDRESS, [], { compact: true });
    assert.match(renderText(card), /header-count[^>]*>4 fields</);
  });
});

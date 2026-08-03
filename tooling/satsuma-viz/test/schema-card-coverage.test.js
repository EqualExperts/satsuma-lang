/**
 * schema-card-coverage.test.js — What the schema card does with core's verdicts.
 *
 * The card used to work coverage out for itself, and lost a rule each time one
 * was added: counting every node — records included — in both halves of the
 * ratio (sl-hcan), then deriving covered paths from the model's arrows, which
 * cannot see the NL `@ref` tier or whole-structure conferral (sl-46wr, sl-csrs).
 * It now receives `FieldCoverageEntry[]` from `@satsuma/core` and only renders
 * them, so these cases are written the same way: *given* these verdicts, this is
 * what the card must show.
 *
 * The verdicts are therefore hand-written rather than computed. Whether core
 * produces them correctly is core's own test, and asserting it again here would
 * test the same invariant twice; what is only testable here is the rendering —
 * that leaves alone reach the ratio, that container state reaches the tooltip
 * and not the number, and that the tier is visible at all.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

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
 * Coverage entries as core emits them, from `[path, state, tier?]` triples.
 *
 * Declarative on purpose: the card is a renderer of these, so a test states the
 * verdicts it is rendering rather than deriving them and re-testing the
 * derivation. `mapped` is `state !== "uncovered"`, core's own invariant.
 */
function entries(...specs) {
  return specs.map(([path, state, tier]) => ({
    path,
    uri: LOC.uri,
    mapped: state !== "uncovered",
    state,
    ...(tier ? { tier } : {}),
  }));
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

/** A card bound to `fields`, reporting `coverage`. */
async function makeCard(fields, coverage = [], { compact = false } = {}) {
  const mod = await import("../dist/satsuma-viz.js");
  const card = new mod.SzSchemaCard();
  card.schema = schemaCard(fields);
  card.coverage = coverage;
  card.compact = compact;
  return card;
}

// The figure named in sl-hcan: one scalar beside a three-leaf record, with a
// single leaf of that record covered.
const AMOUNT_AND_ADDRESS = [
  leaf("amount", "DECIMAL"),
  record("address", [leaf("city"), leaf("line1"), leaf("postcode")]),
];

/** Coverage of AMOUNT_AND_ADDRESS with only `address.city` covered. */
const ONLY_CITY = entries(
  ["amount", "uncovered"],
  ["address", "partial", "declared"],
  ["address.city", "covered", "declared"],
  ["address.line1", "uncovered"],
  ["address.postcode", "uncovered"],
);

describe("sz-schema-card header ratio (sl-hcan)", () => {
  it("counts leaves only, excluding the record that contains them", async () => {
    // 1 of 4 leaves — not 2 of 5, which is what counting `address` itself in
    // both halves produced. The old figure claimed 40% coverage of a schema
    // `satsuma coverage` reports as 25%.
    const card = await makeCard(AMOUNT_AND_ADDRESS, ONLY_CITY);
    assert.match(renderText(card), /header-count[^>]*>1\/4</);
  });

  it("reports the same ratio however deeply the same leaves are nested", async () => {
    // Depth invariance is what makes one card's percentage comparable with
    // another's. Counting containers broke it: re-nesting four leaves three
    // levels deep moved the denominator without a field being added.
    const flat = await makeCard(
      [leaf("a"), leaf("b"), leaf("c"), leaf("d")],
      entries(
        ["a", "covered", "declared"],
        ["b", "uncovered"],
        ["c", "uncovered"],
        ["d", "uncovered"],
      ),
    );
    const deep = await makeCard(
      [
        leaf("a"),
        record("outer", [leaf("b"), record("mid", [leaf("c"), record("in", [leaf("d")])])]),
      ],
      entries(
        ["a", "covered", "declared"],
        ["outer", "uncovered"],
        ["outer.b", "uncovered"],
        ["outer.mid", "uncovered"],
        ["outer.mid.c", "uncovered"],
        ["outer.mid.in", "uncovered"],
        ["outer.mid.in.d", "uncovered"],
      ),
    );
    assert.match(renderText(flat), /header-count[^>]*>1\/4</);
    assert.match(renderText(deep), /header-count[^>]*>1\/4</);
  });

  it("names partly mapped records in the tooltip, keeping them out of the ratio", async () => {
    // Containers are excluded from the percentage, so the count beside it is
    // the only place a reviewer learns that a record needs attention. A record
    // with one covered and two uncovered leaves is the reviewable state.
    const card = await makeCard(AMOUNT_AND_ADDRESS, ONLY_CITY);
    assert.match(renderText(card), /1\/4 leaf fields mapped \(25%\) — 1 record partly mapped/);
  });

  it("says nothing about records when none is partly mapped", async () => {
    // A fully covered or wholly uncovered record is already legible from the
    // field rows; only the partial state is worth a phrase.
    const card = await makeCard(
      AMOUNT_AND_ADDRESS,
      entries(
        ["amount", "uncovered"],
        ["address", "covered", "declared"],
        ["address.city", "covered", "declared"],
        ["address.line1", "covered", "declared"],
        ["address.postcode", "covered", "declared"],
      ),
    );
    const text = renderText(card);
    assert.match(text, /3\/4 leaf fields mapped \(75%\)/);
    assert.doesNotMatch(text, /partly mapped/);
  });

  it("counts fields the same way on a compact card as on an expanded one", async () => {
    // One card must not answer "how many fields?" two ways depending on which
    // form it is rendered in — the compact header showed 5 for the schema the
    // expanded header denominated in 4.
    const card = await makeCard(
      AMOUNT_AND_ADDRESS,
      entries(
        ["amount", "uncovered"],
        ["address", "uncovered"],
        ["address.city", "uncovered"],
        ["address.line1", "uncovered"],
        ["address.postcode", "uncovered"],
      ),
      { compact: true },
    );
    assert.match(renderText(card), /header-count[^>]*>4 fields</);
  });
});

// ── Rendering core's tri-state and tier (sl-46wr, sl-csrs) ──────────────────
//
// The card received a single boolean per path until these tickets, so a field
// covered only by a resolved `@ref` was indistinguishable from one no arrow and
// no prose touches — it simply read as unmapped. ADR-036 requires a consumer to
// render the declared/NL distinction rather than reconstruct it, which it
// cannot do from a boolean at all.

describe("sz-schema-card renders the verdict it was given", () => {
  it("marks a leaf covered only by a resolved @ref as mapped, and says so", async () => {
    // The `tax_amount` case from sl-46wr: the CLI tags it tier=nl and the card
    // used to show it as a gap. It must now read as mapped *and* be
    // distinguishable from a declared hop.
    const card = await makeCard(
      [leaf("tax_amount", "DECIMAL")],
      entries(["tax_amount", "covered", "nl"]),
    );
    const text = renderText(card);
    assert.match(text, /data-coverage="?mapped/);
    assert.match(text, /data-coverage-tier="?nl/);
    assert.match(text, /mapped via an @ref in prose/);
  });

  it("distinguishes a partly covered record from a fully covered one", async () => {
    // Both render a filled port dot, because "something under here is mapped"
    // is the threshold the dot has always painted on. Only the tri-state
    // attribute and the tooltip can tell them apart, so both must carry it.
    const card = await makeCard(AMOUNT_AND_ADDRESS, ONLY_CITY);
    const text = renderText(card);
    assert.match(text, /data-coverage-state="?partial/);
    assert.match(text, /partly mapped/);
  });

  it("renders every row unmarked when given no coverage at all", async () => {
    // A model assembled without a workspace index carries no coverage. That is
    // "not computed", not "nothing is mapped", so the card must not claim a
    // verdict it was never given — and must not crash looking one up.
    const card = await makeCard(AMOUNT_AND_ADDRESS, []);
    const text = renderText(card);
    assert.match(text, /data-coverage="?unmapped/);
    assert.doesNotMatch(text, /data-coverage-tier="?(nl|declared)/);
  });
});

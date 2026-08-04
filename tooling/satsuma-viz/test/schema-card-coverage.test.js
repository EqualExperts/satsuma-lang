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

/**
 * A card bound to `fields`, reporting `coverage`.
 *
 * `null` — "not computed" — is the default, so a case that forgets to supply
 * verdicts cannot accidentally assert against zeroes.
 */
async function makeCard(
  fields,
  coverage = null,
  { compact = false, coverageOverlay = false } = {},
) {
  const mod = await import("../dist/satsuma-viz.js");
  const card = new mod.SzSchemaCard();
  card.schema = schemaCard(fields);
  card.coverage = coverage;
  card.compact = compact;
  card.coverageOverlay = coverageOverlay;
  return card;
}

describe("sz-schema-card compact coverage overlay (sl-5m9x)", () => {
  it("shows exact mapped counts and percentage with proportional header fill", async () => {
    // A 1/2 result must expose the same 50% in text and paint width: text keeps
    // the overlay accessible without colour, while the CSS variable changes
    // paint only and cannot alter the card's measured geometry.
    const card = await makeCard(
      [leaf("mapped"), leaf("gap")],
      entries(["mapped", "covered", "declared"], ["gap", "uncovered"]),
      { compact: true, coverageOverlay: true },
    );
    const text = renderText(card);
    assert.match(text, /header-count[^>]*>1\/2</);
    assert.match(text, /coverage-badge[^>]*[\s\S]*50%/);
    assert.match(text, /data-coverage-percent="?50/);
    assert.match(text, /--sz-coverage-percent: 50%/);
    assert.match(text, /class="coverage-fill"/);
  });

  it("renders complete coverage as exactly 100 percent", async () => {
    // Exact completion must not be rounded from a near-complete value; core's
    // percentage contract reserves 100 for genuinely complete coverage.
    const card = await makeCard(
      [leaf("a"), leaf("b")],
      entries(["a", "covered", "declared"], ["b", "covered", "nl"]),
      { compact: true, coverageOverlay: true },
    );
    const text = renderText(card);
    assert.match(text, /header-count[^>]*>2\/2</);
    assert.match(text, /coverage-badge[^>]*[\s\S]*100%/);
  });

  it("keeps the existing field count when the overlay is off", async () => {
    // Off is the backward-compatible default: supplying coverage alone must
    // not change overview card text or add the proportional fill layer.
    const card = await makeCard(
      [leaf("a"), leaf("b")],
      entries(["a", "covered", "declared"], ["b", "uncovered"]),
      { compact: true },
    );
    const text = renderText(card);
    assert.match(text, /2 fields/);
    assert.doesNotMatch(text, /coverage-badge/);
    assert.doesNotMatch(text, /class="coverage-fill"/);
  });
});

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
    // The tri-state attribute and the tooltip are the machine-readable and the
    // detailed forms of the distinction; the port class below is the one a reader
    // sees without hovering. All three must carry it.
    const card = await makeCard(AMOUNT_AND_ADDRESS, ONLY_CITY);
    const text = renderText(card);
    assert.match(text, /data-coverage-state="?partial/);
    assert.match(text, /partly mapped/);
  });
  it("shows a field count instead of a ratio when coverage was not computed", async () => {
    // `null` is "not computed", not "nothing is mapped" — a model assembled
    // without a workspace index, or a cached payload from an older host. The
    // header must not print `0/4`, which asserts a completeness figure nobody
    // measured and is indistinguishable from a genuinely unmapped schema. The
    // count itself still comes from core, in leaves (ADR-034), so it agrees with
    // the denominator a ratio would have used.
    const card = await makeCard(AMOUNT_AND_ADDRESS, null);
    const text = renderText(card);
    assert.match(text, /header-count[^>]*>4 fields</);
    assert.doesNotMatch(text, /header-count[^>]*>0\/4</);
    assert.match(text, /data-coverage-available="?false/);
    assert.match(text, /Coverage not computed/);
  });

  it("marks rows as unknown, not unmapped, when coverage was not computed", async () => {
    // The rows have to agree with the header. Collapsing "not computed" to the
    // `unmapped` verdict made every field read as a gap directly beneath a header
    // saying no figure existed — and left automation unable to tell those rows
    // from genuine uncovered results. `unknown` is a third state, so both a reader
    // and a test can see there is no verdict.
    const card = await makeCard(AMOUNT_AND_ADDRESS, null);
    const text = renderText(card);
    assert.match(text, /data-coverage="?unknown/);
    assert.match(text, /data-coverage-state="?unknown/);
    assert.doesNotMatch(text, /data-coverage="?unmapped/);
    assert.doesNotMatch(text, /data-coverage-state="?uncovered/);
    assert.doesNotMatch(text, /data-coverage-tier="?(nl|declared)/);
    assert.match(text, /coverage not computed/);
    // The dot has to agree too: `unknown` gets its own faded, dashed style, and
    // must not borrow the hollow ring a reader reads as a measured gap.
    assert.match(text, /class="port unknown"/);
    assert.doesNotMatch(text, /class="port (unmapped|mapped|partial)"/);
  });

  it("keeps unmapped for a real uncovered verdict", async () => {
    // The counterpart: `unknown` must not swallow the genuine case, or the
    // distinction is useless in the other direction.
    const card = await makeCard(
      AMOUNT_AND_ADDRESS,
      entries(
        ["amount", "uncovered"],
        ["address", "uncovered"],
        ["address.city", "uncovered"],
        ["address.line1", "uncovered"],
        ["address.postcode", "uncovered"],
      ),
    );
    const text = renderText(card);
    assert.match(text, /data-coverage="?unmapped/);
    assert.match(text, /data-coverage-state="?uncovered/);
    assert.doesNotMatch(text, /data-coverage="?unknown/);
  });

  it("still shows 0/N when coverage says nothing is covered", async () => {
    // The distinction the case above exists for: a schema no mapping references
    // has a real answer, and the card must give the number rather than fall back
    // to the count.
    const card = await makeCard(
      AMOUNT_AND_ADDRESS,
      entries(
        ["amount", "uncovered"],
        ["address", "uncovered"],
        ["address.city", "uncovered"],
        ["address.line1", "uncovered"],
        ["address.postcode", "uncovered"],
      ),
    );
    const text = renderText(card);
    assert.match(text, /header-count[^>]*>0\/4</);
    assert.match(text, /data-coverage-available="?true/);
  });
});

// ── The port dot (sl-f0x6) ──────────────────────────────────────────────────
//
// The dot was chosen from `entry.mapped`, which is true for `covered` *and*
// `partial`, so a record with one covered leaf out of three looked exactly like
// one with all three covered: the state core computes and the payload carries was
// discarded at the last rendering step, and partial coverage reached a reader only
// by hovering the exact row. These cases pin the dot to the state instead.

describe("sz-schema-card port dot", () => {
  it("gives each of the three coverage states its own port class", async () => {
    // One card, all three states: `address.city` covered, `amount` uncovered and
    // `address` partial between them. Distinct classes are what lets a reader tell
    // the states apart at a glance, so the property under test is that no two
    // states share one — `partial` collapsing into `mapped` is the defect.
    const text = renderText(await makeCard(AMOUNT_AND_ADDRESS, ONLY_CITY));
    const classes = [...text.matchAll(/class="port ([a-z]+)"/g)].map((m) => m[1]);
    // Declaration order: amount, address, address.city, address.line1, .postcode.
    assert.deepEqual(classes, ["unmapped", "partial", "mapped", "unmapped", "unmapped"]);
  });

  it("styles every port class it renders", async () => {
    // A class with no rule behind it renders an unstyled dot — the same defect
    // reintroduced from the CSS side, and invisible to the case above. Pairing
    // each class with its own selector is what makes the classes distinct on
    // screen; this fails if a state is added to the class map without a style.
    const mod = await import("../dist/satsuma-viz.js");
    const cssText = [mod.SzSchemaCard.styles].flat().join("\n");
    for (const portClass of ["mapped", "partial", "unmapped", "unknown"]) {
      assert.match(cssText, new RegExp(`\\.port\\.${portClass}\\s*{`), `no rule for ${portClass}`);
    }
  });
});

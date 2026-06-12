/**
 * minimap.test.js — minimap input per view mode (fmo-fghl).
 *
 * The minimap regressed in two ways: the overview's minimap was clipped
 * off-screen by consumer CSS overriding :host layout, and the mapping detail
 * view fed the minimap the full-canvas ELK layout instead of the rendered
 * detail content. These tests pin the template-level contract for each view
 * mode: which MinimapModel each branch draws from, and that all content is
 * wrapped in the consumer-proof .viz-shell. Visual clamping itself needs a
 * browser and is covered by the viz-harness Playwright suite.
 */
import "./dom-shim.js";
import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///test.stm", line: 1, character: 0 };
const field = (name, type = "STRING") => ({ name, type, constraints: [], notes: [], comments: [], children: [], location: loc });
const arrow = (source, target) => ({ sourceFields: [source], targetField: target, transform: null, metadata: [], comments: [], location: loc });
const schema = (id, fields) => ({ id, qualifiedId: id, kind: "schema", label: null, fields, notes: [], comments: [], metadata: [], location: loc, hasExternalLineage: false, spreads: [] });
const mapping = (id, sourceRefs, targetRef, arrows) => ({ id, sourceRefs, targetRef, arrows, eachBlocks: [], flattenBlocks: [], sourceBlock: null, notes: [], comments: [], location: loc });

const model = {
  uri: "file:///test.stm",
  fileNotes: [],
  namespaces: [{
    name: null,
    notes: [],
    schemas: [schema("src_users", [field("id"), field("email")]), schema("tgt_users", [field("user_id"), field("email")])],
    fragments: [],
    metrics: [],
    mappings: [mapping("users_map", ["src_users"], "tgt_users", [arrow("id", "user_id"), arrow("email", "email")])],
  }],
};

/** Flatten a lit TemplateResult tree to a string for structural assertions. */
function serialize(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(serialize).join("");
  if (typeof v === "object" && "strings" in v && "values" in v) {
    let out = "";
    for (let i = 0; i < v.strings.length; i++) {
      out += v.strings[i];
      if (i < v.values.length) out += serialize(v.values[i]);
    }
    return out;
  }
  if (typeof v === "function") return "[fn]";
  return String(v);
}

/** Count minimap object <rect>s in serialized render output. */
function countMinimapRects(out) {
  const start = out.indexOf('data-testid="viz-minimap"');
  if (start === -1) return null;
  const end = out.indexOf("</svg>", start);
  return out.slice(start, end).split("<rect").length - 1;
}

describe("minimap inputs per view mode", () => {
  let mod;
  let detailLayout;
  let overviewLayout;

  before(async () => {
    mod = await import("../dist/satsuma-viz.js");
    detailLayout = await mod.computeLayout(model);
    overviewLayout = await mod.computeOverviewLayout(model, { expandedSchemaIds: new Set() });
  });

  /** Build a SatsumaViz with layouts injected, bypassing the async lifecycle. */
  function makeViz() {
    const el = new mod.SatsumaViz();
    el.model = model;
    el._layout = detailLayout;
    el._overviewLayout = overviewLayout;
    return el;
  }

  it("wraps every render branch in .viz-shell so consumer host CSS cannot collapse the layout", () => {
    // Consumer pages set `satsuma-viz { display: block }`, which overrides
    // :host { display: flex } and used to break viewport clamping. The shell
    // div must be present in all branches — content and empty alike.
    const el = makeViz();
    assert.match(serialize(el.render()), /class="viz-shell"/);

    const empty = new mod.SatsumaViz();
    assert.match(serialize(empty.render()), /class="viz-shell"/);
  });

  it("draws the overview minimap from the overview layout nodes", () => {
    // One rect per overview card (2 schemas + 1 mapping pill) — not the
    // field-level detail layout's node set.
    const el = makeViz();
    el._viewMode = "overview";
    const out = serialize(el.render());
    assert.equal(countMinimapRects(out), overviewLayout.nodes.length);
  });

  it("renders no minimap in mapping detail until the detail DOM has been measured", () => {
    // Regression guard: the detail branch used to pass the full-canvas ELK
    // layout (this._layout) to the minimap, showing overview-like objects
    // unrelated to the detail content. With no measurement available the
    // minimap must be absent, never wrong.
    const el = makeViz();
    el._viewMode = "detail";
    el._selectedMapping = model.namespaces[0].mappings[0];
    const out = serialize(el.render());
    assert.ok(out.includes("sz-mapping-detail"), "expected the detail branch to render");
    assert.equal(countMinimapRects(out), null);
  });

  it("draws the mapping-detail minimap from measured detail boxes", () => {
    // The measured MinimapModel (source card, mapping column, target card)
    // is the only legal input for the detail minimap.
    const el = makeViz();
    el._viewMode = "detail";
    el._selectedMapping = model.namespaces[0].mappings[0];
    el._detailMinimap = {
      width: 900,
      height: 400,
      rects: [
        { x: 16, y: 16, width: 260, height: 180 },
        { x: 300, y: 16, width: 280, height: 320 },
        { x: 620, y: 16, width: 260, height: 200 },
      ],
    };
    const out = serialize(el.render());
    assert.equal(countMinimapRects(out), 3);
  });

  it("clears the measured detail minimap when leaving the detail view", () => {
    // A stale measurement from a previously open mapping must not survive a
    // return to the overview, where the minimap is layout-driven.
    const el = makeViz();
    el._viewMode = "overview";
    el._detailMinimap = { width: 1, height: 1, rects: [] };
    el._measureDetailMinimap();
    assert.equal(el._detailMinimap, null);
  });
});

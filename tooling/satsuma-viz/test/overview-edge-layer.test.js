/**
 * overview-edge-layer.test.js — overview edges are click-interactive.
 *
 * The edge layer's documented contract is that clicking an edge dispatches
 * SzOpenMappingEvent, which <satsuma-viz> turns into "open the mapping
 * detail view". The click handler was lost in a routing rework, leaving the
 * event class exported, the listener registered, and edges hover-only
 * (sl-sewl). These tests pin the restored contract.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///pipeline.stm", line: 3, character: 0 };

const mapping = {
  id: "orders_load",
  sourceRefs: ["orders_raw"],
  targetRef: "orders",
  arrows: [],
  eachBlocks: [],
  flattenBlocks: [],
  sourceBlock: null,
  metadata: [],
  notes: [],
  comments: [],
  location: loc,
};

const edge = {
  id: "overview:mapping:_:orders_load:in:orders_raw",
  sourceNode: "orders_raw",
  targetNode: "mapping:_:orders_load",
  points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
  mapping,
};

describe("sz-overview-edge-layer click contract (sl-sewl)", () => {
  it("dispatches SzOpenMappingEvent carrying the edge's mapping on edge click", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    const layer = new mod.SzOverviewEdgeLayer();
    const opened = [];
    layer.addEventListener("open-mapping", (e) => opened.push(e));

    layer._onEdgeClick(edge);

    assert.equal(opened.length, 1, "edge click must dispatch the open-mapping event");
    assert.equal(opened[0].mapping.id, "orders_load", "the event must carry the clicked edge's mapping");
    assert.ok(opened[0] instanceof mod.SzOpenMappingEvent);
  });

  it("declares the event as composed and bubbling so it crosses the layer's shadow root", async () => {
    // <satsuma-viz> listens on itself, several shadow boundaries above the
    // SVG path — a non-composed event would never arrive, making the
    // contract dead again in a way unit clicks can't see.
    const mod = await import("../dist/satsuma-viz.js");
    const e = new mod.SzOpenMappingEvent(mapping);
    assert.equal(e.bubbles, true);
    assert.equal(e.composed, true);
    assert.equal(e.type, "open-mapping");
  });

  it("binds the click handler to every rendered edge path", async () => {
    // Pins that _onEdgeClick is actually wired into the template — the
    // original regression was a handler existing in spirit but absent from
    // the markup.
    const mod = await import("../dist/satsuma-viz.js");
    const layer = new mod.SzOverviewEdgeLayer();
    layer.edges = [edge];
    const tpl = layer.render();
    const serialize = (t) => {
      if (t == null || typeof t !== "object") return String(t ?? "");
      if (Array.isArray(t)) return t.map(serialize).join(" ");
      if (t.strings && t.values) return [...t.strings, ...t.values.map(serialize)].join(" ");
      return String(t);
    };
    const markup = serialize(tpl);
    assert.match(markup, /@click/, "edge path template must bind a click handler");
  });
});

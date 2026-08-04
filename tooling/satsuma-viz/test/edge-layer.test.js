/**
 * edge-layer.test.js — field hover highlights the concrete rendered edge.
 *
 * A multi-source arrow shares one ArrowEntry across several physical lines. The
 * edge layer must use each LayoutEdge's resolved endpoint, not the shared authored
 * source list, or hovering either source highlights every sibling line.
 */
import "./dom-shim.js";
import { before, describe, it } from "node:test";
import * as assert from "node:assert/strict";

/** @type {typeof import("../dist/satsuma-viz.js")} */
let edgeLayerModule;

before(async () => {
  edgeLayerModule = await import("../dist/satsuma-viz.js");
});

/** Metadata shared by both physical lines of one authored multi-source arrow. */
const arrow = {
  sourceFields: ["s0.field_0", "s1.field_0"],
  targetField: "field_0",
  transform: null,
  metadata: [],
  comments: [],
  location: { uri: "file:///multi-source.stm", line: 10, character: 2 },
};

/** Build one concrete line from a schema-local source endpoint. */
function edgeFrom(sourceNode) {
  return {
    id: `m0:arrow:0:${sourceNode}`,
    sourceNode,
    targetNode: "s2",
    sourceField: "field_0",
    targetField: "field_0",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    arrow,
  };
}

describe("field-edge highlighting", () => {
  it("highlights only the physical line attached to the hovered source", () => {
    // Both lines share the same ArrowEntry. This assertion fails if highlighting
    // consults arrow.sourceFields instead of the concrete LayoutEdge endpoint.
    const layer = new edgeLayerModule.SzEdgeLayer();
    layer.highlightSchema = "s1";
    layer.highlightField = "field_0";

    assert.equal(layer._isEdgeHighlighted(edgeFrom("s0")), false);
    assert.equal(layer._isEdgeHighlighted(edgeFrom("s1")), true);
  });
});

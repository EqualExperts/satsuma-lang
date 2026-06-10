// overview-anchors.test.js — overview edge anchors sit on card borders at the
// header's vertical midpoint (sl-wixe).
//
// The anchor math in overviewVisualAnchor and the node heights handed to ELK
// are both derived from the shared geometry constants. These tests pin that
// derivation through the public computeOverviewLayout API: every edge's first
// point must lie on its source node's right border at the header midpoint,
// and its last point on the target node's left border — for non-namespaced
// cards (no pill row), namespaced cards (24px pill row), and mapping pills.
// A regression here means dots float beside/above the cards again.
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///test.stm", line: 1, character: 0 };

const schema = (id, qualifiedId = id) => ({
  id,
  qualifiedId,
  kind: "schema",
  label: null,
  fields: [],
  notes: [],
  comments: [],
  metadata: [],
  location: loc,
  hasExternalLineage: false,
  spreads: [],
});

const mapping = (id, sourceRefs, targetRef) => ({
  id,
  sourceRefs,
  targetRef,
  arrows: [],
  eachBlocks: [],
  flattenBlocks: [],
  sourceBlock: null,
  notes: [],
  comments: [],
  location: loc,
});

const model = (nsName, schemaIds, mappings) => ({
  uri: "file:///test.stm",
  fileNotes: [],
  namespaces: [
    {
      name: nsName,
      schemas: schemaIds.map((id) => schema(id, nsName ? `${nsName}::${id}` : id)),
      mappings,
      metrics: [],
      fragments: [],
    },
  ],
});

describe("overview edge anchor geometry", () => {
  it("anchors edges on card borders at the header midpoint when there is no namespace", async () => {
    const { computeOverviewLayout, HEADER_HEIGHT } = await import("../dist/satsuma-viz.js");
    const result = await computeOverviewLayout(
      model(null, ["src", "tgt"], [mapping("m1", ["src"], "tgt")]),
    );

    const src = result.nodes.find((n) => n.id === "src");
    const tgt = result.nodes.find((n) => n.id === "tgt");
    const map = result.nodes.find((n) => n.id === "mapping:_:m1");
    assert.ok(src && tgt && map, "all three nodes laid out");

    const inEdge = result.edges.find((e) => e.sourceNode === "src");
    const outEdge = result.edges.find((e) => e.targetNode === "tgt");
    assert.ok(inEdge && outEdge, "both overview edges present");

    // Schema side: right border, vertical centre of the 40px header.
    assert.deepEqual(inEdge.points[0], {
      x: src.x + src.width,
      y: src.y + HEADER_HEIGHT / 2,
    });
    // Mapping side: left border, vertical centre of the whole pill (no
    // namespace chip row is reserved for global-scope mappings).
    assert.deepEqual(inEdge.points[inEdge.points.length - 1], {
      x: map.x,
      y: map.y + map.height / 2,
    });
    // Target schema: left border, header midpoint.
    assert.deepEqual(outEdge.points[outEdge.points.length - 1], {
      x: tgt.x,
      y: tgt.y + HEADER_HEIGHT / 2,
    });
  });

  it("shifts anchors below the namespace pill row for namespaced cards", async () => {
    const { computeOverviewLayout, HEADER_HEIGHT, NAMESPACE_PILL_HEIGHT } = await import(
      "../dist/satsuma-viz.js"
    );
    const result = await computeOverviewLayout(
      model("crm", ["src", "tgt"], [mapping("m1", ["crm::src"], "crm::tgt")]),
    );

    const src = result.nodes.find((n) => n.id === "crm::src");
    const map = result.nodes.find((n) => n.id === "mapping:crm:m1");
    assert.ok(src && map, "nodes laid out");

    const inEdge = result.edges.find((e) => e.sourceNode === "crm::src");
    assert.ok(inEdge, "edge present");

    // Schema side: header midpoint sits below the 24px pill row.
    assert.deepEqual(inEdge.points[0], {
      x: src.x + src.width,
      y: src.y + NAMESPACE_PILL_HEIGHT + HEADER_HEIGHT / 2,
    });
    // Mapping side: centred on the card area below its namespace chip row.
    assert.deepEqual(inEdge.points[inEdge.points.length - 1], {
      x: map.x,
      y: map.y + NAMESPACE_PILL_HEIGHT + (map.height - NAMESPACE_PILL_HEIGHT) / 2,
    });
  });

  it("reserves pill-row height in node heights only for namespaced nodes", async () => {
    const { computeOverviewLayout, NAMESPACE_PILL_HEIGHT } = await import(
      "../dist/satsuma-viz.js"
    );
    const globalScope = await computeOverviewLayout(
      model(null, ["src", "tgt"], [mapping("m1", ["src"], "tgt")]),
    );
    const namespaced = await computeOverviewLayout(
      model("crm", ["src", "tgt"], [mapping("m1", ["crm::src"], "crm::tgt")]),
    );

    // The same card in a namespace is exactly one pill row taller — schema
    // cards AND mapping pills. The renderer pins cards to these node heights,
    // so any other delta means the chrome and the layout have diverged.
    const h = (layout, id) => layout.nodes.find((n) => n.id === id).height;
    assert.equal(
      h(namespaced, "crm::src") - h(globalScope, "src"),
      NAMESPACE_PILL_HEIGHT,
    );
    assert.equal(
      h(namespaced, "mapping:crm:m1") - h(globalScope, "mapping:_:m1"),
      NAMESPACE_PILL_HEIGHT,
    );
  });
});

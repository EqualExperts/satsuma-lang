/**
 * field-lineage.test.js — shared field-edge assembly and traversal semantics.
 *
 * These tests keep consumer index shapes out of core: fixtures provide only the
 * narrow FieldEdgeSource contract, then assert the graph metadata and traversal
 * results that the CLI and browser consumers share.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFieldEdges, createCanonicalFieldEndpoint, traceFieldLineage } from "@satsuma/core";

/** Resolve the deliberately simple authored paths used by these unit fixtures. */
function resolveEndpoint(authored, schemas) {
  const schema = schemas[0];
  if (!schema) return createCanonicalFieldEndpoint(`::${authored}`);
  const canonicalSchema = schema.includes("::") ? schema : `::${schema}`;
  return createCanonicalFieldEndpoint(`${canonicalSchema}.${authored.replace(/^\./, "")}`);
}

/** Supply the narrow adapter that real consumers build from their own indexes. */
function edgeSource({ arrows = [], mappings = {}, nlRefs = [] } = {}) {
  return {
    arrows,
    mappingSides: (mappingKey) => mappings[mappingKey] ?? null,
    nlRefs,
    resolveEndpoint,
  };
}

describe("buildFieldEdges", () => {
  it("preserves every declared source and the graph metadata attached to its arrow", () => {
    // A shared builder is useful only if graph can delete its private copy
    // without losing multi-source edges, transform text, or derived metadata.
    const result = buildFieldEdges(
      edgeSource({
        arrows: [
          {
            mapping: "load",
            namespace: null,
            sources: ["left", "right"],
            target: "out",
            classification: "nl",
            steps: [{ text: "choose the first non-empty value" }],
            derived: true,
            file: "/w/pipeline.stm",
            line: 6,
          },
        ],
        mappings: { load: { sources: ["input"], targets: ["output"] } },
      }),
      { includeNl: true },
    );

    assert.deepEqual(result, {
      edges: [
        {
          from: "::input.left",
          to: "::output.out",
          mapping: "load",
          classification: "nl",
          file: "/w/pipeline.stm",
          line: 7,
          transforms: ["choose the first non-empty value"],
          nl_text: "choose the first non-empty value",
          derived: true,
        },
        {
          from: "::input.right",
          to: "::output.out",
          mapping: "load",
          classification: "nl",
          file: "/w/pipeline.stm",
          line: 7,
          transforms: ["choose the first non-empty value"],
          nl_text: "choose the first non-empty value",
          derived: true,
        },
      ],
      unresolvedNl: [
        {
          scope: "mapping load",
          arrow: "-> out",
          text: "choose the first non-empty value",
          file: "/w/pipeline.stm",
          line: 7,
        },
      ],
    });
  });

  it("adds each implicit NL edge once but never duplicates declared or self lineage", () => {
    // NL refs can repeat in prose or merely describe an already-authored source;
    // neither case may inflate graph statistics or lineage connections.
    const repeatedImplicitRef = {
      resolved: true,
      resolvedTo: { kind: "field", name: "crm::source.implicit" },
      mapping: "crm::load",
      targetField: "out",
      file: "/w/pipeline.stm",
      line: 10,
    };
    const result = buildFieldEdges(
      edgeSource({
        arrows: [
          {
            mapping: "load",
            namespace: "crm",
            sources: ["declared"],
            target: "out",
            classification: "none",
            steps: [],
            derived: false,
            file: "/w/pipeline.stm",
            line: 4,
          },
        ],
        mappings: {
          "crm::load": { sources: ["crm::source"], targets: ["crm::target"] },
        },
        nlRefs: [
          repeatedImplicitRef,
          repeatedImplicitRef,
          {
            ...repeatedImplicitRef,
            resolvedTo: { kind: "field", name: "crm::source.declared" },
          },
          {
            ...repeatedImplicitRef,
            resolvedTo: { kind: "field", name: "crm::target.out" },
          },
        ],
      }),
    );

    assert.deepEqual(
      result.edges.map(({ from, to, mapping, classification }) => ({
        from,
        to,
        mapping,
        classification,
      })),
      [
        {
          from: "crm::source.declared",
          to: "crm::target.out",
          mapping: "crm::load",
          classification: "none",
        },
        {
          from: "crm::source.implicit",
          to: "crm::target.out",
          mapping: "crm::load",
          classification: "nl-derived",
        },
      ],
    );
  });
});

describe("traceFieldLineage", () => {
  const a = createCanonicalFieldEndpoint("::a.id");
  const b = createCanonicalFieldEndpoint("::b.id");
  const c = createCanonicalFieldEndpoint("::c.id");
  const d = createCanonicalFieldEndpoint("::d.id");
  const edges = [
    { from: a, to: b, mapping: "a_to_b", classification: "none" },
    { from: b, to: c, mapping: "ns::b_to_c", classification: "nl" },
    { from: b, to: d, mapping: "b_to_d", classification: "nl-derived" },
    { from: c, to: b, mapping: "cycle", classification: "none" },
  ];

  it("returns both breadth-first directions with canonical mapping references", () => {
    // The published CLI contract orders each direction breadth-first and spells
    // global mapping ids with `::`; extracting it must leave that JSON unchanged.
    assert.deepEqual(traceFieldLineage(edges, b, { depth: 10, direction: "both" }), {
      field: "::b.id",
      upstream: [
        { field: "::a.id", via_mapping: "::a_to_b", classification: "none" },
        { field: "::c.id", via_mapping: "::cycle", classification: "none" },
      ],
      downstream: [
        { field: "::c.id", via_mapping: "ns::b_to_c", classification: "nl" },
        { field: "::d.id", via_mapping: "::b_to_d", classification: "nl-derived" },
      ],
    });
  });

  it("honours direction and depth while terminating cyclic walks", () => {
    // Depth is a hop limit, not an output slice, and revisiting the start through
    // the cycle must not add it as its own ancestor or recurse forever.
    assert.deepEqual(traceFieldLineage(edges, b, { depth: 1, direction: "upstream" }), {
      field: "::b.id",
      upstream: [
        { field: "::a.id", via_mapping: "::a_to_b", classification: "none" },
        { field: "::c.id", via_mapping: "::cycle", classification: "none" },
      ],
      downstream: [],
    });
  });

  // ── Depth exactness (spr-w98t) ────────────────────────────────────────────
  //
  // These fixtures pin the invariant that makes the traversal's mark-on-enqueue
  // visited set safe: the result is exactly the fields whose *shortest* path is
  // within the hop budget. The shape matters. A diamond whose two-path field is
  // adjacent to the focus proves nothing — an adjacent field is enqueued at its
  // shortest depth whatever order the walk expands in — so `hub` below sits two
  // hops away, with `leaf`/`ancestor` one further hop out, exactly on the depth
  // boundary. That boundary field is reachable within budget only if `hub` was
  // claimed by its two-hop side; a walk that claims `hub` through the three-hop
  // side loses the boundary field entirely and mislabels `hub`'s via_mapping.
  // Authoring the short side first is deliberate: it is the order a depth-first
  // (stack-based) walk gets wrong, so these cases fail if the queue stops being
  // FIFO. Edge-order independence is asserted separately below.

  /** One direct field hop; classification is irrelevant to these topologies. */
  const hop = (from, to, mapping) => ({ from, to, mapping, classification: "none" });

  const start = createCanonicalFieldEndpoint("::start.id");
  const sink = createCanonicalFieldEndpoint("::sink.id");
  const near = createCanonicalFieldEndpoint("::near.id");
  const detour = createCanonicalFieldEndpoint("::detour.id");
  const relay = createCanonicalFieldEndpoint("::relay.id");
  const hub = createCanonicalFieldEndpoint("::hub.id");
  const leaf = createCanonicalFieldEndpoint("::leaf.id");
  const ancestor = createCanonicalFieldEndpoint("::ancestor.id");

  // start → near → hub → leaf              (hub at 2 hops, leaf at 3)
  // start → detour → relay → hub           (hub at 3 hops the long way)
  const downstreamDiamond = [
    hop(start, near, "start_to_near"),
    hop(near, hub, "near_to_hub"),
    hop(start, detour, "start_to_detour"),
    hop(detour, relay, "detour_to_relay"),
    hop(relay, hub, "relay_to_hub"),
    hop(hub, leaf, "hub_to_leaf"),
  ];

  it("reaches the field on the depth boundary below a two-path field downstream", () => {
    // `leaf` is three hops away only through hub's two-hop side, so it appears
    // if and only if hub was claimed at its shortest depth. Full ordered compare
    // also pins breadth-first emission order and one hop per reached field.
    const result = traceFieldLineage(downstreamDiamond, start, {
      depth: 3,
      direction: "downstream",
    });

    assert.deepEqual(result.downstream, [
      { field: "::near.id", via_mapping: "::start_to_near", classification: "none" },
      { field: "::detour.id", via_mapping: "::start_to_detour", classification: "none" },
      { field: "::hub.id", via_mapping: "::near_to_hub", classification: "none" },
      { field: "::relay.id", via_mapping: "::detour_to_relay", classification: "none" },
      { field: "::leaf.id", via_mapping: "::hub_to_leaf", classification: "none" },
    ]);
  });

  it("reaches the field on the depth boundary above a two-path field upstream", () => {
    // The mirrored topology exercises the upstream endpoint selection: `ancestor`
    // is three hops back only through hub's two-hop side.
    const upstreamDiamond = [
      hop(near, sink, "near_to_sink"),
      hop(hub, near, "hub_to_near"),
      hop(detour, sink, "detour_to_sink"),
      hop(relay, detour, "relay_to_detour"),
      hop(hub, relay, "hub_to_relay"),
      hop(ancestor, hub, "ancestor_to_hub"),
    ];

    const result = traceFieldLineage(upstreamDiamond, sink, {
      depth: 3,
      direction: "upstream",
    });

    assert.deepEqual(result.upstream, [
      { field: "::near.id", via_mapping: "::near_to_sink", classification: "none" },
      { field: "::detour.id", via_mapping: "::detour_to_sink", classification: "none" },
      { field: "::hub.id", via_mapping: "::hub_to_near", classification: "none" },
      { field: "::relay.id", via_mapping: "::relay_to_detour", classification: "none" },
      { field: "::ancestor.id", via_mapping: "::ancestor_to_hub", classification: "none" },
    ]);
  });

  it("claims a two-path field by its shortest side whichever side is authored first", () => {
    // Depth exactness must not depend on edge-list order, which is an artifact of
    // authoring order in the workspace. Emission order does vary with it, so this
    // compares the reached fields and their via_mapping as an unordered map.
    const longSideFirst = [
      hop(start, detour, "start_to_detour"),
      hop(detour, relay, "detour_to_relay"),
      hop(relay, hub, "relay_to_hub"),
      hop(start, near, "start_to_near"),
      hop(near, hub, "near_to_hub"),
      hop(hub, leaf, "hub_to_leaf"),
    ];
    const shortestPathEdges = (edges) =>
      new Map(
        traceFieldLineage(edges, start, { depth: 3, direction: "downstream" }).downstream.map(
          ({ field, via_mapping }) => [field, via_mapping],
        ),
      );

    assert.deepEqual(shortestPathEdges(longSideFirst), shortestPathEdges(downstreamDiamond));
    assert.deepEqual(
      shortestPathEdges(longSideFirst),
      new Map([
        ["::near.id", "::start_to_near"],
        ["::detour.id", "::start_to_detour"],
        ["::hub.id", "::near_to_hub"],
        ["::relay.id", "::detour_to_relay"],
        ["::leaf.id", "::hub_to_leaf"],
      ]),
    );
  });
});

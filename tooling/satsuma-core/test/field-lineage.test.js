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
});

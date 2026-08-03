/**
 * ground-truth.test.js — the oracle's own tests.
 *
 * Every lineage property in this repository asserts against `ground-truth.js`.
 * An oracle that is quietly wrong does not fail: it *weakens*, and the properties
 * built on it keep passing while defending less than they claim to. So the oracle
 * gets hand-written cases of its own, small enough to read in full and check by
 * eye against the Satsuma the same scenario renders to.
 *
 * These are deliberately not property tests. A property over the oracle could only
 * compare it against another traversal of the same data — which is the circularity
 * the oracle exists to avoid.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scalarField } from "../src/model.js";
import {
  computedArrow,
  eachBlock,
  endpoint,
  mapArrow,
  mappingDecl,
  nlTransform,
  scenarioFile,
  scenarioWorkspace,
  schemaDecl,
} from "../src/workspace-model.js";
import { renderWorkspace } from "../src/workspace-render.js";
import {
  scenarioAncestorsWithin,
  scenarioDeclaredFieldPaths,
  scenarioDescendantsWithin,
  scenarioFieldEdges,
  scenarioSchemaEdges,
  scenarioSchemaProjection,
} from "../src/ground-truth.js";
import { listRecordField } from "../src/model.js";

/** Compact `from -> to (classification)` form, so a failure is readable. */
function shown(edges) {
  return edges.map((edge) => `${edge.from} -> ${edge.to} (${edge.classification})`).sort();
}

/** A one-file workspace, the shape most of these cases need. */
function oneFile({ fragments = [], schemas, mappings }) {
  return scenarioWorkspace([scenarioFile({ path: "entry.stm", fragments, schemas, mappings })]);
}

describe("scenarioDeclaredFieldPaths", () => {
  it("includes container paths as well as leaves", () => {
    // An arrow may legitimately name a container — `each orders -> shipments`
    // names two. An endpoint-existence check built on leaves alone would report
    // every container-header edge as an invented endpoint.
    const workspace = oneFile({
      schemas: [
        schemaDecl({
          name: "s0",
          fields: [listRecordField("lines", [scalarField("sku")])],
        }),
      ],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["::s0.lines", "::s0.lines.sku"]);
  });

  it("includes fields a schema only gets from a spread fragment", () => {
    // A spread field is declared by the fragment, not the schema body. Reading the
    // body alone would call a perfectly valid endpoint invented.
    const workspace = oneFile({
      fragments: [{ name: "audit", fields: [scalarField("loaded_at")] }],
      schemas: [schemaDecl({ name: "s0", fields: [scalarField("id")], spreads: ["audit"] })],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["::s0.id", "::s0.loaded_at"]);
  });

  it("lets a body declaration shadow a spread field rather than duplicating it", () => {
    // ADR-041. The same name reached through both routes is one declared path, not
    // two — a duplicate here would make an exactly-once edge property unfalsifiable.
    const workspace = oneFile({
      fragments: [{ name: "audit", fields: [scalarField("id")] }],
      schemas: [schemaDecl({ name: "s0", fields: [scalarField("id")], spreads: ["audit"] })],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["::s0.id"]);
  });

  it("qualifies a namespaced schema's paths with its namespace", () => {
    // `ns::schema.field`, not `::schema.field`: the canonical key of a namespaced
    // entity keeps its namespace, and comparing the two forms is how a namespace
    // branch bug hides.
    const workspace = oneFile({
      schemas: [schemaDecl({ name: "s0", namespace: "ns_a", fields: [scalarField("id")] })],
      mappings: [],
    });
    assert.deepEqual(scenarioDeclaredFieldPaths(workspace), ["ns_a::s0.id"]);
  });
});

describe("scenarioFieldEdges", () => {
  it("declares one edge per source for a multi-source arrow", () => {
    // Spec §4.2: `a, b -> t` is two edges to the same target, not one edge with
    // two sources. A consumer that emitted one would lose half the lineage.
    const workspace = oneFile({
      schemas: ["s0", "s1", "t"].map((name) => schemaDecl({ name, fields: [scalarField("id")] })),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0", "s1"],
          targets: ["t"],
          arrows: [mapArrow([endpoint("s0", "id"), endpoint("s1", "id")], endpoint("t", "id"))],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), [
      "::s0.id -> ::t.id (none)",
      "::s1.id -> ::t.id (none)",
    ]);
  });

  it("counts a container header as an edge in its own right", () => {
    // An `each` header names a source and a target, so it is an arrow record like
    // any other. Treating it as mere syntax loses the container-to-container edge
    // — which is the one a graph draws between two list fields.
    const workspace = oneFile({
      schemas: ["s0", "s1"].map((name) =>
        schemaDecl({ name, fields: [listRecordField("lines", [scalarField("sku")])] }),
      ),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0"],
          targets: ["s1"],
          arrows: [
            eachBlock(endpoint("s0", "lines"), endpoint("s1", "lines"), [
              mapArrow([endpoint("s0", "lines.sku")], endpoint("s1", "lines.sku")),
            ]),
          ],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), [
      "::s0.lines -> ::s1.lines (none)",
      "::s0.lines.sku -> ::s1.lines.sku (none)",
    ]);
  });

  it("gives a computed arrow a null source", () => {
    // A sourceless arrow still populates its target. A consumer that dropped it
    // would lose the target field from the graph entirely.
    const workspace = oneFile({
      schemas: [schemaDecl({ name: "t", fields: [scalarField("stamp")] })],
      mappings: [
        mappingDecl({
          name: "m0",
          sources: [],
          targets: ["t"],
          arrows: [computedArrow(endpoint("t", "stamp"), nlTransform("Load time."))],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), ["null -> ::t.stamp (nl)"]);
  });

  it("adds an nl-derived edge for each @ref an arrow body mentions", () => {
    // The implicit tier: `@s0.other` inside a transform states that `other` also
    // feeds this target. It is a distinct classification because it is a weaker
    // claim than a declared arrow, and it is the tier that once manufactured
    // phantom edges (cbh-y5og).
    const workspace = oneFile({
      schemas: ["s0", "t"].map((name) =>
        schemaDecl({ name, fields: [scalarField("id"), scalarField("other")] }),
      ),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0"],
          targets: ["t"],
          arrows: [
            mapArrow(
              [endpoint("s0", "id")],
              endpoint("t", "id"),
              nlTransform("Combine.", [endpoint("s0", "other")]),
            ),
          ],
        }),
      ],
    });
    assert.deepEqual(shown(scenarioFieldEdges(workspace)), [
      "::s0.id -> ::t.id (nl)",
      "::s0.other -> ::t.id (nl-derived)",
    ]);
  });
});

describe("scenarioSchemaEdges", () => {
  it("derives source and target roles from the declared lists, not from arrows", () => {
    // A mapping with no arrows still connects its schemas. Deriving topology from
    // arrows alone would make a declared-but-unmapped hop vanish from the graph.
    const workspace = oneFile({
      schemas: ["s0", "t"].map((name) => schemaDecl({ name, fields: [scalarField("id")] })),
      mappings: [mappingDecl({ name: "m0", sources: ["s0"], targets: ["t"], arrows: [] })],
    });
    assert.deepEqual(scenarioSchemaEdges(workspace), [
      { from: "::s0", to: "::m0", role: "source" },
      { from: "::m0", to: "::t", role: "target" },
    ]);
  });

  it("derives metric_source from the metric's own metadata token", () => {
    // A separate mechanism from mappings, and therefore a separate role: a metric
    // names its provenance in its declaration, with no arrow involved.
    const workspace = oneFile({
      schemas: [
        schemaDecl({ name: "fact", fields: [scalarField("amount")] }),
        schemaDecl({
          name: "mrr",
          fields: [scalarField("value")],
          metric: true,
          metricSources: ["fact"],
        }),
      ],
      mappings: [],
    });
    assert.deepEqual(scenarioSchemaEdges(workspace), [
      { from: "::fact", to: "::mrr", role: "metric_source" },
    ]);
  });
});

describe("scenarioSchemaProjection", () => {
  it("reads the owning schema off a namespaced endpoint without splitting on the first dot", () => {
    // `warehouse::staged.field_0` owns `warehouse::staged`. Splitting on the first
    // `.` happens to work for a file-scope key and is wrong the moment a namespace
    // is involved — which is the ad-hoc unbranding R6 replaces.
    const edges = [
      { from: "warehouse::staged.field_0", to: "::mart.field_0" },
      { from: null, to: "::mart.stamp" },
      { from: "::mart.a", to: "::mart.b" },
    ];
    assert.deepEqual(scenarioSchemaProjection(edges), ["warehouse::staged->::mart"]);
  });
});

describe("reachability", () => {
  /** `a → b → c → d`, one field each: the smallest graph with an interior node. */
  const chain = [
    { from: "::a.f", to: "::b.f", classification: "none" },
    { from: "::b.f", to: "::c.f", classification: "none" },
    { from: "::c.f", to: "::d.f", classification: "none" },
  ];

  it("records each reachable field's shortest hop count, not its first arrival", () => {
    // sl-y89y stated positively. A traversal that expands a node once at whatever
    // depth it first arrived can truncate the subtree below it when a shorter path
    // arrives later with budget remaining. Distances are what make depth
    // *exactness* assertable, where monotonicity alone would have passed the bug.
    const downstream = scenarioDescendantsWithin(chain, "::a.f", 3);
    assert.deepEqual([...downstream.entries()].sort(), [
      ["::b.f", 1],
      ["::c.f", 2],
      ["::d.f", 3],
    ]);
  });

  it("stops exactly at the depth limit", () => {
    // `--depth n` means n hops. Off by one here and every depth property is
    // asserting the wrong thing while looking healthy.
    assert.deepEqual([...scenarioDescendantsWithin(chain, "::a.f", 1).keys()], ["::b.f"]);
    assert.deepEqual([...scenarioDescendantsWithin(chain, "::a.f", 2).keys()].sort(), [
      "::b.f",
      "::c.f",
    ]);
  });

  it("returns every branch of a diamond, not one path through it", () => {
    // sg-pufq: `lineage --to` once returned a single upstream chain. Both branches
    // of a diamond are at the same distance, so a single-predecessor walk produces
    // an answer that looks entirely plausible.
    const diamond = [
      { from: "::a.f", to: "::left.f" },
      { from: "::a.f", to: "::right.f" },
      { from: "::left.f", to: "::sink.f" },
      { from: "::right.f", to: "::sink.f" },
    ];
    const upstream = scenarioAncestorsWithin(diamond, "::sink.f", 2);
    assert.deepEqual([...upstream.entries()].sort(), [
      ["::a.f", 2],
      ["::left.f", 1],
      ["::right.f", 1],
    ]);
  });

  it("terminates on a cycle and reports each field once", () => {
    // A loop is reachable from itself. The start field is excluded from its own
    // result set, and no field appears twice however large the depth budget is.
    const cycle = [
      { from: "::a.f", to: "::b.f" },
      { from: "::b.f", to: "::a.f" },
    ];
    assert.deepEqual([...scenarioDescendantsWithin(cycle, "::a.f", 99).keys()], ["::b.f"]);
  });

  it("contributes no upstream hop for a computed arrow's null source", () => {
    // There is no field to walk from. Treating null as a node would put a
    // synthetic entry in every upstream answer for a computed target.
    const edges = [{ from: null, to: "::t.stamp" }];
    assert.deepEqual([...scenarioAncestorsWithin(edges, "::t.stamp", 5).keys()], []);
  });
});

describe("renderWorkspace guards against unrenderable scenarios", () => {
  it("refuses a child arrow that reaches outside its container block", () => {
    // Satsuma has no notation for reaching an ancestor from inside a block
    // (spec §4.4), so such an arrow cannot be spelled. Rendering it anyway would
    // silently produce a path resolving to a field nobody declared, and the
    // resulting property failure would be blamed on the toolchain.
    const workspace = oneFile({
      schemas: ["s0", "s1"].map((name) =>
        schemaDecl({
          name,
          fields: [listRecordField("lines", [scalarField("sku")]), scalarField("top")],
        }),
      ),
      mappings: [
        mappingDecl({
          name: "m0",
          sources: ["s0"],
          targets: ["s1"],
          arrows: [
            eachBlock(endpoint("s0", "lines"), endpoint("s1", "lines"), [
              mapArrow([endpoint("s0", "top")], endpoint("s1", "lines.sku")),
            ]),
          ],
        }),
      ],
    });
    assert.throws(() => renderWorkspace(workspace), /not under block path 'lines'/);
  });
});

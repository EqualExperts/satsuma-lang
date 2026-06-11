import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

/** Helper: minimal SourceLocation */
const loc = { uri: "file:///test.stm", line: 1, character: 0 };

/** Helper: minimal field */
const field = (name, type = "STRING") => ({
  name,
  type,
  constraints: [],
  notes: [],
  comments: [],
  children: [],
  location: loc,
});

/** Helper: minimal arrow */
const arrow = (source, target, transform = null) => ({
  sourceFields: [source],
  targetField: target,
  transform,
  metadata: [],
  comments: [],
  location: loc,
});

/** Helper: minimal schema */
const schema = (id, fields = [field("id")], qualifiedId = id) => ({
  id,
  qualifiedId,
  kind: "schema",
  label: null,
  fields,
  notes: [],
  comments: [],
  metadata: [],
  location: loc,
  hasExternalLineage: false,
  spreads: [],
});

/** Helper: minimal mapping */
const mapping = (id, sourceRefs, targetRef, arrows = []) => ({
  id,
  sourceRefs,
  targetRef,
  arrows,
  eachBlocks: [],
  flattenBlocks: [],
  sourceBlock: null,
  notes: [],
  comments: [],
  location: loc,
});

describe("computeLayout", () => {
  /** @type {typeof import("../dist/satsuma-viz.js").computeLayout} */
  let computeLayout;

  it("loads the layout module", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    computeLayout = mod.computeLayout;
    assert.equal(typeof computeLayout, "function");
  });

  it("computes layout for a single schema", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [
        {
          name: null,
          schemas: [
            {
              id: "users",
              qualifiedId: "users",
              kind: "schema",
              label: null,
              fields: [field("id", "UUID"), field("name")],
              notes: [],
              comments: [],
              metadata: [],
              location: loc,
              hasExternalLineage: false,
            },
          ],
          mappings: [],
          metrics: [],
          fragments: [],
        },
      ],
    };

    const result = await computeLayout(model);

    assert.ok(result.nodes.has("users"), "Should have 'users' node");
    const node = result.nodes.get("users");
    assert.equal(typeof node.x, "number");
    assert.equal(typeof node.y, "number");
    assert.ok(node.width > 0, "Width should be positive");
    assert.ok(node.height > 0, "Height should be positive");
    assert.ok(result.width > 0);
    assert.ok(result.height > 0);
  });

  it("positions source and target schemas with edges", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [
        {
          name: null,
          schemas: [
            {
              id: "source",
              qualifiedId: "source",
              kind: "schema",
              label: null,
              fields: [field("email"), field("name")],
              notes: [],
              comments: [],
              metadata: [],
              location: loc,
              hasExternalLineage: false,
            },
            {
              id: "target",
              qualifiedId: "target",
              kind: "schema",
              label: null,
              fields: [field("email"), field("full_name")],
              notes: [],
              comments: [],
              metadata: [],
              location: loc,
              hasExternalLineage: false,
            },
          ],
          mappings: [
            {
              id: "source_to_target",
              sourceRefs: ["source"],
              targetRef: "target",
              arrows: [
                arrow("email", "email"),
                arrow("name", "full_name", {
                  kind: "nl",
                  text: "trim | upper",
                  steps: ["trim", "upper"],
                }),
              ],
              eachBlocks: [],
              flattenBlocks: [],
              sourceBlock: null,
              notes: [],
              comments: [],
              location: loc,
            },
          ],
          metrics: [],
          fragments: [],
        },
      ],
    };

    const result = await computeLayout(model);

    assert.ok(result.nodes.has("source"), "Should have source node");
    assert.ok(result.nodes.has("target"), "Should have target node");

    const src = result.nodes.get("source");
    const tgt = result.nodes.get("target");

    // ELK layered layout with RIGHT direction: source should be left of target
    assert.ok(
      src.x < tgt.x,
      `Source x (${src.x}) should be less than target x (${tgt.x})`
    );

    // Should produce edges
    assert.ok(result.edges.length >= 0, "Should have edges array");
  });

  it("keeps namespaced schemas as flat result nodes", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [
        {
          name: "crm",
          schemas: [
            {
              id: "customers",
              qualifiedId: "crm::customers",
              kind: "schema",
              label: null,
              fields: [field("id")],
              notes: [],
              comments: [],
              metadata: [],
              location: loc,
              hasExternalLineage: false,
            },
          ],
          mappings: [],
          metrics: [],
          fragments: [],
        },
      ],
    };

    const result = await computeLayout(model);

    assert.ok(
      result.nodes.has("crm::customers"),
      "Should have namespaced schema node"
    );
    assert.ok(
      !result.nodes.has("ns:crm"),
      "Namespace layout container should not exist in result nodes"
    );
  });

  it("handles metrics and fragments", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [
        {
          name: null,
          schemas: [],
          mappings: [],
          metrics: [
            {
              id: "revenue",
              qualifiedId: "revenue",
              label: "MRR",
              source: ["orders"],
              grain: "monthly",
              slices: [],
              filter: null,
              fields: [
                {
                  name: "value",
                  type: "DECIMAL(14,2)",
                  measure: "additive",
                  notes: [],
                  location: loc,
                },
              ],
              notes: [],
              comments: [],
              location: loc,
            },
          ],
          fragments: [
            {
              id: "audit_fields",
              fields: [field("created_at", "TIMESTAMP")],
              notes: [],
              location: loc,
            },
          ],
        },
      ],
    };

    const result = await computeLayout(model);

    assert.ok(result.nodes.has("revenue"), "Should have metric node");
    assert.ok(result.nodes.has("audit_fields"), "Should have fragment node");
  });

  it("expands schema node height for report metadata, spreads, and notes", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [{
          ...schema(
            "branch_product_daily_as_is",
            [field("branch_id"), field("branch_name"), field("effective_from", "DATE")],
          ),
          metadata: [{ key: "report", value: "" }, { key: "tool", value: "powerbi" }],
          notes: [{ text: "Long report note that should reserve extra card height in the detailed lineage view.", isMultiline: false, location: loc }],
          spreads: ["audit_fields"],
        }],
        mappings: [],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeLayout(model);
    const node = result.nodes.get("branch_product_daily_as_is");

    assert.ok(node, "Should have report schema node");
    assert.ok(
      node.height > 160,
      `Report schema node height (${node.height}) should include notes and spread rows`,
    );
    assert.ok(
      node.width >= 260,
      `Report schema node width (${node.width}) should expand for report metadata/content`,
    );
  });

  it("expands metric node dimensions for metadata and notes", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [],
        mappings: [],
        metrics: [{
          id: "branch_product_revenue_variance",
          qualifiedId: "branch_product_revenue_variance",
          label: "Revenue Variance",
          source: ["orders"],
          grain: "daily",
          slices: ["region", "branch", "product"],
          filter: null,
          fields: [
            { name: "variance_amount", type: "DECIMAL(14,2)", measure: "additive", notes: [], location: loc },
            { name: "variance_pct", type: "DECIMAL(9,4)", measure: "non_additive", notes: [], location: loc },
          ],
          notes: [{ text: "Used by operational reporting and downstream dashboards.", isMultiline: false, location: loc }],
          comments: [],
          location: loc,
        }],
        fragments: [],
      }],
    };

    const result = await computeLayout(model);
    const node = result.nodes.get("branch_product_revenue_variance");

    assert.ok(node, "Should have metric node");
    assert.ok(node.height > 120, `Metric node height (${node.height}) should include meta and notes`);
    assert.ok(node.width > 240, `Metric node width (${node.width}) should expand for long names/content`);
  });

  it("produces positive dimensions for the overall layout", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [
        {
          name: null,
          schemas: [
            {
              id: "a",
              qualifiedId: "a",
              kind: "schema",
              label: null,
              fields: [field("x")],
              notes: [],
              comments: [],
              metadata: [],
              location: loc,
              hasExternalLineage: false,
            },
          ],
          mappings: [],
          metrics: [],
          fragments: [],
        },
      ],
    };

    const result = await computeLayout(model);
    assert.ok(result.width > 0, "Layout width should be positive");
    assert.ok(result.height > 0, "Layout height should be positive");
  });
});

describe("computeLayout edge metadata survives namespaces and concurrency (sl-i8mo)", () => {
  /** @type {typeof import("../dist/satsuma-viz.js").computeLayout} */
  let computeLayout;

  /** Wrap namespace groups into a minimal VizModel. */
  const model = (...namespaces) => ({ uri: "file:///test.stm", fileNotes: [], namespaces });

  /** A namespace group with defaults for the parts a case doesn't exercise. */
  const ns = (name, parts = {}) => ({
    name,
    schemas: [],
    mappings: [],
    metrics: [],
    fragments: [],
    ...parts,
  });

  it("loads the layout module", async () => {
    computeLayout = (await import("../dist/satsuma-viz.js")).computeLayout;
  });

  it("keeps edge metadata from an earlier namespace when a later namespace has no mappings", async () => {
    // sl-i8mo: edge bookkeeping was module-level and cleared once per
    // namespace, so ANY later namespace group — even one without mappings —
    // erased every earlier edge's source/target/arrow metadata.
    const result = await computeLayout(model(
      ns(null, {
        schemas: [schema("src", [field("email")]), schema("tgt", [field("email")])],
        mappings: [mapping("m1", ["src"], "tgt", [arrow("email", "email")])],
      }),
      ns("crm", { schemas: [schema("customers", [field("id")], "crm::customers")] }),
    ));

    assert.equal(result.edges.length, 1, "the global mapping should produce one edge");
    const edge = result.edges[0];
    assert.equal(edge.sourceNode, "src", "edge must keep its source node after a later namespace is processed");
    assert.equal(edge.targetNode, "tgt", "edge must keep its target node after a later namespace is processed");
    assert.equal(edge.sourceField, "email");
    assert.equal(edge.arrow.targetField, "email", "edge must keep its real arrow, not the dummy fallback");
  });

  it("returns each call's own edge metadata when layouts run concurrently", async () => {
    // sl-i8mo: the shared module-level maps meant a second computeLayout call
    // could repopulate state between another call's graph build and its
    // post-await extraction. Identical mapping ids make a stale read visible:
    // model A's edge would pick up model B's metadata.
    const modelFor = (suffix) => model(ns(null, {
      schemas: [schema(`src_${suffix}`, [field("id")]), schema(`tgt_${suffix}`, [field("id")])],
      mappings: [mapping("m1", [`src_${suffix}`], `tgt_${suffix}`, [arrow("id", "id")])],
    }));

    const [a, b] = await Promise.all([computeLayout(modelFor("a")), computeLayout(modelFor("b"))]);

    assert.equal(a.edges[0].sourceNode, "src_a", "first call must see its own source node");
    assert.equal(b.edges[0].sourceNode, "src_b", "second call must see its own source node");
  });
});

describe("computeLayout field ports for dotted, prefixed, and namespaced paths (sl-l7u0)", () => {
  /** @type {typeof import("../dist/satsuma-viz.js").computeLayout} */
  let computeLayout;

  const model = (schemas, mappings = []) => ({
    uri: "file:///test.stm",
    fileNotes: [],
    namespaces: [{ name: null, schemas, mappings, metrics: [], fragments: [] }],
  });

  it("loads the layout module", async () => {
    computeLayout = (await import("../dist/satsuma-viz.js")).computeLayout;
  });

  it("renders an edge whose arrow uses a schema-prefixed source path", async () => {
    // sl-l7u0: ports were keyed by bare field name while the edge lookup used
    // the authored ref verbatim, so "src.email" found no port and the edge
    // was silently dropped.
    const result = await computeLayout(model(
      [schema("src", [field("email")]), schema("tgt", [field("email")])],
      [mapping("m1", ["src"], "tgt", [arrow("src.email", "email")])],
    ));

    assert.equal(result.edges.length, 1, "prefixed source ref must resolve to the declared field's port");
    assert.equal(result.edges[0].sourceNode, "src");
  });

  it("renders an edge whose target is a nested dotted field path", async () => {
    const tgt = schema("tgt", [{ ...field("customer", "record"), children: [field("email")] }]);
    const result = await computeLayout(model(
      [schema("src", [field("email")]), tgt],
      [mapping("m1", ["src"], "tgt", [arrow("email", "customer.email")])],
    ));

    assert.equal(result.edges.length, 1, "nested dotted target path must resolve to the child field's port");
    assert.equal(result.edges[0].targetField, "customer.email");
  });

  it("attaches a multi-source arrow to the source schema that declares the field", async () => {
    // Pre-fix the edge was always pinned to sourceRefs[0]; a ref like "b.id"
    // then looked up a non-existent port on schema a and the edge vanished.
    const result = await computeLayout(model(
      [schema("a", [field("x")]), schema("b", [field("id")]), schema("tgt", [field("id")])],
      [mapping("m1", ["a", "b"], "tgt", [arrow("b.id", "id")])],
    ));

    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].sourceNode, "b", "the edge must start at the schema declaring the field");
  });

  it("keeps ports distinct for same-named fields at different nesting levels", async () => {
    // Pre-fix both rows produced the id "node:email:src" and the later port
    // silently overwrote the earlier one in LayoutNode.ports.
    const result = await computeLayout(model(
      [schema("s", [field("email"), { ...field("customer", "record"), children: [field("email")] }])],
    ));

    const ports = result.nodes.get("s").ports;
    const top = ports.get("email:src");
    const nested = ports.get("customer.email:src");
    assert.ok(top, "top-level field must keep its port");
    assert.ok(nested, "nested same-named field must get its own path-keyed port");
    assert.notEqual(top.y, nested.y, "the two ports must sit on different field rows");
  });

  it("keys ports by field path even when the node id contains '::'", async () => {
    // Pre-fix extractLayout split port ids on ":", so a namespaced node id
    // like "crm::customers" yielded garbage field keys.
    const result = await computeLayout({
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: "crm",
        schemas: [schema("customers", [field("id")], "crm::customers")],
        mappings: [],
        metrics: [],
        fragments: [],
      }],
    });

    const ports = result.nodes.get("crm::customers").ports;
    assert.ok(ports.get("id:src"), "field key must be the local path, undamaged by '::' in the node id");
    assert.ok(ports.get("id:tgt"));
  });
});

describe("computeOverviewLayout", () => {
  /** @type {typeof import("../dist/satsuma-viz.js").computeOverviewLayout} */
  let computeOverviewLayout;

  it("loads the overview layout function", async () => {
    const mod = await import("../dist/satsuma-viz.js");
    computeOverviewLayout = mod.computeOverviewLayout;
    assert.equal(typeof computeOverviewLayout, "function");
  });

  it("produces compact nodes without ports", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [schema("src"), schema("tgt")],
        mappings: [mapping("m1", ["src"], "tgt", [arrow("id", "id")])],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);

    assert.ok(result.nodes.length >= 3, "Should include schema nodes plus a mapping node");
    const srcNode = result.nodes.find(n => n.id === "src");
    const tgtNode = result.nodes.find(n => n.id === "tgt");
    const mappingNode = result.nodes.find(n => n.id === "mapping:_:m1");
    assert.ok(srcNode, "Should have src node");
    assert.ok(tgtNode, "Should have tgt node");
    assert.ok(mappingNode, "Should have a mapping node");
    // Compact nodes have no ports
    assert.equal(srcNode.ports.size, 0, "Overview nodes should have no ports");
    assert.equal(tgtNode.ports.size, 0, "Overview nodes should have no ports");
    // Compact card height: header (40) + bottom-padding (4) = 44
    assert.equal(srcNode.height, 44, "Compact node should have header-only height");
  });

  it("creates source-to-mapping and mapping-to-target edges", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [
          schema("src", [field("a"), field("b"), field("c")]),
          schema("tgt", [field("x"), field("y"), field("z")]),
        ],
        mappings: [mapping("m1", ["src"], "tgt", [
          arrow("a", "x"),
          arrow("b", "y"),
          arrow("c", "z"),
        ])],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);

    assert.equal(result.edges.length, 2, "Should route through a mapping node");
    assert.ok(result.edges.some((e) => e.sourceNode === "src" && e.targetNode === "mapping:_:m1"));
    assert.ok(result.edges.some((e) => e.sourceNode === "mapping:_:m1" && e.targetNode === "tgt"));
    assert.ok(result.edges.every((e) => e.mapping.id === "m1"));
  });

  it("creates edges for multiple source refs", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [schema("s1"), schema("s2"), schema("tgt")],
        mappings: [mapping("m1", ["s1", "s2"], "tgt", [arrow("id", "id")])],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);

    assert.equal(result.edges.length, 3, "Two source inputs plus one target edge");
    const inboundSources = result.edges
      .filter((e) => e.targetNode === "mapping:_:m1")
      .map(e => e.sourceNode)
      .sort();
    assert.deepEqual(inboundSources, ["s1", "s2"]);
    assert.ok(result.edges.some((e) => e.sourceNode === "mapping:_:m1" && e.targetNode === "tgt"));
  });

  it("sizes an expanded compact card at field-list height so neighbours re-flow without overlap", async () => {
    // le-a1vp: a card the user expanded must occupy its true height IN THE
    // LAYOUT — the old behaviour kept the compact node size and let the
    // expanded fields paint over the cards below. Two source schemas share a
    // layer (stacked vertically), so expanding s1 must both grow its node and
    // push s2 aside; no pair of nodes may overlap afterwards.
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [
          schema("s1", [field("a"), field("b"), field("c"), field("d")]),
          schema("s2"),
          schema("tgt"),
        ],
        mappings: [mapping("m1", ["s1", "s2"], "tgt", [arrow("a", "id")])],
        metrics: [],
        fragments: [],
      }],
    };

    const compact = await computeOverviewLayout(model);
    const expanded = await computeOverviewLayout(model, { expandedSchemaIds: new Set(["s1"]) });

    const s1Compact = compact.nodes.find((n) => n.id === "s1");
    const s1Expanded = expanded.nodes.find((n) => n.id === "s1");
    assert.ok(
      s1Expanded.height > s1Compact.height,
      "the expanded card must be taller than its compact node in the layout",
    );

    for (let i = 0; i < expanded.nodes.length; i++) {
      for (let j = i + 1; j < expanded.nodes.length; j++) {
        const a = expanded.nodes[i];
        const b = expanded.nodes[j];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        assert.ok(
          !(overlapX > 0 && overlapY > 0),
          `nodes ${a.id} and ${b.id} overlap in the expanded layout`,
        );
      }
    }
  });

  it("keeps overview namespaced nodes in the flat output", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: "crm",
        schemas: [schema("customers", [field("id")], "crm::customers")],
        mappings: [],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);

    const node = result.nodes.find(n => n.id === "crm::customers");
    assert.ok(node, "Should have namespaced schema node");
    assert.ok(!result.nodes.find(n => n.id === "ns:crm"), "No namespace node in output");
  });

  it("produces positive overall dimensions", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [schema("a")],
        mappings: [],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);
    assert.ok(result.width > 0, "Layout width should be positive");
    assert.ok(result.height > 0, "Layout height should be positive");
  });

  it("widens overview nodes for longer schema names and metadata", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [
          schema("src"),
          {
            ...schema(
              "order_headers_parquet_with_a_long_name",
              [field("id"), field("customer_id"), field("created_at")],
            ),
            metadata: [{ key: "format", value: "parquet" }],
          },
        ],
        mappings: [],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);
    const srcNode = result.nodes.find((n) => n.id === "src");
    const longNode = result.nodes.find((n) => n.id === "order_headers_parquet_with_a_long_name");

    assert.ok(srcNode, "Should have src node");
    assert.ok(longNode, "Should have long-name node");
    assert.ok(
      longNode.width > srcNode.width,
      `Long-name node width (${longNode.width}) should exceed short node width (${srcNode.width})`,
    );
  });

  it("positions mapping nodes between source and target schemas", async () => {
    const longMappingId = "normalize_and_curate_order_headers_for_reporting";
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [schema("src"), schema("tgt")],
        mappings: [mapping(longMappingId, ["src"], "tgt", [arrow("id", "id")])],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);
    const srcNode = result.nodes.find((n) => n.id === "src");
    const mappingNode = result.nodes.find((n) => n.id === `mapping:_:${longMappingId}`);
    const tgtNode = result.nodes.find((n) => n.id === "tgt");

    assert.ok(srcNode, "Should have src node");
    assert.ok(mappingNode, "Should have mapping node");
    assert.ok(tgtNode, "Should have tgt node");
    assert.ok(
      mappingNode.width >= 180,
      `Long mapping node width (${mappingNode.width}) should expand for the mapping name`,
    );
    assert.ok(
      srcNode.x < mappingNode.x && mappingNode.x < tgtNode.x,
      `Mapping node should be placed between source (${srcNode.x}) and target (${tgtNode.x})`,
    );
  });

  it("ignores overview edges whose source ref does not resolve to a node", async () => {
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [{
        name: null,
        schemas: [schema("src"), schema("tgt")],
        mappings: [mapping("m1", ["src", "Join text that is not a schema"], "tgt", [arrow("id", "id")])],
        metrics: [],
        fragments: [],
      }],
    };

    const result = await computeOverviewLayout(model);
    assert.equal(result.edges.length, 2, "Should keep the valid inbound edge plus the mapping-to-target edge");
    assert.ok(result.edges.some((e) => e.sourceNode === "src" && e.targetNode === "mapping:_:m1"));
    assert.ok(result.edges.some((e) => e.sourceNode === "mapping:_:m1" && e.targetNode === "tgt"));
  });
});

/**
 * graph.test.js — Unit and integration tests for `satsuma graph` command.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run as _run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const EXAMPLES = resolve(__dirname, "../../../examples");
const PLATFORM = resolve(__dirname, "fixtures/platform.stm");
const FIXTURES = resolve(__dirname, "fixtures");

const run = (...args: string[]) => _run(CLI, ...args);

// ---------------------------------------------------------------------------
// satsuma graph (default text output)
// ---------------------------------------------------------------------------
describe("satsuma graph (text)", () => {
  it("prints node counts and schema topology", async () => {
    const { stdout, code } = await run("graph", PLATFORM);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    assert.match(stdout, /schemas:/);
    assert.match(stdout, /mappings:/);
    assert.match(stdout, /schema-level:/);
    assert.match(stdout, /field-level:/);
    assert.match(stdout, /Schema topology:/);
  });

  // After Feature 28, classification is none/nl/nl-derived — no structural
  it("prints classification breakdown", async () => {
    const { stdout, code } = await run("graph", PLATFORM);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    assert.match(stdout, /nl:/);
  });
});

// ---------------------------------------------------------------------------
// satsuma graph --json
// ---------------------------------------------------------------------------
describe("satsuma graph --json", () => {
  it("produces valid JSON with expected top-level keys", async () => {
    const { stdout, code } = await run("graph", "--json", PLATFORM);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    const data = JSON.parse(stdout);
    assert.equal(data.version, 1);
    assert.ok(data.generated);
    assert.ok(data.workspace);
    assert.ok(data.stats);
    assert.ok(Array.isArray(data.nodes));
    assert.ok(Array.isArray(data.edges));
    assert.ok(Array.isArray(data.schema_edges));
    assert.ok(Array.isArray(data.warnings));
    assert.ok(Array.isArray(data.unresolved_nl));
  });

  it("stats counts match node/edge array lengths", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const nodesByKind: Record<string, number> = {};
    for (const n of data.nodes) {
      nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;
    }
    assert.equal(data.stats.schemas, nodesByKind["schema"] ?? 0);
    assert.equal(data.stats.mappings, nodesByKind["mapping"] ?? 0);
    assert.equal(data.stats.metrics, nodesByKind["metric"] ?? 0);
    // Fragments are not graph nodes (sl-p0hz) — stats.fragments counts them but they don't appear in nodes[]
    assert.equal(nodesByKind["fragment"] ?? 0, 0, "fragment nodes must not appear in nodes[]");
    assert.ok(data.stats.fragments >= 0, "stats.fragments should be a non-negative count");
    assert.equal(data.stats.transforms, nodesByKind["transform"] ?? 0);
    assert.equal(data.stats.arrows, data.edges.length);
  });

  it("includes all entity kinds as nodes", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const kinds = new Set(data.nodes.map((n: any) => n.kind));
    assert.ok(kinds.has("schema"), "should have schema nodes");
    assert.ok(kinds.has("mapping"), "should have mapping nodes");
    assert.ok(kinds.has("metric"), "should have metric nodes");
    // Fragments are not graph nodes (sl-p0hz); they are expanded into schema fields
    assert.ok(!kinds.has("fragment"), "fragment nodes must not appear in nodes[]");
    assert.ok(kinds.has("transform"), "should have transform nodes");
  });

  it("schema nodes include id, kind, file, line, and fields", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const schema = data.nodes.find((n: any) => n.kind === "schema");
    assert.ok(schema);
    assert.ok("id" in schema);
    assert.equal(schema.kind, "schema");
    assert.ok("file" in schema);
    assert.ok("line" in schema);
    assert.ok(schema.line >= 1, "line should be 1-indexed");
    assert.ok(Array.isArray(schema.fields));
    if (schema.fields.length > 0) {
      assert.ok("name" in schema.fields[0]);
      assert.ok("type" in schema.fields[0]);
    }
  });

  it("mapping nodes include sources and targets", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const mapping = data.nodes.find((n: any) => n.kind === "mapping");
    assert.ok(mapping);
    assert.ok(Array.isArray(mapping.sources));
    assert.ok(Array.isArray(mapping.targets));
  });

  it("metric nodes include sources, grain, and slices", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const metric = data.nodes.find((n: any) => n.kind === "metric" && n.slices.length > 0);
    assert.ok(metric, "should have a metric with slices");
    assert.ok(Array.isArray(metric.sources));
    assert.ok(typeof metric.grain === "string" || metric.grain === null);
    assert.ok(Array.isArray(metric.slices));
    assert.ok(metric.slices.length > 0);
  });

  it("metric nodes include fields array matching metric command output (sl-j713)", async () => {
    // Graph metric nodes must expose the same fields array that
    // `satsuma metric --json` returns, so a single graph query gives
    // consumers complete metric field information.
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const metric = data.nodes.find((n: any) => n.kind === "metric" && n.fields && n.fields.length > 0);
    assert.ok(metric, "should have a metric node with fields");
    assert.ok(Array.isArray(metric.fields));
    assert.ok("name" in metric.fields[0]);
    assert.ok("type" in metric.fields[0]);
  });

  it("--schema-only omits fields from metric nodes (sl-j713)", async () => {
    const { stdout } = await run("graph", "--json", "--schema-only", PLATFORM);
    const data = JSON.parse(stdout);
    const metric = data.nodes.find((n: any) => n.kind === "metric");
    assert.ok(metric);
    assert.ok(!("fields" in metric), "metric nodes should omit fields in --schema-only mode");
  });

  it("namespace-qualified names use ns::name convention", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const nsNode = data.nodes.find((n: any) => n.namespace && n.id.includes("::"));
    assert.ok(nsNode, "should have namespace-qualified node");
    assert.ok(nsNode.id.startsWith(nsNode.namespace + "::"));
  });

  it("field-level edges have expected structure", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    assert.ok(data.edges.length > 0, "should have field-level edges");
    const edge = data.edges[0];
    assert.ok("from" in edge);
    assert.ok("to" in edge);
    assert.ok("mapping" in edge);
    assert.ok("classification" in edge);
    assert.ok("file" in edge);
    assert.ok("line" in edge);
    assert.ok(edge.line >= 1, "line should be 1-indexed");
  });

  // After Feature 28, all transforms are NL — check that NL edges include transforms
  it("NL edges include transforms array", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const nlWithTransforms = data.edges.find((e: any) => e.classification === "nl" && e.transforms);
    assert.ok(nlWithTransforms, "should have NL edge with transforms");
    assert.ok(Array.isArray(nlWithTransforms.transforms));
  });

  it("NL edges include nl_text", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const nl = data.edges.find((e: any) => e.classification === "nl" && e.nl_text);
    assert.ok(nl, "should have NL edge with nl_text");
    assert.ok(typeof nl.nl_text === "string");
  });

  it("derived edges have from=null and derived=true", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const derived = data.edges.find((e: any) => e.derived === true);
    assert.ok(derived, "should have derived edge");
    assert.equal(derived.from, null);
  });

  it("schema_edges have from, to, and role", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    assert.ok(data.schema_edges.length > 0);
    const roles = new Set(data.schema_edges.map((e: any) => e.role));
    assert.ok(roles.has("source"));
    assert.ok(roles.has("target"));
    for (const e of data.schema_edges as any[]) {
      assert.ok("from" in e);
      assert.ok("to" in e);
      assert.ok("role" in e);
    }
  });

  it("includes metric_source role in schema_edges", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const metricEdge = data.schema_edges.find((e: any) => e.role === "metric_source");
    assert.ok(metricEdge, "should have metric_source schema edge");
  });
});

// ---------------------------------------------------------------------------
// satsuma graph --schema-only
// ---------------------------------------------------------------------------
describe("satsuma graph --schema-only", () => {
  it("aggregates field-level edges to schema-level", async () => {
    const { stdout } = await run("graph", "--json", "--schema-only", PLATFORM);
    const data = JSON.parse(stdout);
    // --schema-only aggregates field-level arrows into schema-level edges
    assert.ok(data.edges.length > 0, "should have aggregated edges");
    assert.ok(data.schema_edges.length > 0);
    // All edges should be schema-level (no dotted field paths)
    for (const e of data.edges) {
      if (e.from) assert.ok(!e.from.includes("."), `from should be schema-level: ${e.from}`);
      if (e.to) assert.ok(!e.to.includes("."), `to should be schema-level: ${e.to}`);
    }
  });

  it("produces no duplicate edges for namespaced mappings (sl-057k)", async () => {
    const { stdout, code } = await run("graph", "--json", "--schema-only", resolve(FIXTURES, "namespaces.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    // Collect all edge keys to detect duplicates
    const edgeKeys = data.edges.map((e: any) => `${e.from}->${e.to}:${e.mapping}`);
    const unique = new Set(edgeKeys);
    assert.equal(edgeKeys.length, unique.size, `duplicate edges found: ${JSON.stringify(edgeKeys)}`);
    // Edges for the namespaced mapping should use qualified name
    const warehouseEdges = data.edges.filter((e: any) => e.mapping && e.mapping.includes("warehouse::"));
    assert.ok(warehouseEdges.length > 0, "should have edges with namespace-qualified mapping name");
    for (const e of warehouseEdges) {
      assert.ok(e.mapping.startsWith("warehouse::"), `mapping should be namespace-qualified: ${e.mapping}`);
    }
  });

  it("omits fields from schema nodes", async () => {
    const { stdout } = await run("graph", "--json", "--schema-only", PLATFORM);
    const data = JSON.parse(stdout);
    const schema = data.nodes.find((n: any) => n.kind === "schema");
    assert.ok(schema);
    assert.ok(!("fields" in schema));
  });
});

// ---------------------------------------------------------------------------
// satsuma graph --namespace
// ---------------------------------------------------------------------------
describe("satsuma graph --namespace", () => {
  it("filters primary nodes to the specified namespace", async () => {
    // The nodes array must include warehouse-namespace entities.
    // Cross-namespace nodes may also appear when they are referenced by
    // schema_edges (e.g. a source schema from pos:: feeding a warehouse mapping).
    // Stats counts must reflect only the filtered-namespace entities.
    const { stdout } = await run("graph", "--json", "--namespace", "warehouse", PLATFORM);
    const data = JSON.parse(stdout);
    assert.ok(data.nodes.length > 0);
    const warehouseNodes = data.nodes.filter((n: any) => n.namespace === "warehouse");
    assert.ok(warehouseNodes.length > 0, "should have warehouse-namespace nodes");
    assert.ok(data.stats.schemas > 0, "stats.schemas should count warehouse schemas");
    assert.ok(data.stats.schemas < 49, "stats.schemas should be less than the full workspace count");
  });

  it("schema_edges reference only nodes present in the nodes array (sl-p895)", async () => {
    // Every endpoint of every schema_edge must correspond to a node in the nodes
    // array. Before this fix, cross-namespace mappings appeared as edge endpoints
    // without a backing node entry.
    const { stdout } = await run("graph", "--json", "--namespace", "warehouse", PLATFORM);
    const data = JSON.parse(stdout);
    const nodeIds = new Set(data.nodes.map((n: any) => n.id));
    for (const e of data.schema_edges as any[]) {
      assert.ok(nodeIds.has(e.from), `schema_edge.from '${e.from}' not in nodes`);
      assert.ok(nodeIds.has(e.to), `schema_edge.to '${e.to}' not in nodes`);
    }
  });

  it("includes cross-namespace schema_edges", async () => {
    const { stdout } = await run("graph", "--json", "--namespace", "warehouse", PLATFORM);
    const data = JSON.parse(stdout);
    // warehouse mappings have sources from other namespaces (e.g. pos::stores)
    const crossNs = data.schema_edges.find((e: any) => e.from.includes("pos::") || e.from.includes("ecom::"));
    assert.ok(crossNs, "should include cross-namespace source edges");
  });

  it("stats reflect filtered counts", async () => {
    const { stdout } = await run("graph", "--json", "--namespace", "warehouse", PLATFORM);
    const data = JSON.parse(stdout);
    assert.ok(data.stats.schemas > 0);
    assert.ok(data.stats.schemas < 49); // less than full workspace
  });
});

// ---------------------------------------------------------------------------
// satsuma graph --no-nl
// ---------------------------------------------------------------------------
describe("satsuma graph --no-nl", () => {
  it("strips nl_text from edges but preserves classification", async () => {
    const { stdout } = await run("graph", "--json", "--no-nl", PLATFORM);
    const data = JSON.parse(stdout);
    const nlEdge = data.edges.find((e: any) => e.classification === "nl");
    assert.ok(nlEdge, "should still have NL-classified edges");
    assert.ok(!("nl_text" in nlEdge), "should not have nl_text");
  });

  it("empties unresolved_nl section", async () => {
    const { stdout } = await run("graph", "--json", "--no-nl", PLATFORM);
    const data = JSON.parse(stdout);
    assert.deepEqual(data.unresolved_nl, [], "unresolved_nl should be empty with --no-nl");
  });
});

// ---------------------------------------------------------------------------
// satsuma graph --compact
// ---------------------------------------------------------------------------
describe("satsuma graph --compact", () => {
  it("prints flat adjacency list", async () => {
    const { stdout, code } = await run("graph", "--compact", PLATFORM);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    assert.match(stdout, /->/);
    assert.match(stdout, /\[source\]/);
    assert.match(stdout, /\[target\]/);
  });
});

// ---------------------------------------------------------------------------
// satsuma graph (namespace fixture)
// ---------------------------------------------------------------------------
describe("satsuma graph (namespace fixture)", () => {
  it("produces correct graph for namespace fixture", async () => {
    const { stdout, code } = await run("graph", "--json", resolve(FIXTURES, "namespaces.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);

    // Should have nodes from multiple namespaces
    const namespaces = new Set(data.nodes.map((n: any) => n.namespace).filter(Boolean));
    assert.ok(namespaces.has("pos"));
    assert.ok(namespaces.has("ecom"));
    assert.ok(namespaces.has("warehouse"));
    assert.ok(namespaces.has("analytics"));

    // Should have warehouse::load hub_store mapping
    const mapping = data.nodes.find((n: any) => n.id === "warehouse::load hub_store");
    assert.ok(mapping);
    assert.deepEqual(mapping.sources, ["pos::stores"]);
    assert.deepEqual(mapping.targets, ["warehouse::hub_store"]);

    // Should have schema_edges for that mapping
    const sourceEdge = data.schema_edges.find(
      (e: any) => e.from === "pos::stores" && e.to === "warehouse::load hub_store",
    );
    assert.ok(sourceEdge);
    assert.equal(sourceEdge.role, "source");
  });
});

// ---------------------------------------------------------------------------
// satsuma graph (nl-derived edges in namespace workspaces)
// ---------------------------------------------------------------------------
describe("satsuma graph (nl-derived edges in namespace workspaces)", () => {
  it("produces nl-derived edges for namespace-qualified mappings (sl-h3wi)", async () => {
    // Before this fix, the graph builder double-prefixed the namespace on
    // the mapping key (ns::ns::name), causing zero nl-derived edges for
    // namespace workspaces despite nl-refs resolving successfully.
    const { stdout, code } = await run("graph", "--json", resolve(EXAMPLES, "namespaces/ns-merging.stm"));
    assert.ok(code === 0 || code === 2);
    const data = JSON.parse(stdout);
    const nlDerived = data.edges.filter((e: any) => e.classification === "nl-derived");
    assert.ok(nlDerived.length > 0, "should produce nl-derived edges for namespaced workspace");

    // All nl-derived edges should reference namespace-qualified mappings
    for (const e of nlDerived) {
      assert.ok(e.mapping.includes("::"), `nl-derived edge mapping should be namespace-qualified: ${e.mapping}`);
    }
  });
});

// ---------------------------------------------------------------------------
// satsuma graph (directory rejection — ADR-022)
// ---------------------------------------------------------------------------
describe("satsuma graph (directory rejection)", () => {
  it("rejects a directory argument with a clear error", async () => {
    // ADR-022: directories are no longer accepted — workspace scope
    // is defined by the entry file and its transitive imports.
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const emptyDir = mkdtempSync(resolve(tmpdir(), "stm-graph-test-"));
    const { stderr, code } = await run("graph", "--json", emptyDir);
    assert.notEqual(code, 0, "should reject directory argument");
    assert.match(stderr, /directory arguments are not supported/);
  });
});

// ---------------------------------------------------------------------------
// satsuma graph (parse errors)
// ---------------------------------------------------------------------------
describe("satsuma graph (parse errors)", () => {
  it("produces partial graph with error count for files with parse errors", async () => {
    const { stdout, code } = await run("graph", "--json", resolve(FIXTURES, "parse-error.stm"));
    assert.equal(code, 2, "should exit with code 2 for parse errors");
    const data = JSON.parse(stdout);
    assert.ok(data.stats.errors > 0, "should report parse errors");
  });
});

// ---------------------------------------------------------------------------
// slices extraction
// ---------------------------------------------------------------------------
describe("satsuma graph (slices)", () => {
  it("extracts slices for metrics with slice declarations", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const mrr = data.nodes.find((n: any) => n.id === "monthly_recurring_revenue");
    assert.ok(mrr, "should have monthly_recurring_revenue metric");
    assert.deepEqual(mrr.slices, ["customer_segment", "product_line", "region"]);
  });

  it("returns empty slices for metrics without slice declarations", async () => {
    const { stdout } = await run("graph", "--json", PLATFORM);
    const data = JSON.parse(stdout);
    const metric = data.nodes.find((n: any) => n.kind === "metric" && n.slices.length === 0);
    assert.ok(metric, "should have a metric with empty slices");
  });

  it("nested arrow children have correct from/to (sl-6dt1, sl-9uh0)", async () => {
    const { stdout, code } = await run("graph", "--json", resolve(EXAMPLES, "sap-po-to-mfcs/pipeline.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);

    // Find nested child edges (Items.* -> items.*)
    const childEdges = data.edges.filter(
      (e: any) => e.from && e.from.includes("Items.") && e.to && e.to.includes("items."),
    );
    assert.ok(childEdges.length >= 7, `expected >=7 nested child edges, got ${childEdges.length}`);

    // No edge should have from:null (the sl-6dt1 bug)
    for (const e of childEdges) {
      assert.ok(e.from !== null, `edge to ${e.to} should have non-null from`);
      assert.ok(!e.from.includes("\n"), `edge from should not contain newline: ${e.from}`);
      assert.ok(!e.to.includes("\n"), `edge to should not contain newline: ${e.to}`);
    }

    // Specifically check .TXZ01 -> .description (the last nested arrow, previously broken)
    const txz = childEdges.find((e: any) => e.from.endsWith(".TXZ01"));
    assert.ok(txz, "should find TXZ01 edge");
    assert.ok(txz.to.endsWith(".description"), `TXZ01 target should be .description, got ${txz.to}`);
  });
});

// ---------------------------------------------------------------------------
// sl-riw5: anonymous mapping edges must have qualified field refs and non-empty mapping key
// ---------------------------------------------------------------------------
describe("satsuma graph (anonymous mapping edges, sl-riw5)", () => {
  it("anonymous mapping edges have qualified from/to and non-empty mapping key", async () => {
    const fixture = resolve(FIXTURES, "anon-lineage.stm");
    const { stdout, code } = await run("graph", "--json", fixture);
    assert.equal(code, 0, `expected exit 0, got ${code}\n${stdout}`);
    const data = JSON.parse(stdout);

    assert.ok(data.edges.length > 0, "should have field-level edges for anonymous mapping");

    for (const edge of data.edges) {
      // mapping key must not be empty
      assert.ok(edge.mapping && edge.mapping.length > 0,
        `edge mapping key should not be empty: ${JSON.stringify(edge)}`);

      // from/to must be schema-qualified (contain a dot or :: prefix)
      if (edge.from) {
        assert.ok(
          edge.from.includes(".") || edge.from.includes("::"),
          `edge.from should be schema-qualified: ${edge.from}`,
        );
      }
      if (edge.to) {
        assert.ok(
          edge.to.includes(".") || edge.to.includes("::"),
          `edge.to should be schema-qualified: ${edge.to}`,
        );
      }
    }

    // The anonymous mapping node should appear in nodes[] with the <anon> key
    const anonMapping = data.nodes.find((n: any) => n.kind === "mapping" && n.id.includes("<anon>"));
    assert.ok(anonMapping, "should have an anonymous mapping node with <anon> in id");

    // Edges should reference that anonymous mapping key
    const anonEdge = data.edges.find((e: any) => e.mapping === anonMapping.id);
    assert.ok(anonEdge, `should have an edge referencing anonymous mapping ${anonMapping.id}`);

    // Specifically: orders.amount -> invoices.total
    const amountToTotal = data.edges.find(
      (e: any) => e.from && e.from.includes("orders") && e.from.includes("amount") &&
             e.to && e.to.includes("invoices") && e.to.includes("total"),
    );
    assert.ok(amountToTotal,
      `should have edge orders.amount -> invoices.total, got: ${JSON.stringify(data.edges)}`);
  });
});

// ---------------------------------------------------------------------------
// satsuma graph vs summary — nl-derived edge count consistency (sl-m9v9)
// ---------------------------------------------------------------------------
describe("satsuma graph vs summary (nl-derived count consistency)", () => {
  it("graph stats.arrows matches the total arrowCount reported by summary (sl-m9v9)", async () => {
    // Bug sl-m9v9: summary overcounted nl-derived edges by not deduplicating
    // against declared arrows. An @ref whose source→target is already the
    // explicit declared source should NOT add an extra nl-derived edge.
    //
    // Fixture: nl-refs-atref-notes.stm has one declared arrow
    //   `balance -> balance_usd { "Convert @balance to USD using @currency rate" }`
    // @balance is the declared source (should not produce a duplicate nl-derived edge).
    // @currency is an additional source (should produce one nl-derived edge).
    // Total: 2 arrows (1 nl + 1 nl-derived).
    const fixture = resolve(FIXTURES, "nl-refs-atref-notes.stm");

    const [graphResult, summaryResult] = await Promise.all([
      run("graph", "--json", fixture),
      run("summary", "--json", fixture),
    ]);

    const graphData = JSON.parse(graphResult.stdout);
    const summaryData = JSON.parse(summaryResult.stdout);

    // graph stats.arrows counts all edges in the output array.
    assert.equal(graphData.stats.arrows, graphData.edges.length,
      "stats.arrows should equal the number of edges in the output");

    // summary arrowCount must equal graph stats.arrows for the same workspace.
    const summaryTotal = (summaryData.mappings as any[]).reduce(
      (sum: number, m: any) => sum + (m.arrowCount as number), 0,
    );
    assert.equal(summaryTotal, graphData.stats.arrows,
      "summary arrowCount sum should equal graph stats.arrows for the same workspace");
  });
});

// ---------------------------------------------------------------------------
// sl-201z: same-line arrows sharing a target must not be collapsed
// ---------------------------------------------------------------------------
describe("satsuma graph (same-line arrows sharing a target, sl-201z)", () => {
  it("reports both arrows when two arrows on one line target the same field", async () => {
    // Bug sl-201z: arrow records were deduplicated by file:line:target, which
    // collides for two distinct arrows written on one line targeting the same
    // field — the second arrow was silently dropped from edges and stats.
    const fixture = resolve(FIXTURES, "same-line-arrows.stm");
    const { stdout, code } = await run("graph", "--json", fixture);
    assert.ok(code === 0 || code === 2, `expected exit 0 or 2, got ${code}`);
    const data = JSON.parse(stdout);
    const pairs = (data.edges as any[]).map((e) => `${e.from}->${e.to}`);
    assert.ok(pairs.includes("::s.a->::t.x"), "edge from s.a should be present");
    assert.ok(pairs.includes("::s.b->::t.x"),
      "edge from s.b (same line, same target as s.a->x) should be present");
    assert.equal(data.stats.arrows, 2, "both same-line arrows should be counted");
  });
});

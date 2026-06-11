/**
 * lineage.test.ts — Focused CLI coverage for the `satsuma lineage` command.
 *
 * These tests exercise the command's public flags through the built CLI rather
 * than mirroring private graph helpers in the test file.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runCli } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const LINEAGE_CHAIN = resolve(__dirname, "fixtures/lineage-chain.stm");
const LINEAGE_CYCLE = resolve(__dirname, "fixtures/lineage-cycle.stm");
const LINEAGE_DIAMOND = resolve(__dirname, "fixtures/lineage-diamond.stm");
const NAMESPACES = resolve(__dirname, "fixtures/namespaces.stm");

const run = (...args: string[]) => runCli(CLI, ...args);

describe("satsuma lineage", () => {
  it("prints downstream text trees with node types for --from", async () => {
    // Human downstream output should show the start schema, mapping, target,
    // and node types in data-flow order.
    const { stdout, code } = await run("lineage", "--from", "source_a", LINEAGE_CHAIN);

    assert.equal(code, 0);
    assert.match(stdout, /^::source_a {2}\[schema\]/m);
    assert.match(stdout, /^ {2}::a_to_b {2}\[mapping\]/m);
    assert.match(stdout, /^ {4}::intermediate_b {2}\[schema\]/m);
  });

  it("prints upstream text paths for --to", async () => {
    // Upstream text mode is path-oriented; it should include every hop back to
    // the source schema rather than just the target node.
    const { stdout, code } = await run("lineage", "--to", "target_d", LINEAGE_CHAIN);

    assert.equal(code, 0);
    assert.match(stdout, /::source_a -> ::a_to_b -> ::intermediate_b/);
    assert.match(stdout, /::c_to_d -> ::target_d/);
  });

  it("emits depth-limited downstream JSON without dangling edges", async () => {
    // Depth limits must truncate the DAG coherently: every edge endpoint should
    // still be present in the nodes array.
    const { stdout, code } = await run("lineage", "--from", "source_a", "--depth", "1", "--json", LINEAGE_CHAIN);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.nodes.map((node: { name: string }) => node.name);
    assert.deepEqual(names, ["source_a", "a_to_b", "intermediate_b"]);
    assert.deepEqual(data.edges, [
      { from: "source_a", to: "a_to_b" },
      { from: "a_to_b", to: "intermediate_b" },
    ]);
    const nodeSet = new Set(names);
    for (const edge of data.edges) {
      assert.ok(nodeSet.has(edge.from), `edge from '${edge.from}' should be in nodes`);
      assert.ok(nodeSet.has(edge.to), `edge to '${edge.to}' should be in nodes`);
    }
  });

  it("prints compact downstream output as names only", async () => {
    // Compact mode is intended for scripts and quick scans, so it should omit
    // type annotations while preserving traversal order.
    const { stdout, code } = await run("lineage", "--from", "source_a", "--depth", "1", "--compact", LINEAGE_CHAIN);

    assert.equal(code, 0);
    assert.deepEqual(stdout.trim().split(/\r?\n/), ["source_a", "a_to_b", "intermediate_b"]);
  });

  it("terminates cyclic downstream graphs and labels the repeated node", async () => {
    // Real workspaces can contain circular schema flows; traversal should stop
    // at the repeated schema and make the cycle visible in text output.
    const { stdout, code } = await run("lineage", "--from", "cycle_a", LINEAGE_CYCLE);

    assert.equal(code, 0);
    assert.match(stdout, /::cycle_a {2}\[schema\] \(cycle\)/);
    assert.ok(stdout.trim().split(/\r?\n/).length <= 5);
  });

  it("includes nodes reachable within the depth limit via a shorter path found later (sl-y89y)", async () => {
    // Diamond graph: s0→s1→s2→s3 plus shortcut s0→s2. A first-visit-wins
    // visited set expands s2 at depth 2 (via s1) and never re-expands it when
    // the shortcut reaches it at depth 1, wrongly dropping s3 from --depth 2.
    const { stdout, code } = await run("lineage", "--from", "s0", "--depth", "2", "--json", LINEAGE_DIAMOND);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.nodes.map((node: { name: string }) => node.name);
    assert.ok(names.includes("s3"), `s3 is two schema hops from s0 via the shortcut; got: ${names.join(", ")}`);
    // Re-expansion must not duplicate nodes or edges in the emitted DAG.
    assert.equal(new Set(names).size, names.length, "nodes must be unique");
    const edgeKeys = data.edges.map((edge: { from: string; to: string }) => `${edge.from}->${edge.to}`);
    assert.equal(new Set(edgeKeys).size, edgeKeys.length, "edges must be unique");
  });

  it("emits upstream JSON for --to with edge direction preserved", async () => {
    // Even in an upstream traversal, JSON edges must keep the data-flow
    // direction (`from` upstream, `to` downstream) for graph consumers.
    const { stdout, code } = await run("lineage", "--to", "target_d", "--json", LINEAGE_CHAIN);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.nodes.map((node: { name: string }) => node.name);
    assert.ok(names.includes("source_a"));
    assert.ok(names.includes("target_d"));
    assert.ok(data.edges.some((edge: { from: string; to: string }) => edge.from === "source_a" && edge.to === "a_to_b"));
    assert.ok(data.edges.some((edge: { from: string; to: string }) => edge.from === "c_to_d" && edge.to === "target_d"));
  });

  it("resolves namespace-qualified --from names without crossing namespace scope", async () => {
    // Namespaced platform entry points depend on qualified node lookup; this
    // guards the public CLI path rather than only the graph builder.
    const { stdout, code } = await run("lineage", "--from", "pos::stores", "--json", NAMESPACES);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.deepEqual(
      data.nodes.map((node: { name: string }) => node.name),
      ["pos::stores", "warehouse::load hub_store", "warehouse::hub_store"],
    );
    assert.deepEqual(data.edges, [
      { from: "pos::stores", to: "warehouse::load hub_store" },
      { from: "warehouse::load hub_store", to: "warehouse::hub_store" },
    ]);
  });

  it("rejects ambiguous --from/--to input before loading the workspace", async () => {
    // The command contract requires exactly one direction selector; this should
    // fail clearly instead of doing arbitrary traversal.
    const { stderr, code } = await run(
      "lineage",
      "--from",
      "source_a",
      "--to",
      "target_d",
      LINEAGE_CHAIN,
    );

    assert.equal(code, 1);
    assert.match(stderr, /Cannot specify both --from and --to/);
  });

  it("keeps not-found errors parseable in JSON mode", async () => {
    // JSON callers rely on structured error payloads even for failed lookups.
    const { stdout, code } = await run("lineage", "--from", "missing_schema", "--json", LINEAGE_CHAIN);

    assert.equal(code, 1);
    assert.deepEqual(JSON.parse(stdout), { error: "Node 'missing_schema' not found." });
  });
});

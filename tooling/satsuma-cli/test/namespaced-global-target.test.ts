/**
 * namespaced-global-target.test.ts — regression coverage for lgc-3f13.
 *
 * A bare entity reference inside a namespace resolves locally first and then at
 * file scope. These command-level checks keep validation, graph assembly, field
 * endpoints, and lineage traversal aligned on that one resolution rule.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { run as runCli } from "./helpers.js";

const CLI = resolve(import.meta.dirname, "../dist/index.js");
const FIXTURE = resolve(import.meta.dirname, "fixtures/namespaced-global-target.stm");

/** Run the built CLI against the minimal lgc-3f13 fixture. */
const run = (...args: string[]) => runCli(CLI, ...args, FIXTURE);

describe("a namespaced mapping targeting a global schema (lgc-3f13)", () => {
  it("validates without inventing a namespace-local target", async () => {
    // A bare target must fall back to the global schema when no declaration with
    // that name exists in the mapping's namespace.
    const { stdout, stderr, code } = await run("validate");
    assert.equal(code, 0, `${stdout}\n${stderr}`);
    assert.doesNotMatch(`${stdout}\n${stderr}`, /undefined-ref|ns_a::s1/);
  });

  it("uses the declared global schema in every graph surface", async () => {
    // Nodes, schema edges, and field edges must agree on the existing `s1`
    // identity; `ns_a::s1` would be an endpoint with no declaration or node.
    // All IDs in JSON output use canonical form.
    const { stdout, stderr, code } = await run("graph", "--json");
    assert.equal(code, 0, stderr);
    const graph = JSON.parse(stdout);
    assert.ok(graph.nodes.some((node: { id: string }) => node.id === "::s1"));
    assert.ok(
      graph.schema_edges.some(
        (edge: { from: string; to: string }) => edge.from === "ns_a::m0" && edge.to === "::s1",
      ),
    );
    assert.ok(
      graph.edges.some(
        (edge: { from: string | null; to: string | null }) =>
          edge.from === "ns_a::s0.field_0" && edge.to === "::s1.field_0",
      ),
    );
    assert.doesNotMatch(stdout, /ns_a::s1/);
  });

  it("traces downstream into the declared global schema", async () => {
    // Schema lineage is assembled from the same resolved mapping endpoints as
    // graph output and must therefore reach `s1`, never a phantom `ns_a::s1`.
    const { stdout, stderr, code } = await run("lineage", "--from", "ns_a::s0", "--json");
    assert.equal(code, 0, stderr);
    const lineage = JSON.parse(stdout);
    assert.ok(lineage.nodes.some((node: { name: string }) => node.name === "s1"));
    assert.ok(
      lineage.edges.some(
        (edge: { from: string; to: string }) => edge.from === "ns_a::m0" && edge.to === "s1",
      ),
    );
    assert.doesNotMatch(stdout, /ns_a::s1/);
  });
});

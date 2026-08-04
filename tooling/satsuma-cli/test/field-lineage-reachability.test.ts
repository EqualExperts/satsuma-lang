/**
 * field-lineage-reachability.test.ts — reachability properties for core's
 * field-level traversal (Feature 41 R4, sl-jsyn).
 *
 * Depth limits, cycles, diamonds and multi-branch upstreams interact, and every
 * known field-lineage defect is a combination of them: `lineage --to` once
 * returned one upstream chain instead of every declared branch (`sg-pufq`), a
 * plain visited-set silently truncated a subtree reachable via a shorter path
 * under a depth limit (`sl-y89y`), and NL backtick refs manufactured phantom
 * source edges (`cbh-y5og`). Lineage needs no independent oracle the way
 * coverage did: a generated scenario declares its own arrows, so reachability
 * over `scenarioFieldEdges` — a breadth-first search over data the generator
 * produced — *is* the expected upstream/downstream set.
 *
 * Every property below is aimed at core's `traceFieldLineage`
 * (`@satsuma/core/field-lineage`) directly, over the edge list
 * `fieldEdgesFor` builds the same way the `field-lineage` command does — not
 * at the CLI command itself, per this feature's design decision. `spr-w98t`
 * proved the traversal itself is depth-exact by construction (FIFO BFS); the
 * properties here exercise that guarantee through generated multi-mapping
 * chains, diamonds and cycles instead of the hand-picked fixtures that let
 * `sg-pufq` and `sl-y89y` ship in the first place.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  GENERATED_PROPERTY_PARAMETERS,
  chainWorkspaceArbitrary,
  cyclicWorkspaceArbitrary,
  diamondWorkspaceArbitrary,
  scenarioAncestorsWithin,
  scenarioDescendantsWithin,
  scenarioFieldEdges,
  scenarioSchemaProjection,
} from "@satsuma/scenario-gen";
import { createCanonicalFieldEndpoint, traceFieldLineage } from "@satsuma/core";
import type { FieldLineageEdge, FieldLineageHop } from "@satsuma/core";
import {
  disposeGeneratedWorkspace,
  fieldEdgesFor,
  graphFor,
  loadGeneratedWorkspace,
} from "./support/generated-workspace.js";

// The WASM parser is initialised by `test/setup.ts`, which the test script
// preloads with `--import`.

/** Sorted field names reached by a traversal direction, for a set comparison. */
function reached(hops: FieldLineageHop[]): string[] {
  return hops.map((hop) => hop.field as string).sort();
}

/** Sorted keys of a `Map<field, depth>` oracle result, ignoring the depth value. */
function reachedKeys(distances: Map<string, number>): string[] {
  return [...distances.keys()].sort();
}

describe("upstream/downstream are exactly reachability over the declared edges (R4)", () => {
  it("returns every branch of a diamond upstream, not one chain through it (sg-pufq)", async () => {
    // sg-pufq's defect class: a walk that follows only one predecessor still
    // returns a plausible-looking chain. The oracle (scenarioAncestorsWithin)
    // states the full ancestor set independently of any production traversal.
    await fc.assert(
      fc.asyncProperty(diamondWorkspaceArbitrary, async ({ workspace, sink, branches, source }) => {
        const loaded = await loadGeneratedWorkspace(workspace);
        try {
          const edges = fieldEdgesFor(loaded);
          const result = traceFieldLineage(edges, createCanonicalFieldEndpoint(sink), {
            depth: 2,
            direction: "upstream",
          });
          const expected = reachedKeys(
            scenarioAncestorsWithin(scenarioFieldEdges(workspace), sink, 2),
          );
          assert.deepEqual(
            reached(result.upstream),
            expected,
            `diamond upstream from ${sink} lost a branch:\n${loaded.sources}`,
          );
          // Both branches must be present — the specific shape sg-pufq missed.
          for (const branch of branches) {
            assert.ok(
              result.upstream.some((hop) => hop.field === branch),
              `expected branch ${branch} in upstream of ${sink}:\n${loaded.sources}`,
            );
          }
          assert.ok(result.upstream.some((hop) => hop.field === source));
        } finally {
          disposeGeneratedWorkspace(loaded);
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("returns exactly the nodes whose shortest path is within depth, at every depth (sl-y89y)", async () => {
    // Depth EXACTNESS, not mere monotonicity: sl-y89y's buggy first-visit-wins
    // walk still grew monotonically with depth, so a property that only checked
    // "more depth never loses fields" would have shipped it too. Checking the
    // exact set at every depth of a chain is what catches a subtree truncated
    // behind a longer first-arrival.
    await fc.assert(
      fc.asyncProperty(chainWorkspaceArbitrary, async ({ workspace, length, head, tail }) => {
        const loaded = await loadGeneratedWorkspace(workspace);
        try {
          const edges = fieldEdgesFor(loaded);
          const declaredEdges = scenarioFieldEdges(workspace);
          for (let depth = 0; depth <= length + 1; depth += 1) {
            const downstream = traceFieldLineage(edges, createCanonicalFieldEndpoint(head), {
              depth,
              direction: "downstream",
            });
            assert.deepEqual(
              reached(downstream.downstream),
              reachedKeys(scenarioDescendantsWithin(declaredEdges, head, depth)),
              `downstream(${head}) at depth ${depth} is not exact:\n${loaded.sources}`,
            );

            const upstream = traceFieldLineage(edges, createCanonicalFieldEndpoint(tail), {
              depth,
              direction: "upstream",
            });
            assert.deepEqual(
              reached(upstream.upstream),
              reachedKeys(scenarioAncestorsWithin(declaredEdges, tail, depth)),
              `upstream(${tail}) at depth ${depth} is not exact:\n${loaded.sources}`,
            );
          }
        } finally {
          disposeGeneratedWorkspace(loaded);
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("agrees with a single-predecessor walk only when there is no second branch to miss", async () => {
    // Demonstrates why the diamond property above is the one worth having: a
    // deliberately weakened traversal that follows only the first matching edge
    // per field reproduces sg-pufq exactly, and this test pins that it *would*
    // fail the property above rather than merely asserting the real behaviour.
    const { workspace, sink, branches } = fc.sample(diamondWorkspaceArbitrary, 1)[0]!;
    const loaded = await loadGeneratedWorkspace(workspace);
    try {
      const edges = fieldEdgesFor(loaded);
      const singlePredecessor = new Map<string, FieldLineageEdge>();
      for (const edge of edges) {
        if (edge.to === undefined || edge.to === null) continue;
        if (!singlePredecessor.has(edge.to)) singlePredecessor.set(edge.to, edge);
      }
      // Walk one hop at a time, following only the first-seen predecessor —
      // the exact defect class sg-pufq described.
      const weakened: string[] = [];
      let frontier: string | undefined = sink;
      for (let hop = 0; hop < 2 && frontier; hop += 1) {
        const edge = singlePredecessor.get(frontier);
        if (!edge || edge.from === null) break;
        weakened.push(edge.from);
        frontier = edge.from;
      }
      // The weakened walk finds at most one branch; the real traversal must
      // still find both, so the two disagree on this generated diamond.
      const foundBranches = branches.filter((branch: string) => weakened.includes(branch));
      assert.ok(
        foundBranches.length < branches.length,
        `expected the single-predecessor walk to miss a branch on this diamond:\n${loaded.sources}`,
      );
      const real = traceFieldLineage(edges, createCanonicalFieldEndpoint(sink), {
        depth: 2,
        direction: "upstream",
      });
      for (const branch of branches) {
        assert.ok(real.upstream.some((hop) => hop.field === branch));
      }
    } finally {
      disposeGeneratedWorkspace(loaded);
    }
  });

  it("agrees on duality: Y is downstream of X exactly when X is upstream of Y", async () => {
    // The two directions are built by flipping which side of an edge
    // `nextEndpoint` follows (field-lineage.ts). Duality would break if the two
    // walks ever treated an edge asymmetrically — for instance if only one
    // direction deduplicated a revisited field.
    await fc.assert(
      fc.asyncProperty(diamondWorkspaceArbitrary, async ({ workspace, sink, branches, source }) => {
        const loaded = await loadGeneratedWorkspace(workspace);
        try {
          const edges = fieldEdgesFor(loaded);
          const candidates = [sink, ...branches, source];
          for (const x of candidates) {
            const downstreamOfX = traceFieldLineage(edges, createCanonicalFieldEndpoint(x), {
              depth: 3,
              direction: "downstream",
            }).downstream.map((hop) => hop.field as string);
            for (const y of candidates) {
              if (y === x) continue;
              const upstreamOfY = traceFieldLineage(edges, createCanonicalFieldEndpoint(y), {
                depth: 3,
                direction: "upstream",
              }).upstream.map((hop) => hop.field as string);
              assert.equal(
                downstreamOfX.includes(y),
                upstreamOfY.includes(x),
                `duality broke for ${x} -> ${y}:\n${loaded.sources}`,
              );
            }
          }
        } finally {
          disposeGeneratedWorkspace(loaded);
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("terminates on a generated cycle and reports each field at most once", async () => {
    // Cycle handling: `traceDirection`'s visited set must stop the walk rather
    // than looping forever, and must never emit the same field twice — a cycle
    // is the one shape where "reachable" and "reachable more than once" are
    // both true unless the traversal actively prevents the second.
    await fc.assert(
      fc.asyncProperty(cyclicWorkspaceArbitrary, async ({ workspace, loopLength, start }) => {
        const loaded = await loadGeneratedWorkspace(workspace);
        try {
          const edges = fieldEdgesFor(loaded);
          // A depth well past the loop's length would run forever if the walk
          // did not terminate; node's test runner timing out is itself a failure.
          const result = traceFieldLineage(edges, createCanonicalFieldEndpoint(start), {
            depth: loopLength * 3,
            direction: "downstream",
          });
          const fields = result.downstream.map((hop) => hop.field);
          assert.deepEqual([...new Set(fields)].sort(), fields.slice().sort());
          assert.ok(
            fields.length > 0,
            `expected the cycle to reach at least one field:\n${loaded.sources}`,
          );
        } finally {
          disposeGeneratedWorkspace(loaded);
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("agrees with graph --schema-only: schema lineage is the projection of field edges", async () => {
    // Ties the field-level walk to the schema-level one: `graph --schema-only`
    // aggregates field edges up to owning-schema pairs
    // (`aggregateFieldEdgesToSchemaLevel`), which is definitionally what
    // `scenarioSchemaProjection` computes from the scenario's own field edges.
    // The two are independent code paths over the same declared arrows.
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(chainWorkspaceArbitrary, diamondWorkspaceArbitrary, cyclicWorkspaceArbitrary),
        async ({ workspace }) => {
          const loaded = await loadGeneratedWorkspace(workspace);
          try {
            const expected = scenarioSchemaProjection(scenarioFieldEdges(workspace));
            const schemaOnly = graphFor(loaded, { schemaOnly: true }).edges;
            const actual = [
              ...new Set(
                schemaOnly
                  .filter((edge) => edge.from !== null && edge.to !== null)
                  .map((edge) => `${edge.from}->${edge.to}`),
              ),
            ].sort();
            assert.deepEqual(
              actual,
              expected,
              `graph --schema-only disagreed with the field-edge projection:\n${loaded.sources}`,
            );
          } finally {
            disposeGeneratedWorkspace(loaded);
          }
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

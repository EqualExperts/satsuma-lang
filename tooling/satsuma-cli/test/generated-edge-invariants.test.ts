/**
 * generated-edge-invariants.test.ts — structural invariants for the graph's edges.
 *
 * Two failure modes motivate this file, and neither is visible in the command that
 * causes it:
 *
 * **An emitted endpoint need not exist.** No consumer checks that the field it
 * names is declared. `qualifyField` ends with an unconditional
 * `` `${schemas[0]}.${field}` `` (`canonical-ref.ts:75`) and has no access to the
 * declared field set, so it cannot tell a bare field name from a container header
 * naming the schema root — and invents an endpoint for the latter (`r0-7w76`).
 *
 * **A dropped edge is indistinguishable from no edge.** Every resolver in the
 * chain fails closed by skipping. Skipping is sometimes correct, so nothing
 * separates the correct skips from the regressions: when container-relative arrows
 * were not qualified against their container, every such arrow resolved to no port,
 * nested-iteration mappings drew no lines at all, and no test failed
 * (`3cdd-yavi`, `sl-l7u0`).
 *
 * The properties below are stated against the *scenario*, which declares its own
 * arrows and is therefore the ground truth — no expected value is re-derived from
 * production code. See `@satsuma/scenario-gen`'s `ground-truth.js`.
 *
 * ## Two normalisation shims, both temporary
 *
 * `graph --json` spells the same entity two ways: `nodes[].id` and `schema_edges`
 * use the index-key form (`raw`), `edges[]` uses the canonical form (`::raw`), and
 * `edges[].mapping` uses the index-key form while `field-lineage`'s `via_mapping`
 * uses the canonical one. That is **`lgc-wtz1`**, which owns the representational
 * fix. These properties normalise both spellings so they test the invariant that
 * matters — is this endpoint declared, is it backed by a node — rather than failing
 * on a naming inconsistency they do not own. Delete {@link indexKey} and
 * {@link canonicalMappingKey} when that ticket lands.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  GENERATED_PROPERTY_PARAMETERS,
  containerWorkspaceArbitrary,
  namespacedWorkspaceArbitrary,
  scenarioDeclaredFieldPaths,
  scenarioFieldEdges,
  splitWorkspaceAcrossFiles,
  workspacePermutationsArbitrary,
  permuteWorkspaceDeclarations,
  workspaceScenarioArbitrary,
} from "@satsuma/scenario-gen";
import type { ScenarioWorkspace } from "@satsuma/scenario-gen";
import type { FieldEdge, WorkspaceGraph } from "#src/commands/graph-builder.js";
import {
  disposeGeneratedWorkspace,
  graphFor,
  loadGeneratedWorkspace,
  loadRenderedFiles,
} from "./support/generated-workspace.js";

// The WASM parser is initialised by `test/setup.ts`, which the test script
// preloads with `--import`.

// ── Normalisation shims (lgc-wtz1) ─────────────────────────────────────────

/** The index-key spelling of an entity id: `::raw` and `raw` are the same node. */
function indexKey(id: string): string {
  return id.startsWith("::") ? id.slice(2) : id;
}

/** The canonical spelling of a mapping key, so `m0` and `::m0` compare equal. */
function canonicalMappingKey(mapping: string): string {
  return mapping.includes("::") ? mapping : `::${mapping}`;
}

// ── Edge identity ──────────────────────────────────────────────────────────

/**
 * One edge as a comparable string.
 *
 * Identity is `(from, to, mapping, classification)`. File and line are excluded on
 * purpose: they are provenance, and including them would make the order- and
 * file-independence properties trivially false for the wrong reason — moving a
 * declaration *does* change its line.
 */
function edgeKey(edge: {
  from: string | null;
  to: string | null;
  mapping: string;
  classification: string;
}): string {
  return `${edge.from} -> ${edge.to} | ${canonicalMappingKey(edge.mapping)} | ${edge.classification}`;
}

/** Sorted edge keys, so a mismatch reads as a set difference. */
function edgeKeys(edges: FieldEdge[]): string[] {
  return edges.map(edgeKey).sort();
}

/**
 * The schema that owns a canonical field endpoint.
 *
 * Read structurally — everything before the first `.` *after* the `::` separator —
 * rather than by splitting on the first `.`, which is wrong for a namespaced key
 * and is the ad-hoc unbranding R6 (`sl-jyee`) replaces.
 */
function owningSchema(endpoint: string): string {
  const separator = endpoint.indexOf("::");
  const dot = endpoint.indexOf(".", separator + 2);
  return dot === -1 ? endpoint : endpoint.slice(0, dot);
}

/** Run `check` against a loaded generated workspace, always cleaning up after. */
async function withGraph(
  workspace: ScenarioWorkspace,
  check: (graph: WorkspaceGraph, sources: string) => void,
  opts?: Parameters<typeof graphFor>[1],
): Promise<void> {
  const loaded = await loadGeneratedWorkspace(workspace);
  try {
    check(graphFor(loaded, opts), loaded.sources);
  } finally {
    disposeGeneratedWorkspace(loaded);
  }
}

describe("nothing invented: every emitted endpoint is a declared field (sl-hi0z)", () => {
  it("names only declared paths in the endpoints of every field edge", async () => {
    // P1. The defect class is an endpoint the workspace does not declare, which is
    // invisible in the emitting command and surfaces only when a *different*
    // command is asked about the same name. Containers count as declared paths: an
    // `each` header legitimately names two of them.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        const declared = new Set(scenarioDeclaredFieldPaths(workspace));
        await withGraph(workspace, (graph, sources) => {
          const invented = graph.edges
            .flatMap((edge) => [edge.from, edge.to])
            .filter((endpoint): endpoint is string => endpoint !== null)
            .filter((endpoint) => !declared.has(endpoint));
          assert.deepEqual(
            [...new Set(invented)].sort(),
            [],
            `graph named an undeclared field endpoint:\n${sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("invents ::mart.mart when a container header targets the target schema root (r0-7w76)", async () => {
    // ⚠️ THIS TEST PINS A KNOWN DEFECT. It asserts what the graph does *today*, not
    // what it should do, so it will go **red the moment r0-7w76 is decided** — at
    // which point invert it to the invariant stated in the sibling property above
    // and delete this comment. It is not an endorsement of the behaviour.
    //
    // `qualifyField` cannot tell `flatten rows -> mart` — a header naming the target
    // *schema* — from a bare field name, so it emits `::mart.mart`, a field nothing
    // declares, while `satsuma validate` reads the same token correctly. Core holds
    // two readings of one authored form.
    //
    // Pinned rather than skipped for two reasons. A skipped test proves nothing, and
    // `{ todo: … }` is not usable here: node's JUnit reporter puts a `failure=`
    // attribute on a failing todo case, which fails CI's test-report check.
    //
    // It is a literal fixture rather than a scenario because a scenario endpoint is
    // `{ schema, path }` and a schema root has no path.
    const loaded = await loadRenderedFiles([
      {
        path: "entry.stm",
        source: [
          "schema observations {",
          "  rows list_of record {",
          "    species STRING",
          "  }",
          "}",
          "",
          "schema mart {",
          "  species STRING",
          "}",
          "",
          "mapping load {",
          "  source { observations }",
          "  target { mart }",
          "  flatten rows -> mart {",
          "    .species -> species",
          "  }",
          "}",
          "",
        ].join("\n"),
      },
    ]);
    try {
      const declared = new Set([
        "::observations.rows",
        "::observations.rows.species",
        "::mart.species",
      ]);
      const emitted = graphFor(loaded)
        .edges.flatMap((edge) => [edge.from, edge.to])
        .filter((endpoint): endpoint is string => endpoint !== null);
      assert.deepEqual(
        [...new Set(emitted.filter((endpoint) => !declared.has(endpoint)))],
        ["::mart.mart"],
        `r0-7w76's invented endpoint changed — read this test's comment before ` +
          `updating the expectation:\n${loaded.sources}`,
      );
    } finally {
      disposeGeneratedWorkspace(loaded);
    }
  });
});

describe("nothing dropped: the emitted edge set is exactly the declared one (sl-hi0z)", () => {
  it("emits every declared arrow's edge exactly once, and emits nothing else", async () => {
    // P2 in both directions. A dropped edge and an invented one are the same
    // assertion from either side, and *exactly once* is the part that matters: an
    // arrow registered under several index keys can be emitted twice, which
    // double-counts lineage without ever looking wrong.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        const expected = scenarioFieldEdges(workspace).map(edgeKey).sort();
        await withGraph(workspace, (graph, sources) => {
          assert.deepEqual(
            edgeKeys(graph.edges),
            expected,
            `graph edges are not exactly the declared arrows:\n${sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("draws an edge for every arrow inside a nested container block", async () => {
    // The `3cdd-yavi` class, stated on the axis that produces it. Kept separate
    // from the general property above so a counterexample is a container workspace
    // rather than whichever shape `oneof` happened to pick — the difference between
    // a failure that names the defect and one that merely reports a mismatch.
    await fc.assert(
      fc.asyncProperty(containerWorkspaceArbitrary, async ({ workspace, kind, depth }) => {
        const expected = scenarioFieldEdges(workspace).map(edgeKey).sort();
        await withGraph(workspace, (graph, sources) => {
          assert.deepEqual(
            edgeKeys(graph.edges),
            expected,
            `${kind} nested ${depth} deep lost or invented an edge:\n${sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

describe("structural consistency: every endpoint is backed by a node (sl-hi0z)", () => {
  it("has a node for the schema owning each field-edge endpoint", async () => {
    // Promotes the backfill block at `graph-builder.ts:196-249` from an invariant
    // maintained by construction to one that is stated. Its comment claims callers
    // "can rely on structural consistency without further checks" — this is the
    // check that makes the claim true.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        await withGraph(workspace, (graph, sources) => {
          const nodeIds = new Set(graph.nodes.map((node) => indexKey(String(node.id))));
          const orphans = graph.edges
            .flatMap((edge) => [edge.from, edge.to])
            .filter((endpoint): endpoint is string => endpoint !== null)
            .map((endpoint) => indexKey(owningSchema(endpoint)))
            .filter((schema) => !nodeIds.has(schema));
          assert.deepEqual(
            [...new Set(orphans)].sort(),
            [],
            `edge endpoint has no node:\n${sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("has a node for both ends of every schema edge, under a namespace filter too", async () => {
    // The namespace filter is where this breaks: a filtered graph's schema edges
    // legitimately reference cross-namespace schemas and bridging mappings that the
    // filter excluded, which is precisely why the backfill exists (`sl-p895`).
    // Every namespace present in the workspace is filtered on in turn, plus the
    // unfiltered case, so no run is vacuous.
    await fc.assert(
      fc.asyncProperty(namespacedWorkspaceArbitrary, async ({ workspace, namespaces }) => {
        for (const namespace of [null, ...new Set(namespaces.filter(Boolean))]) {
          await withGraph(
            workspace,
            (graph, sources) => {
              const nodeIds = new Set(graph.nodes.map((node) => indexKey(String(node.id))));
              const orphans = graph.schema_edges
                .flatMap((edge) => [edge.from, edge.to])
                .map(indexKey)
                .filter((id) => !nodeIds.has(id));
              assert.deepEqual(
                [...new Set(orphans)].sort(),
                [],
                `schema edge endpoint has no node under --namespace ${namespace}:\n${sources}`,
              );
            },
            { namespace },
          );
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("emits only a subset of the unfiltered edges when filtering by namespace", async () => {
    // Filter soundness as a general rule. A filter may narrow the answer; it may
    // never *change* it, and it may certainly never manufacture an edge the
    // unfiltered graph does not contain.
    await fc.assert(
      fc.asyncProperty(namespacedWorkspaceArbitrary, async ({ workspace, namespaces }) => {
        const loaded = await loadGeneratedWorkspace(workspace);
        try {
          const unfiltered = new Set(edgeKeys(graphFor(loaded).edges));
          for (const namespace of new Set(namespaces.filter(Boolean))) {
            const filtered = edgeKeys(graphFor(loaded, { namespace }).edges);
            const extra = filtered.filter((key) => !unfiltered.has(key));
            assert.deepEqual(
              extra,
              [],
              `--namespace ${namespace} invented edges:\n${loaded.sources}`,
            );
          }
        } finally {
          disposeGeneratedWorkspace(loaded);
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

describe("the edge set does not depend on how the workspace is written (sl-hi0z)", () => {
  it("emits the same edges when declarations are reordered", async () => {
    // Nothing about which fields flow where is a function of declaration order —
    // but `qualifyField` attaches an unqualified path to the *first* schema on its
    // side, so order-sensitivity is a live risk rather than a theoretical one.
    await fc.assert(
      fc.asyncProperty(
        workspaceScenarioArbitrary.chain((workspace: ScenarioWorkspace) =>
          fc.tuple(fc.constant(workspace), workspacePermutationsArbitrary(workspace)),
        ),
        async ([workspace, permutations]) => {
          const permuted = permuteWorkspaceDeclarations(workspace, permutations);
          const loaded = await loadGeneratedWorkspace(workspace);
          const reordered = await loadGeneratedWorkspace(permuted);
          try {
            assert.deepEqual(
              edgeKeys(graphFor(reordered).edges),
              edgeKeys(graphFor(loaded).edges),
              `reordering declarations changed the edge set:\nORIGINAL\n${loaded.sources}\nREORDERED\n${reordered.sources}`,
            );
          } finally {
            disposeGeneratedWorkspace(loaded);
            disposeGeneratedWorkspace(reordered);
          }
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("emits the same edges when the same declarations are split across more files", async () => {
    // File-independence, which the import-merge path assumes and never states: a
    // merged multi-file model has no single declaration order, and no file boundary
    // should be visible in the answer.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        const loaded = await loadGeneratedWorkspace(workspace);
        const split = await loadGeneratedWorkspace(splitWorkspaceAcrossFiles(workspace));
        try {
          assert.deepEqual(
            edgeKeys(graphFor(split).edges),
            edgeKeys(graphFor(loaded).edges),
            `splitting across files changed the edge set:\nORIGINAL\n${loaded.sources}\nSPLIT\n${split.sources}`,
          );
        } finally {
          disposeGeneratedWorkspace(loaded);
          disposeGeneratedWorkspace(split);
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

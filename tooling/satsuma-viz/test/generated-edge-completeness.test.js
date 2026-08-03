/**
 * generated-edge-completeness.test.js — every arrow the model holds gets drawn.
 *
 * The layout's port resolution fails closed: `elk-layout.ts` ends its edge loop
 * with `if (!sourceNode || !srcPort || !tgtPort) continue;`. Skipping is sometimes
 * correct — ELK throws if an edge names a port that does not exist — so nothing
 * distinguishes a correct skip from a regression. When container-relative arrows
 * were not qualified against their container, *every* such arrow resolved to no
 * port: nested-iteration mappings drew no lines at all, and no test failed
 * (`3cdd-yavi`, `sl-l7u0`).
 *
 * This file closes that blind spot without forbidding legitimate skips, by
 * comparing the drawn edges against the *scenario's own declared arrows* — ground
 * truth from `@satsuma/scenario-gen`, not re-derived from any production walk — and
 * enumerating the omissions that are allowed.
 *
 * ## The permitted omissions, and why each one is legitimate
 *
 * The viz's edge set is deliberately a subset of the CLI's. Three kinds of
 * declared edge are not drawn, and the property lists them explicitly so that a
 * *fourth* kind going missing is a failure rather than a shrug:
 *
 * 1. **`nl-derived` edges.** The implicit tier resolved from `@ref` mentions in
 *    transform prose. The VizModel carries no resolved NL refs at all, so the
 *    layout could not draw them; `satsuma graph` resolves them and does.
 * 2. **Container *header* edges** — the `each`/`flatten` header's own
 *    source→target pair. The viz treats a block header as a *scope* rather than an
 *    arrow, consistently in both its walks: `forEachMappingArrow` does not visit
 *    headers and `addMappingEdges` does not draw them. `satsuma graph` counts the
 *    header as an arrow record and emits an edge for it. Whether that difference is
 *    right is a question for the R5 parity sweep (`sl-kwet`); it is a coherent
 *    convention, not a dropped edge, so it is permitted here.
 * 3. **Computed (sourceless) arrows** — see the `todo` property below. This one is
 *    a *bug*, `lgc-4bxl`, and is excluded from the main property rather than
 *    blessed by it.
 *
 * `@satsuma/viz-backend` and `@satsuma/scenario-gen` are devDependencies for
 * exactly this. The runtime dependency still runs component → core, and nothing in
 * the shipped bundle changes.
 */
import "./dom-shim.js";
import { before, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { getParser, initParser } from "@satsuma/core";
import { createWorkspaceIndex, indexFile } from "@satsuma/viz-backend/workspace-index";
import { buildVizModel } from "@satsuma/viz-backend/viz-model";
import {
  GENERATED_PROPERTY_PARAMETERS,
  chainWorkspaceArbitrary,
  containerWorkspaceArbitrary,
  multiSourceWorkspaceArbitrary,
  namespacedWorkspaceArbitrary,
  renderWorkspace,
  scenarioFieldEdges,
  spreadWorkspaceArbitrary,
} from "@satsuma/scenario-gen";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

/** @type {typeof import("../dist/satsuma-viz.js")} */
let viz;

before(async () => {
  await initParser(WASM_PATH);
  viz = await import("../dist/satsuma-viz.js");
});

/**
 * Build the VizModel for a generated workspace's entry file.
 *
 * Assembled the way a host assembles it: index every file so cross-file imports
 * resolve, then build the model for the entry. This is the viz package's thin
 * adapter for a generated scenario — the generator itself stays free of pipeline
 * code, which is what stops it becoming a second production implementation.
 */
function modelFor(workspace) {
  const parser = getParser();
  const files = renderWorkspace(workspace);
  const index = createWorkspaceIndex();
  const trees = new Map();
  for (const file of files) {
    const uri = `file:///${file.path}`;
    const tree = parser.parse(file.source);
    trees.set(uri, tree);
    indexFile(index, uri, tree);
  }
  const entryUri = `file:///${files[0].path}`;
  return {
    model: buildVizModel(entryUri, trees.get(entryUri), index),
    sources: files.map((file) => `── ${file.path}\n${file.source}`).join("\n"),
  };
}

/**
 * `schema.path -> schema.path` for one drawn edge.
 *
 * The layout reports node ids, which are the model's *unprefixed* entity ids, and
 * the scenario's canonical keys carry a `[ns]::` prefix. Both are reduced to the
 * bare `name.path` form so the two are comparable — the differing spellings are
 * `lgc-wtz1`, and normalising here keeps this property about edges rather than
 * about naming.
 */
function drawnKey(edge) {
  return `${bare(edge.sourceNode)}.${edge.sourceField} -> ${bare(edge.targetNode)}.${edge.targetField}`;
}

/** Strip a canonical key's namespace separator down to the id the layout uses. */
function bare(id) {
  const separator = String(id).indexOf("::");
  return separator === -1 ? String(id) : String(id).slice(separator + 2);
}

/** `schema.path -> schema.path` for one scenario edge, in the same bare form. */
function declaredKey(edge) {
  return `${bare(edge.from)} -> ${bare(edge.to)}`;
}

/**
 * The scenario edges the layout is expected to draw: everything except the three
 * permitted omissions documented in this file's header.
 */
function expectedDrawnEdges(workspace) {
  return scenarioFieldEdges(workspace)
    .filter((edge) => edge.classification !== "nl-derived")
    .filter((edge) => edge.kind !== "each" && edge.kind !== "flatten")
    .filter((edge) => edge.from !== null)
    .map(declaredKey)
    .sort();
}

/** Assert the layout draws exactly the expected edges for one generated workspace. */
async function assertEdgesMatch(workspace, note) {
  const { model, sources } = modelFor(workspace);
  const layout = await viz.computeLayout(model);
  assert.deepEqual(
    layout.edges.map(drawnKey).sort(),
    expectedDrawnEdges(workspace),
    `${note}:\n${sources}`,
  );
}

describe("the layout draws every declared arrow (sl-hi0z)", () => {
  it("draws one edge per declared arrow across a chain of mappings", async () => {
    // The baseline. Several mappings in one model, each with its own arrows: an
    // off-by-one in the per-mapping edge loop, or an arrow attributed to the wrong
    // card, shows up here and nowhere in a single-mapping fixture.
    await fc.assert(
      fc.asyncProperty(chainWorkspaceArbitrary, async ({ workspace }) => {
        await assertEdgesMatch(workspace, "chain lost or invented a drawn edge");
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("draws every arrow nested inside an each or flatten block", async () => {
    // The `3cdd-yavi` class exactly. Ports are keyed by declared field path, so an
    // arrow authored element-relative (`.sku -> .sku`) must be qualified against
    // its container before a port can match. Get that wrong and every arrow in the
    // block resolves to no port, the mapping renders with no lines, and the only
    // symptom is a picture nobody asserted on.
    await fc.assert(
      fc.asyncProperty(containerWorkspaceArbitrary, async ({ workspace, kind, depth }) => {
        await assertEdgesMatch(workspace, `${kind} nested ${depth} deep drew the wrong edges`);
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("draws only the first source of a multi-source arrow (lgc-fu7o)", async () => {
    // ⚠️ THIS TEST PINS A KNOWN DEFECT — see the note at the head of the r0-7w76
    // test in satsuma-cli/test/generated-edge-invariants.test.ts for why a pinned
    // divergence is used here rather than `{ todo: … }`. It asserts what the layout
    // does *today* and goes **red when lgc-fu7o is fixed**, at which point replace
    // it with `assertEdgesMatch`, which already states the correct invariant.
    //
    // Spec §4.2: `a, b -> t` is one edge *per source*, all to the same target.
    // `addMappingEdges` reads `a.sourceFields[0]` and nothing else, so the viz draws
    // one line and omits the rest of the arrow's provenance. The hover path does not
    // share the omission — `sz-edge-layer.ts:218` highlights on the whole authored
    // `arrow.sourceFields` — so hovering the *second* source highlights the single
    // drawn edge, which runs to the *first* source's card. Pointing at the wrong
    // schema is worse than drawing nothing.
    await fc.assert(
      fc.asyncProperty(multiSourceWorkspaceArbitrary, async ({ workspace, expectedSources }) => {
        const { model, sources } = modelFor(workspace);
        const layout = await viz.computeLayout(model);
        assert.equal(
          layout.edges.length,
          1,
          `expected lgc-fu7o's single edge for ${expectedSources.length} sources:\n${sources}`,
        );
        // The drawn edge belongs to the *first* declared source, and its recorded
        // `sourceField` keeps the authored schema prefix — the second half of
        // lgc-fu7o, latent today because nothing matches on that field.
        assert.equal(layout.edges[0].sourceNode, "s0", `edge left the first source's card`);
        assert.equal(layout.edges[0].sourceField, "s0.field_0", `sourceField form changed`);
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("draws an arrow whose endpoint is declared only by a spread fragment", async () => {
    // Ports exist for spread-expanded fields, so an arrow naming one must resolve.
    // If spread expansion ever stopped feeding the card's declared fields, this
    // arrow would silently lose its line while every body-declared arrow kept one.
    await fc.assert(
      fc.asyncProperty(spreadWorkspaceArbitrary, async ({ workspace }) => {
        await assertEdgesMatch(workspace, "an arrow onto a spread field drew the wrong edges");
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("draws the same arrows when the schemas are namespaced", async () => {
    // Node ids gain a namespace prefix, and the authored refs in the mapping's
    // source/target lists gain `ns::`. Field paths do not change, so neither should
    // the drawn edge set — a resolver that mistook a namespace separator for part
    // of a field path would lose exactly these edges.
    await fc.assert(
      fc.asyncProperty(namespacedWorkspaceArbitrary, async ({ workspace }) => {
        await assertEdgesMatch(workspace, "namespacing changed the drawn edge set");
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("draws a computed arrow as a phantom line from a same-named source field (lgc-4bxl)", async () => {
    // ⚠️ THIS TEST PINS A KNOWN DEFECT, for the reasons given on the multi-source
    // test above. It goes **red when lgc-4bxl is fixed**; at that point assert that
    // no edge has an empty `arrow.sourceFields`, which is the invariant that matters.
    //
    // A computed arrow declares a target with no source. `addMappingEdges` falls back
    // to `sourceField = targetField`, so it looks the target's own name up in the
    // *source* schema: where a field of that name exists — the normal case, since
    // matching names on both sides is the norm — the viz draws a line asserting
    // lineage the Satsuma explicitly denies. Where it does not, the edge is silently
    // dropped instead. A phantom lineage edge is worse than a missing one: it is a
    // confident claim about where data came from.
    const source = `
schema s0 {
  a STRING
  stamp STRING
}
schema s1 {
  a STRING
  stamp STRING
}
mapping m0 {
  source { s0 }
  target { s1 }
  a -> a
  -> stamp { "Set at load time; no source field." }
}
`;
    const parser = getParser();
    const index = createWorkspaceIndex();
    const uri = "file:///entry.stm";
    const tree = parser.parse(source);
    indexFile(index, uri, tree);
    const layout = await viz.computeLayout(buildVizModel(uri, tree, index));

    const phantom = layout.edges.filter((edge) => edge.arrow.sourceFields.length === 0);
    assert.deepEqual(
      phantom.map(drawnKey),
      ["s0.stamp -> s1.stamp"],
      `lgc-4bxl's phantom edge changed — read this test's comment before updating ` +
        `the expectation:\n${source}`,
    );
  });
});

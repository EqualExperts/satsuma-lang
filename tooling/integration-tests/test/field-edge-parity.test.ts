/**
 * field-edge-parity.test.ts — the CLI's field edges and the VizModel's arrows
 * (the payload both the webview and the LSP's merged full-lineage model
 * consume) agree, over the example corpus and over generated workspaces.
 *
 * Feature 41's P4: "what field does this arrow point at, and which schema
 * owns it" is answered independently by the CLI's extraction
 * (`satsuma-cli/src/index-builder.ts`, itself a thin wrapper over core's
 * `extractMappings`) and by `viz-backend`'s own CST walk
 * (`viz-model.ts`'s `extractMapping`/`extractArrow`). `field-coverage.ts`'s
 * arrow walk states in its own doc-comment that it "mirrors core's
 * `extractArrowRecords`"; nothing before this file tested that claim. Coverage
 * learned this the expensive way (ADR-036, ADR-037, sl-46wr, sl-csrs): a
 * consumer that derives its own answer from the model's arrows drifts.
 *
 * **Both sides feed the same core edge builder.** Rather than compare two
 * independently-resolved edge lists (which would make every disagreement a
 * question of whose resolution policy is right — exactly the `r0-7w76`
 * question this feature explicitly does not decide), both the CLI's index and
 * the VizModel are adapted to core's `FieldEdgeSource` and run through the
 * *same* `buildFieldEdges`, using the *same* `resolveEndpoint`
 * (`satsuma-cli`'s `arrowEndpoint`, via `satsuma-cli/testing`). A
 * disagreement therefore can only be an extraction-pipeline bug — one walk
 * saw an arrow, or a path, the other didn't — never a resolution question.
 * The viz-side adapter lives in `test/support/viz-field-edges.ts`.
 *
 * **Two documented, permitted asymmetries, excluded from the comparison
 * rather than silently tolerated:**
 *
 * 1. **`nl-derived` edges.** A `VizModel` carries no resolved NL `@ref`s — the
 *    same asymmetry `satsuma-viz`'s `generated-edge-completeness.test.js`
 *    (sl-hi0z) already names for the layout.
 * 2. **`each`/`flatten` container headers.** The CLI's extraction counts a
 *    container header as an arrow record in its own right; the viz walk
 *    treats it as a *scope*, never a field-to-field edge (consistently in
 *    both `forEachMappingArrow` and the layout). A `nested_arrow` block's
 *    header is the odd one out and is genuinely drawn on both sides
 *    (`headerArrowOf`), so it is *not* excluded here.
 *
 * Any other disagreement is real and gets recorded against a bug ticket, per
 * this ticket's acceptance criteria — not accommodated by weakening the
 * assertion.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { getParser, buildFieldEdges } from "@satsuma/core";
import type { FieldEdge } from "@satsuma/core";
import {
  createWorkspaceIndex,
  indexFile,
  getImportReachableUris,
  createScopedIndex,
} from "@satsuma/viz-backend/workspace-index";
import { buildVizModel } from "@satsuma/viz-backend/viz-model";
import { loadWorkspace, createFieldEdgeSource, distinctArrowRecords } from "satsuma-cli/testing";
import {
  GENERATED_PROPERTY_PARAMETERS,
  chainWorkspaceArbitrary,
  computedArrowWorkspaceArbitrary,
  containerWorkspaceArbitrary,
  diamondWorkspaceArbitrary,
  cyclicWorkspaceArbitrary,
  metricWorkspaceArbitrary,
  multiSourceWorkspaceArbitrary,
  namespacedWorkspaceArbitrary,
  nlRefWorkspaceArbitrary,
  spreadWorkspaceArbitrary,
} from "@satsuma/scenario-gen";
import type { ScenarioWorkspace } from "@satsuma/scenario-gen";
import { vizFieldEdgeSource } from "./support/viz-field-edges.js";
import {
  cliFieldEdgesFor,
  disposeGeneratedWorkspace,
  loadGeneratedWorkspace,
} from "./support/generated-workspace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../examples");

/** Container-header kinds the viz walk never turns into a field-to-field edge. */
const HEADER_KINDS = new Set(["each", "flatten"]);

/** Every `.stm` file under `examples/`, sorted for a stable report order. */
function corpusFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) corpusFiles(path, out);
    else if (name.endsWith(".stm")) out.push(path);
  }
  return out;
}

/**
 * One edge as a comparable string: identity is `(from, to, mapping,
 * classification)`. `file`/`line` are excluded — they are provenance, and a
 * generated workspace's declaration order is not part of either side's claim.
 */
function edgeKey(edge: {
  from: string | null;
  to: string | null;
  mapping: string;
  classification: string;
}): string {
  return `${edge.from} -> ${edge.to} | ${edge.mapping} | ${edge.classification}`;
}

/**
 * The CLI's field edges, minus the two documented asymmetries the viz side
 * structurally cannot produce (see this file's header). `kind` is looked up
 * per edge from the extraction's own `ArrowRecord`s — `FieldEdge` itself
 * doesn't carry it, since a field-lineage or graph consumer has no use for it,
 * but `file`+`line`+`mapping` identify the one arrow record an edge came from.
 */
function comparableCliEdges(
  edges: readonly FieldEdge[],
  index: Parameters<typeof distinctArrowRecords>[0],
): FieldEdge[] {
  const kindOf = new Map<string, string>();
  for (const record of distinctArrowRecords(index)) {
    const mapping = record.namespace
      ? `${record.namespace}::${record.mapping}`
      : (record.mapping ?? "");
    // `FieldEdge.line` is 1-based (`declaredEdgeMetadata`'s `arrow.line + 1`,
    // for user-facing output); `ArrowRecord.line` is the raw 0-based
    // extraction row. Both name the same arrow — only the offset differs.
    kindOf.set(`${record.file}:${record.line + 1}:${mapping}`, record.kind);
  }
  return edges.filter((edge) => {
    if (edge.classification === "nl-derived") return false;
    const kind = kindOf.get(`${edge.file}:${edge.line}:${edge.mapping}`);
    return !kind || !HEADER_KINDS.has(kind);
  });
}

/** Sorted, deduplicated edge keys, so a mismatch reads as a set difference. */
function edgeKeys(edges: readonly FieldEdge[]): string[] {
  return [...new Set(edges.map(edgeKey))].sort();
}

describe("the CLI's field edges agree with the VizModel's over the example corpus (sl-kwet)", () => {
  let corpus: string[];

  before(() => {
    corpus = corpusFiles(EXAMPLES);
    assert.ok(corpus.length > 20, `expected a corpus to sweep, found ${corpus.length} files`);
  });

  it("reports the same field edges for every file, once the documented asymmetries are excluded", async () => {
    const disagreements: string[] = [];
    let compared = 0;

    for (const file of corpus) {
      const relative = file.slice(EXAMPLES.length + 1);

      const { index } = await loadWorkspace(file);
      const cli = edgeKeys(
        comparableCliEdges(buildFieldEdges(createFieldEdgeSource(index)).edges, index.fieldArrows),
      );

      const parser = getParser();
      const wsIndex = createWorkspaceIndex();
      for (const path of corpus) {
        const tree = parser.parse(readFileSync(path, "utf8"));
        if (tree) indexFile(wsIndex, `file://${path}`, tree);
      }
      const entryUri = `file://${file}`;
      const entryTree = parser.parse(readFileSync(file, "utf8"));
      if (!entryTree) continue;
      const scoped = createScopedIndex(wsIndex, getImportReachableUris(entryUri, wsIndex));
      const model = buildVizModel(entryUri, entryTree, scoped);
      const viz = edgeKeys(buildFieldEdges(vizFieldEdgeSource(model)).edges);

      // The CLI reads the whole workspace (entry plus transitive imports); a
      // VizModel is one file — the same scope difference coverage-viz-parity
      // accounts for. So the narrower (viz) side is iterated: every edge it
      // reports must also be a CLI edge, and a CLI edge from an imported file
      // that the model never rendered is not a disagreement.
      const cliSet = new Set(cli);
      for (const key of viz) {
        compared++;
        if (!cliSet.has(key)) {
          disagreements.push(`${relative}: viz has an edge the CLI does not — ${key}`);
        }
      }
    }

    assert.deepEqual(disagreements, []);
    // Guards the guard: a walk that silently compared nothing would pass forever.
    assert.ok(compared > 50, `expected the sweep to compare real edges, compared ${compared}`);
  });
});

/**
 * Every single-file generated-workspace shape `@satsuma/scenario-gen` offers.
 * Deliberately narrower than the package's own `workspaceScenarioArbitrary`
 * union, which also includes multi-file shapes (`multiFileWorkspaceArbitrary`,
 * `splitWorkspaceAcrossFiles`) — those hit the same CLI-workspace-vs-
 * VizModel-one-file scope difference the corpus sweep above already covers via
 * the narrower-side rule, so this property stays single-file and asserts the
 * *stronger* claim full set equality gives on that domain.
 */
const singleFileWorkspaceArbitrary = fc.oneof(
  chainWorkspaceArbitrary.map(({ workspace }) => workspace),
  diamondWorkspaceArbitrary.map(({ workspace }) => workspace),
  cyclicWorkspaceArbitrary.map(({ workspace }) => workspace),
  namespacedWorkspaceArbitrary.map(({ workspace }) => workspace),
  containerWorkspaceArbitrary.map(({ workspace }) => workspace),
  nlRefWorkspaceArbitrary.map(({ workspace }) => workspace),
  computedArrowWorkspaceArbitrary.map(({ workspace }) => workspace),
  metricWorkspaceArbitrary.map(({ workspace }) => workspace),
  spreadWorkspaceArbitrary.map(({ workspace }) => workspace),
  multiSourceWorkspaceArbitrary.map(({ workspace }) => workspace),
);

describe("the CLI's field edges agree with the VizModel's over generated workspaces (sl-kwet)", () => {
  it("reports the same field edges for a single-file generated workspace", async () => {
    // A single-file workspace means CLI-workspace scope and VizModel-file
    // scope coincide — full set equality, not the narrower-side rule the real
    // corpus needs for multi-file examples.
    await fc.assert(
      fc.asyncProperty(singleFileWorkspaceArbitrary, async (workspace: ScenarioWorkspace) => {
        const loaded = await loadGeneratedWorkspace(workspace);
        try {
          const cli = edgeKeys(
            comparableCliEdges(cliFieldEdgesFor(loaded), loaded.index.fieldArrows),
          );

          const parser = getParser();
          const wsIndex = createWorkspaceIndex();
          const tree = parser.parse(readFileSync(loaded.entryPath, "utf8"));
          if (!tree) throw new Error("generated workspace failed to parse");
          const entryUri = `file://${loaded.entryPath}`;
          indexFile(wsIndex, entryUri, tree);
          const model = buildVizModel(entryUri, tree, wsIndex);
          const viz = edgeKeys(buildFieldEdges(vizFieldEdgeSource(model)).edges);

          assert.deepEqual(viz, cli, `viz and CLI disagreed on field edges:\n${loaded.sources}`);
        } finally {
          disposeGeneratedWorkspace(loaded);
        }
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

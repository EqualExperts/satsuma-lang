/**
 * model-from-sources.ts — build a VizModel from in-memory document sources.
 *
 * This is the runtime-agnostic core of model building. Given a set of documents
 * as `{ uri, source }` pairs and an entry URI, it parses each source, indexes
 * them into a fresh WorkspaceIndex, and assembles either a single-file model or
 * a full cross-file-lineage model (the import-reachable merge).
 *
 * It owns the parse → index → buildVizModel → (merge) pipeline that was
 * previously inlined in the harness Node server's `/api/model` handler. The
 * server reads documents from the filesystem; the browser playground reads them
 * from its localStorage document library. Both feed the *same* function here, so
 * the two hosts produce byte-identical models — that equivalence is what the
 * feature-33 client/server parity test pins. This module does NOT own document
 * loading (fs vs localStorage); it owns only resolution and assembly.
 *
 * Requires the @satsuma/core WASM parser to be initialised (`initParser`) by the
 * caller before use; it parses via the shared `getParser()` singleton.
 */

import {
  getImportReachableUris,
  getUnresolvedImportPaths,
  createScopedIndex,
} from "./workspace-index";
import { buildVizModel, mergeVizModels } from "./viz-model";
import type { VizModel } from "./viz-model";
import { buildInMemoryWorkspace } from "./in-memory-workspace";
import type { SourceDocument } from "./in-memory-workspace";

export type { SourceDocument } from "./in-memory-workspace";

/** Options controlling how the entry document's model is assembled. */
export interface BuildModelOptions {
  /**
   * When true, merge the VizModels of all import-reachable documents into one
   * cross-file lineage model. When false (default), build a single-file model
   * scoped to the entry's import graph — matching the LSP's per-file behaviour.
   */
  lineage?: boolean;
}

/** An empty model for `uri` — used when the entry document cannot be parsed. */
function emptyModel(uri: string): VizModel {
  return { uri, fileNotes: [], namespaces: [] };
}

/**
 * A built model plus the diagnostics a live-editing consumer needs to explain
 * what the model does NOT contain.
 */
export interface BuildModelResult {
  /** The assembled model — identical to `buildModelFromSources` output. */
  model: VizModel;
  /**
   * Import path texts (as authored) in the entry's import graph that did not
   * resolve to any provided document. Non-empty means the model was built
   * without those files — the playground surfaces this as a visible note
   * (feature 33: a buffer importing a path outside the library renders without
   * it, never silently).
   */
  unresolvedImports: string[];
}

/**
 * Build a VizModel for `entryUri` from a set of in-memory `documents`, also
 * reporting which import paths failed to resolve against the document set.
 *
 * Parses and indexes every document, then assembles the entry's model. In
 * lineage mode the import-reachable documents are merged; otherwise the entry
 * is rendered single-file against an import-scoped index. Documents that fail
 * to parse are skipped; if the entry itself is absent or unparseable, an empty
 * model is returned rather than throwing, so a mid-edit buffer never crashes the
 * caller (the live editor keeps its last good visualization on top of this).
 *
 * Invariant: the model produced here is identical to the one the Node server's
 * `/api/model` handler produced for the same documents, because both paths run
 * this function.
 */
export function buildModelResultFromSources(
  entryUri: string,
  documents: SourceDocument[],
  options: BuildModelOptions = {},
): BuildModelResult {
  // Model and chain builders share one parse/index pipeline so their import
  // scope and URI identity cannot diverge.
  const { index, treesByUri } = buildInMemoryWorkspace(documents);

  const entryTree = treesByUri.get(entryUri);
  if (!entryTree) return { model: emptyModel(entryUri), unresolvedImports: [] };

  // Scope resolution to the entry's import graph, matching the server and LSP.
  const reachable = getImportReachableUris(entryUri, index);
  const scopedIndex = createScopedIndex(index, reachable);
  const unresolvedImports = getUnresolvedImportPaths(entryUri, index);

  if (!options.lineage) {
    return { model: buildVizModel(entryUri, entryTree, scopedIndex), unresolvedImports };
  }

  // Lineage: assemble a model per reachable document, then merge into one
  // cross-file graph rooted at the entry.
  const models: VizModel[] = [];
  for (const reachableUri of reachable) {
    const tree = treesByUri.get(reachableUri);
    if (!tree) continue;
    models.push(buildVizModel(reachableUri, tree, scopedIndex));
  }
  return { model: mergeVizModels(entryUri, models), unresolvedImports };
}

/**
 * Build a VizModel for `entryUri` from in-memory `documents`. Convenience form
 * of `buildModelResultFromSources` for consumers that do not need the
 * unresolved-import diagnostics (e.g. parity tests, batch tooling).
 */
export function buildModelFromSources(
  entryUri: string,
  documents: SourceDocument[],
  options: BuildModelOptions = {},
): VizModel {
  return buildModelResultFromSources(entryUri, documents, options).model;
}

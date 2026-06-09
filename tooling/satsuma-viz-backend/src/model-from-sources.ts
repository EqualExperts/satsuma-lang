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

import { getParser } from "@satsuma/core";
import type { Tree } from "./parser-utils";
import {
  createWorkspaceIndex,
  indexFile,
  getImportReachableUris,
  createScopedIndex,
} from "./workspace-index";
import { buildVizModel, mergeVizModels } from "./viz-model";
import type { VizModel } from "./viz-model";

/** One in-memory Satsuma document keyed by the URI under which it is indexed. */
export interface SourceDocument {
  /**
   * The document's URI. Must be a `file:///` URI in the same form the import
   * resolver produces, so cross-file `import`s between documents resolve and
   * `WorkspaceIndex.indexedFiles.has(...)` matches (feature 33 §1a). The Node
   * server derives this from the filesystem path; the browser derives it from
   * the library entry's virtual path.
   */
  uri: string;
  /** Raw Satsuma source text — the single source of truth for parse + index. */
  source: string;
}

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
 * Build a VizModel for `entryUri` from a set of in-memory `documents`.
 *
 * Parses and indexes every document, then assembles the entry's model. In
 * lineage mode the import-reachable documents are merged; otherwise the entry
 * is rendered single-file against an import-scoped index. Documents that fail
 * to parse are skipped; if the entry itself is absent or unparseable, an empty
 * model is returned rather than throwing, so a mid-edit buffer never crashes the
 * caller (the live editor keeps its last good visualization on top of this).
 *
 * Invariant: the model produced here is identical to the one the Node server's
 * `/api/model` handler produces for the same documents, because both paths run
 * this function.
 */
export function buildModelFromSources(
  entryUri: string,
  documents: SourceDocument[],
  options: BuildModelOptions = {},
): VizModel {
  const parser = getParser();
  const index = createWorkspaceIndex();

  // Parse once per document and keep the trees so the lineage merge below does
  // not re-parse the same sources it already indexed.
  const treesByUri = new Map<string, Tree>();
  for (const doc of documents) {
    const tree = parser.parse(doc.source);
    // web-tree-sitter returns Tree | null; null only arises when parsing is
    // halted via a callback, which we never do here.
    if (!tree) continue;
    treesByUri.set(doc.uri, tree);
    indexFile(index, doc.uri, tree);
  }

  const entryTree = treesByUri.get(entryUri);
  if (!entryTree) return emptyModel(entryUri);

  // Scope resolution to the entry's import graph, matching the server and LSP.
  const reachable = getImportReachableUris(entryUri, index);
  const scopedIndex = createScopedIndex(index, reachable);

  if (!options.lineage) {
    return buildVizModel(entryUri, entryTree, scopedIndex);
  }

  // Lineage: assemble a model per reachable document, then merge into one
  // cross-file graph rooted at the entry.
  const models: VizModel[] = [];
  for (const reachableUri of reachable) {
    const tree = treesByUri.get(reachableUri);
    if (!tree) continue;
    models.push(buildVizModel(reachableUri, tree, scopedIndex));
  }
  return mergeVizModels(entryUri, models);
}

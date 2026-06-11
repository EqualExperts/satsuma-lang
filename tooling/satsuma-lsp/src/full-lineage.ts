/**
 * full-lineage.ts — merged VizModel across a file's transitive import graph.
 *
 * Owns the satsuma/vizFullLineage traversal: walk every import-reachable file
 * from the requested entry, build a per-file VizModel, and merge them so stub
 * schemas are superseded by their full upstream definitions.
 *
 * Tree acquisition is delegated to the caller. The server supplies open-editor
 * trees with an on-disk parse fallback, so files that are merely imported —
 * not open in any editor — still contribute their definitions. The previous
 * inline handler read only the open-editor tree cache, so "full transitive
 * lineage" silently contained just the files the user happened to have open
 * (sl-mg63). This module never touches the filesystem itself.
 */

import type { Tree } from "./parser-utils";
import {
  WorkspaceIndex,
  getImportReachableUris,
  createScopedIndex,
} from "./workspace-index";
import { buildVizModel, mergeVizModels } from "@satsuma/viz-backend";
import type { VizModel } from "@satsuma/viz-backend";

/**
 * Build the merged lineage model for `primaryUri`.
 *
 * @param primaryUri The entry file the client requested lineage for.
 * @param wsIndex    Full workspace index (used for import-graph traversal and
 *                   per-file scoped indexing).
 * @param loadTree   Returns a parse tree for a URI, from any source the caller
 *                   has (open editors, disk, …), or null when unavailable.
 * @returns The merged model anchored to `primaryUri`, or null when the primary
 *          file itself cannot be loaded. Unloadable imported files are skipped.
 */
export function computeFullLineage(
  primaryUri: string,
  wsIndex: WorkspaceIndex,
  loadTree: (uri: string) => Tree | null | undefined,
): VizModel | null {
  // No tree for the requested file means there is nothing to anchor the
  // model to — preserve the original handler's null contract.
  if (!loadTree(primaryUri)) return null;

  const models: VizModel[] = [];
  for (const fileUri of getImportReachableUris(primaryUri, wsIndex)) {
    const fileTree = loadTree(fileUri);
    if (!fileTree) continue;
    const scoped = createScopedIndex(wsIndex, getImportReachableUris(fileUri, wsIndex));
    models.push(buildVizModel(fileUri, fileTree, scoped));
  }

  return mergeVizModels(primaryUri, models);
}

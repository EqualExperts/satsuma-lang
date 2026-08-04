/**
 * in-memory-workspace.ts — parse and index host-supplied Satsuma documents.
 *
 * This module owns the shared first half of every browser-side workspace
 * operation: parse each source once, retain its tree, and build the portable
 * WorkspaceIndex. Model assembly and field-chain traversal consume that result;
 * document loading and persistence remain host concerns.
 */

import { getParser } from "@satsuma/core";
import type { Tree } from "./parser-utils";
import { createWorkspaceIndex, indexFile } from "./workspace-index";
import type { WorkspaceIndex } from "./workspace-index";

/** One in-memory Satsuma document keyed by the URI under which it is indexed. */
export interface SourceDocument {
  /** URI used for workspace identity and relative import resolution. */
  uri: string;
  /** Raw Satsuma source text parsed by the shared WASM parser. */
  source: string;
}

/** Parsed trees and the index assembled from the same document snapshot. */
export interface InMemoryWorkspace {
  /** Workspace definitions, references, and imports across all documents. */
  index: WorkspaceIndex;
  /** Parsed tree for each document whose parse produced a tree. */
  treesByUri: Map<string, Tree>;
}

/**
 * Parse and index a document snapshot without reading the filesystem.
 *
 * The caller must initialise core's parser first. A document whose parser call
 * returns null is omitted; web-tree-sitter only does so when parsing is halted
 * through a callback, which Satsuma hosts do not install.
 */
export function buildInMemoryWorkspace(documents: SourceDocument[]): InMemoryWorkspace {
  const parser = getParser();
  const index = createWorkspaceIndex();
  const treesByUri = new Map<string, Tree>();

  for (const document of documents) {
    const tree = parser.parse(document.source);
    if (!tree) continue;
    treesByUri.set(document.uri, tree);
    indexFile(index, document.uri, tree);
  }

  return { index, treesByUri };
}

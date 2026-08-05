/**
 * field-chain.ts — build a field traversal from a workspace index.
 *
 * Owns import scoping, workspace-to-core projection, and the current
 * endpoint-ambiguity policy around core's single field-edge builder and
 * traversal; it does not implement lineage semantics or depend on the CLI.
 * The result is the exact JSON shape the CLI publishes.
 *
 * {@link buildFieldChainFromWorkspace} is the host-neutral core of this module:
 * given a `WorkspaceIndex` and a tree loader, it does not care whether the
 * trees came from parsing host-supplied text (the browser path, via
 * {@link buildFieldChainFromSources}) or from an LSP's own open-editor/on-disk
 * cache — the same split `full-lineage.ts` uses for the merged VizModel. Only
 * the "how do I get a WorkspaceIndex and its trees" part is host-specific.
 */

import {
  buildFieldEdges,
  createAuthoredFieldRef,
  createCanonicalFieldEndpoint,
  extractArrowRecords,
  extractMappings,
  extractNLRefData,
  resolveAllNLRefs,
  resolveFieldEndpoint,
  traceFieldLineage,
} from "@satsuma/core";
import type {
  CanonicalFieldEndpoint,
  FieldArrowLike,
  FieldLineageDirection,
  MappingSourcesTargets,
  NLRefDataItem,
} from "@satsuma/core";
import type { FieldChainModel } from "@satsuma/viz-model";
import type { Tree } from "./parser-utils";
import { buildInMemoryWorkspace } from "./in-memory-workspace";
import type { SourceDocument } from "./in-memory-workspace";
import { createScopedIndex, getImportReachableUris, resolveDefinition } from "./workspace-index";
import type { WorkspaceIndex } from "./workspace-index";
import { createWorkspaceDefinitionLookup } from "./workspace-definition-lookup";

/** Returns a parse tree for a URI, from whichever source the host has, or null/undefined when unavailable. */
export type TreeLoader = (uri: string) => Tree | null | undefined;

/** Default mapping-hop limit, matching `satsuma field-lineage`. */
export const DEFAULT_FIELD_CHAIN_DEPTH = 10;

/** Controls the directions and mapping-hop limit of one chain build. */
export interface BuildFieldChainOptions {
  /** Maximum mapping hops from the focus field; defaults to 10. */
  depth?: number;
  /** Side or sides of the focus field to include; defaults to both. */
  direction?: FieldLineageDirection;
}

/** Convert a host field reference to the canonical serialized form. */
function canonicalFocusField(field: string): CanonicalFieldEndpoint {
  return createCanonicalFieldEndpoint(field.includes("::") ? field : `::${field}`);
}

/** Stable mapping index key shared by extracted arrows, mappings, and NL refs. */
function mappingKey(namespace: string | null, name: string | null): string {
  return namespace ? `${namespace}::${name ?? ""}` : (name ?? "");
}

/** Resolve an authored schema ref to the WorkspaceIndex key it denotes. */
function resolveSchemaKey(
  authored: string,
  namespace: string | null,
  workspace: WorkspaceIndex,
): string {
  if (authored.startsWith("::")) return authored.slice(2);
  if (authored.includes("::")) return authored;

  const schema = resolveDefinition(workspace, authored, namespace).find(
    (definition) => definition.kind === "schema",
  );
  if (!schema) return authored;
  return schema.namespace ? `${schema.namespace}::${authored}` : authored;
}

/**
 * Endpoint policy shared with today's CLI output.
 *
 * A bare token that is also a declared schema is still the unresolved
 * `r0-7w76` ambiguity. Until that decision lands, both published paths read it
 * as a field of the primary schema; keeping the rule labelled here prevents a
 * browser adapter from silently choosing the other interpretation.
 */
function resolveEndpoint(authored: string, schemas: readonly string[]): CanonicalFieldEndpoint {
  const resolution = resolveFieldEndpoint(createAuthoredFieldRef(authored), schemas);
  switch (resolution.kind) {
    case "field":
      return resolution.endpoint;
    case "schema-root-or-field":
      return resolution.asField;
    case "unqualifiable":
      return canonicalFocusField(resolution.authored);
  }
}

/** Semantic edge inputs extracted from the import-reachable document graph. */
interface ChainInputs {
  /** Authored arrows in stable document order, each labelled with its URI. */
  arrows: FieldArrowLike[];
  /** Mapping source and target schemas keyed by qualified mapping name. */
  mappings: Map<string, MappingSourcesTargets>;
  /** NL text records awaiting workspace-aware resolution. */
  nlRefData: NLRefDataItem[];
}

/** Extract and qualify the core inputs for one import-reachable workspace. */
function collectChainInputs(
  reachableUris: Set<string>,
  loadTree: TreeLoader,
  workspace: WorkspaceIndex,
): ChainInputs {
  const arrows: FieldArrowLike[] = [];
  const mappings = new Map<string, MappingSourcesTargets>();
  const nlRefData: NLRefDataItem[] = [];

  for (const uri of reachableUris) {
    const tree = loadTree(uri);
    if (!tree) continue;

    for (const mapping of extractMappings(tree.rootNode)) {
      const key = mappingKey(mapping.namespace, mapping.name);
      mappings.set(key, {
        sources: mapping.sources.map((source) =>
          resolveSchemaKey(source, mapping.namespace, workspace),
        ),
        targets: mapping.targets.map((target) =>
          resolveSchemaKey(target, mapping.namespace, workspace),
        ),
        namespace: mapping.namespace,
      });
    }

    arrows.push(...extractArrowRecords(tree.rootNode).map((arrow) => ({ ...arrow, file: uri })));
    nlRefData.push(
      ...extractNLRefData(tree.rootNode).map((reference) => ({ ...reference, file: uri })),
    );
  }

  return { arrows, mappings, nlRefData };
}

/**
 * Build a CLI-compatible field chain from an already-built workspace index.
 *
 * Host-neutral: the LSP calls this with its own `WorkspaceIndex` and a tree
 * loader over open-editor/on-disk trees, and {@link buildFieldChainFromSources}
 * calls it with a workspace freshly built from browser-supplied text. Neither
 * host's tree-acquisition strategy leaks into the traversal below.
 *
 * Only files reachable from `entryUri` through imports contribute edges,
 * matching `satsuma coverage`'s and `vizFullLineage`'s scoping rule: "the
 * workspace" means the entry file's transitive import closure, not every file
 * a host happens to have loaded.
 */
export function buildFieldChainFromWorkspace(
  entryUri: string,
  workspace: WorkspaceIndex,
  loadTree: TreeLoader,
  focusField: string,
  options: BuildFieldChainOptions = {},
): FieldChainModel {
  const field = canonicalFocusField(focusField);
  const maxDepth = options.depth ?? DEFAULT_FIELD_CHAIN_DEPTH;
  if (!loadTree(entryUri)) return { field, maxDepth, upstream: [], downstream: [] };

  const reachableUris = getImportReachableUris(entryUri, workspace);
  const scoped = createScopedIndex(workspace, reachableUris);
  const inputs = collectChainInputs(reachableUris, loadTree, scoped);
  const lookup = createWorkspaceDefinitionLookup(scoped, (key) => inputs.mappings.get(key) ?? null);
  const nlRefs = resolveAllNLRefs(inputs.nlRefData, lookup);
  const edges = buildFieldEdges({
    arrows: inputs.arrows,
    mappingSides: (key) => inputs.mappings.get(key) ?? null,
    nlRefs,
    resolveEndpoint,
  }).edges;

  return traceFieldLineage(edges, field, {
    depth: maxDepth,
    direction: options.direction ?? "both",
  });
}

/**
 * Build a CLI-compatible field chain from host-supplied source documents.
 *
 * The browser-path wrapper around {@link buildFieldChainFromWorkspace}: parses
 * `documents` into a fresh `WorkspaceIndex` and tree set (the shared first half
 * every browser-side workspace operation needs, per `in-memory-workspace.ts`),
 * then delegates. Reads no filesystem or process state and is safe in the
 * browser; callers must initialise core's WASM parser before invoking it.
 */
export function buildFieldChainFromSources(
  entryUri: string,
  documents: SourceDocument[],
  focusField: string,
  options: BuildFieldChainOptions = {},
): FieldChainModel {
  const { index, treesByUri } = buildInMemoryWorkspace(documents);
  return buildFieldChainFromWorkspace(
    entryUri,
    index,
    (uri) => treesByUri.get(uri),
    focusField,
    options,
  );
}

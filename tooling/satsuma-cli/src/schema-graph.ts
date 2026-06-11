/**
 * graph-builder.ts — Build a directed schema-level graph from a ExtractedWorkspace.
 *
 * Shared by `satsuma lineage` and `satsuma graph` commands.
 */

import { extractAtRefs, classifyRef, resolveRef } from "./nl-ref-extract.js";
import type { ExtractedWorkspace } from "./types.js";

export interface GraphNode {
  type: string;
  file?: string;
}

export interface FullGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, Set<string>>;
}

/**
 * Build a directed graph: edges go from source to target (downstream).
 */
export function buildFullGraph(index: ExtractedWorkspace): FullGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, Set<string>>();

  const addNode = (name: string, type: string, file?: string): void => {
    if (!nodes.has(name)) nodes.set(name, { type, file });
  };
  const addEdge = (src: string, tgt: string): void => {
    if (!edges.has(src)) edges.set(src, new Set());
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
    edges.get(src)!.add(tgt);
  };

  // Add all known nodes
  for (const [name, s] of index.schemas) addNode(name, "schema", s.file);
  for (const [name, m] of index.metrics) addNode(name, "metric", m.file);
  for (const [name, m] of index.mappings) addNode(name, "mapping", m.file);
  for (const [name, f] of index.fragments) addNode(name, "fragment", f.file);
  for (const [name, t] of index.transforms) addNode(name, "transform", t.file);

  // schema → mapping (schema is a source of a mapping)
  for (const [mappingName, mapping] of index.mappings) {
    for (const src of mapping.sources) {
      addNode(src, "schema");
      addEdge(src, mappingName);
    }
    for (const tgt of mapping.targets) {
      addNode(tgt, "schema");
      addEdge(mappingName, tgt);
    }
  }

  // target schema → metric (metric consumes schemas)
  for (const [metricName, metric] of index.referenceGraph.metricsReferences) {
    for (const src of metric) {
      addNode(src, "schema");
      addEdge(src, metricName);
    }
  }

  // NL @ref edges — promote NL schema references to directed edges so that
  // lineage traversal follows them. Deduplicate against declared sources/targets.
  if (index.nlRefData) {
    const seen = new Set<string>();
    for (const item of index.nlRefData) {
      const mappingKey = item.namespace
        ? `${item.namespace}::${item.mapping}`
        : item.mapping;
      const mapping = index.mappings.get(mappingKey);
      if (!mapping) continue;

      const allDeclared = new Set([...(mapping.sources ?? []), ...(mapping.targets ?? [])]);
      const refs = extractAtRefs(item.text);
      const mappingContext = {
        sources: mapping.sources ?? [],
        targets: mapping.targets ?? [],
        namespace: item.namespace,
      };

      for (const { raw } of refs) {
        // raw keeps backtick quoting so literal names with "." / "::"
        // classify and resolve correctly (sl-g6ga).
        const classification = classifyRef(raw);
        const resolution = resolveRef(raw, mappingContext, index);
        if (!resolution.resolved) continue;

        let canonicalSchema: string | null = null;
        if (classification === "namespace-qualified-schema" || classification === "bare") {
          if (resolution.resolvedTo?.kind === "schema") canonicalSchema = resolution.resolvedTo.name;
        } else if (classification === "dotted-field" || classification === "namespace-qualified-field") {
          if (resolution.resolvedTo?.kind === "field") {
            const fieldName = resolution.resolvedTo.name;
            const lastDot = fieldName.lastIndexOf(".");
            if (lastDot > 0) canonicalSchema = fieldName.slice(0, lastDot);
          }
        }
        if (!canonicalSchema) continue;

        const indexKey = canonicalSchema.startsWith("::") ? canonicalSchema.slice(2) : canonicalSchema;
        if (allDeclared.has(indexKey) || allDeclared.has(canonicalSchema)) continue;

        const edgeKey = `${indexKey}|${mappingKey}`;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);

        addNode(indexKey, "schema");
        addEdge(indexKey, mappingKey);
      }
    }
  }

  return { nodes, edges };
}

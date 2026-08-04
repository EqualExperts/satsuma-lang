/**
 * graph-builder.ts — workspace graph assembly for `satsuma graph`
 *
 * Owns the construction of the full workspace semantic graph: node collection,
 * schema-level edge derivation, and field-level edge resolution. The output
 * is a plain data structure (WorkspaceGraph) consumed by the graph command's
 * formatters and JSON serialiser.
 *
 * Does NOT own CLI registration, option parsing, or output formatting — those
 * live in graph.ts and graph-format.ts respectively.
 */

import { resolve } from "node:path";
import { buildFieldEdges, fieldEndpointSchema } from "@satsuma/core";
import type { FieldEdge as CoreFieldEdge } from "@satsuma/core";
import { createFieldEdgeSource } from "../field-edge-source.js";
import { expandEntityFields, expandNestedSpreads } from "../spread-expand.js";
import { extractAtRefs, classifyRef, resolveRef } from "../nl-ref-extract.js";
import type { ExtractedWorkspace, FieldDecl } from "../types.js";
import type { FullGraph } from "../schema-graph.js";

// ── Public types ─────────────────────────────────────────────────────────────

/** A schema-level directed edge (source → mapping, mapping → target, etc.). */
export interface SchemaEdge {
  from: string;
  to: string;
  /** Role describing how the edge connects: source, target, metric_source, or nl_ref. */
  role: string;
}

/**
 * Serialized graph edge. Core-built field edges satisfy this shape, while the
 * schema-only projection intentionally widens endpoints to schema id strings.
 */
export interface FieldEdge extends Omit<CoreFieldEdge, "from" | "to"> {
  /** Fully-qualified source field or schema id, or null for a computed source. */
  from: string | null;
  /** Fully-qualified target field or schema id, or null for a source-only edge. */
  to: string | null;
}

/** Options controlling graph assembly, derived from CLI flags. */
export interface GraphBuildOpts {
  /** Filter nodes and edges to this namespace only. */
  namespace?: string | null;
  /** Whether to include NL text in edges (false when --no-nl). */
  includeNl: boolean;
  /** Whether to omit field-level detail (--schema-only). */
  schemaOnly: boolean;
}

/** The complete workspace graph data structure emitted by --json. */
export interface WorkspaceGraph {
  /** Schema version for the graph output format. */
  version: number;
  /** ISO-8601 timestamp of when the graph was generated. */
  generated: string;
  /** Absolute path to the workspace root. */
  workspace: string;
  /** Aggregate counts of entities and errors. */
  stats: {
    schemas: number;
    mappings: number;
    metrics: number;
    fragments: number;
    transforms: number;
    arrows: number;
    errors: number;
  };
  /** All graph nodes (schemas, mappings, metrics, transforms). */
  nodes: Array<Record<string, unknown>>;
  /** Field-level edges (or schema-level aggregated edges when --schema-only). */
  edges: FieldEdge[];
  /** Schema-level topology edges. */
  schema_edges: SchemaEdge[];
  /** Parser warnings surfaced from the workspace index. */
  warnings: Array<{ text: string; file: string; line: number }>;
  /** NL references that could not be resolved to a known schema or field. */
  unresolved_nl: Array<{ scope: string; arrow: string; text: string; file: string; line: number }>;
}

// ── Graph construction ───────────────────────────────────────────────────────

/**
 * Build the full workspace graph output structure from a parsed workspace
 * index and its schema-level directed graph.
 *
 * Collects nodes (schemas, mappings, metrics, transforms), builds schema-level
 * and field-level edges, applies namespace filtering, and computes stats.
 */
export function buildWorkspaceGraph(
  index: ExtractedWorkspace,
  schemaGraph: FullGraph,
  root: string,
  opts: GraphBuildOpts,
): WorkspaceGraph {
  const nsFilter = opts.namespace ?? null;
  const includeNl = opts.includeNl;
  const schemaOnly = opts.schemaOnly;

  // ── Collect nodes ──────────────────────────────────────────────────────────
  const nodes: Array<Record<string, unknown>> = [];
  const includedNodeIds = new Set<string>();

  for (const [id, schema] of index.schemas) {
    if (nsFilter && schema.namespace !== nsFilter) continue;
    // Metric schemas appear in both index.schemas and index.metrics.
    // Render them only once, as metric nodes (handled in the loop below).
    if (index.metrics.has(id)) continue;
    includedNodeIds.add(id);
    const node: Record<string, unknown> = {
      id,
      kind: "schema",
      namespace: schema.namespace ?? null,
      file: schema.file,
      line: schema.row + 1,
      note: schema.note ?? null,
    };
    if (!schemaOnly) {
      const fieldsCopy: FieldDecl[] = JSON.parse(JSON.stringify(schema.fields)) as FieldDecl[];
      expandNestedSpreads(fieldsCopy, schema.namespace ?? null, index);
      const spreadFields = expandEntityFields(schema, schema.namespace ?? null, index);
      node.fields = ([...fieldsCopy, ...spreadFields] as FieldDecl[]).map((f) => ({
        name: f.name,
        type: f.isList && f.type ? `list_of ${f.type}` : (f.type ?? null),
      }));
    }
    nodes.push(node);
  }

  for (const [id, mapping] of index.mappings) {
    if (nsFilter && mapping.namespace !== nsFilter) continue;
    includedNodeIds.add(id);
    nodes.push({
      id,
      kind: "mapping",
      namespace: mapping.namespace ?? null,
      file: mapping.file,
      line: mapping.row + 1,
      sources: mapping.sources,
      targets: mapping.targets,
    });
  }

  for (const [id, metric] of index.metrics) {
    if (nsFilter && metric.namespace !== nsFilter) continue;
    includedNodeIds.add(id);
    const metricNode: Record<string, unknown> = {
      id,
      kind: "metric",
      namespace: metric.namespace ?? null,
      file: metric.file,
      line: metric.row + 1,
      sources: metric.sources,
      grain: metric.grain ?? null,
      slices: metric.slices ?? [],
    };
    if (!schemaOnly) {
      metricNode.fields = metric.fields.map((f) => ({
        name: f.name,
        type: f.isList && f.type ? `list_of ${f.type}` : (f.type ?? null),
      }));
    }
    nodes.push(metricNode);
  }

  // Fragments are macro definitions — they do not appear as graph nodes.
  // Their fields are expanded into the consuming schema's field list via
  // expandEntityFields above. stats.fragments still reports the count.

  for (const [id, transform] of index.transforms) {
    if (nsFilter && transform.namespace !== nsFilter) continue;
    includedNodeIds.add(id);
    nodes.push({
      id,
      kind: "transform",
      namespace: transform.namespace ?? null,
      file: transform.file,
      line: transform.row + 1,
    });
  }

  // ── Build edges ────────────────────────────────────────────────────────────
  const schemaEdges = buildSchemaEdges(index, schemaGraph, includedNodeIds, nsFilter);

  // ── Backfill nodes referenced by schema_edges (sl-p895) ───────────────────
  // When namespace-filtering, schema_edges may reference nodes from outside the
  // filtered namespace (cross-namespace sources/targets and bridging mappings).
  // Any endpoint not already in nodes is looked up and added here, so that every
  // edge endpoint is backed by a node entry and callers can rely on structural
  // consistency without further checks.
  if (nsFilter) {
    for (const edge of schemaEdges) {
      for (const id of [edge.from, edge.to]) {
        if (includedNodeIds.has(id)) continue;
        const schema = index.schemas.get(id);
        if (schema && !index.metrics.has(id)) {
          includedNodeIds.add(id);
          nodes.push({
            id,
            kind: "schema",
            namespace: schema.namespace ?? null,
            file: schema.file,
            line: schema.row + 1,
            note: schema.note ?? null,
          });
          continue;
        }
        const mapping = index.mappings.get(id);
        if (mapping) {
          includedNodeIds.add(id);
          nodes.push({
            id,
            kind: "mapping",
            namespace: mapping.namespace ?? null,
            file: mapping.file,
            line: mapping.row + 1,
            sources: mapping.sources,
            targets: mapping.targets,
          });
          continue;
        }
        const metric = index.metrics.get(id);
        if (metric) {
          includedNodeIds.add(id);
          nodes.push({
            id,
            kind: "metric",
            namespace: metric.namespace ?? null,
            file: metric.file,
            line: metric.row + 1,
            sources: metric.sources,
            grain: metric.grain ?? null,
            slices: metric.slices ?? [],
          });
        }
      }
    }
  }

  // Always build field edges (needed for --schema-only aggregation too)
  const result = buildFieldEdges(
    createFieldEdgeSource(index, {
      includeMapping: (mappingKey) =>
        mappingIncludedInNamespace(index, mappingKey, includedNodeIds, nsFilter),
    }),
    { includeNl },
  );

  const unresolvedNl: Array<{
    scope: string;
    arrow: string;
    text: string;
    file: string;
    line: number;
  }> = [];

  const fieldEdges: FieldEdge[] = schemaOnly
    ? aggregateFieldEdgesToSchemaLevel(result.edges, index, nsFilter)
    : result.edges;
  unresolvedNl.push(...result.unresolvedNl);

  // Count arrows (raw field arrows, not aggregated)
  const arrowCount = result.edges.length;

  // ── Assemble output ────────────────────────────────────────────────────────
  return {
    version: 1,
    generated: new Date().toISOString(),
    workspace: resolve(root),
    stats: {
      // Exclude metric schemas from the schema count — they are counted under metrics.
      schemas: [...index.schemas.entries()].filter(
        ([id, s]) => !index.metrics.has(id) && (!nsFilter || s.namespace === nsFilter),
      ).length,
      mappings: [...index.mappings.values()].filter((m) => !nsFilter || m.namespace === nsFilter)
        .length,
      metrics: [...index.metrics.values()].filter((m) => !nsFilter || m.namespace === nsFilter)
        .length,
      fragments: [...index.fragments.values()].filter((f) => !nsFilter || f.namespace === nsFilter)
        .length,
      transforms: [...index.transforms.values()].filter(
        (t) => !nsFilter || t.namespace === nsFilter,
      ).length,
      arrows: arrowCount,
      errors: index.totalErrors,
    },
    nodes,
    edges: fieldEdges,
    schema_edges: schemaEdges,
    warnings: index.warnings.map((w) => ({ text: w.text, file: w.file, line: w.row + 1 })),
    unresolved_nl: includeNl ? unresolvedNl : [],
  };
}

// ── Schema-level edges ───────────────────────────────────────────────────────

/**
 * Build schema-level edges from the directed graph.
 * Each edge has: from, to, role (source/target/metric_source/nl_ref).
 */
function buildSchemaEdges(
  index: ExtractedWorkspace,
  _schemaGraph: FullGraph,
  includedNodeIds: Set<string>,
  nsFilter: string | null,
): SchemaEdge[] {
  const edges: SchemaEdge[] = [];

  // ── Mapping source/target edges ────────────────────────────────────────────
  for (const [mappingName, mapping] of index.mappings) {
    // When namespace-filtering, include edges if either the mapping is in
    // the namespace OR any of its sources/targets are in the namespace
    if (nsFilter && mapping.namespace !== nsFilter) {
      const touchesNs =
        mapping.sources.some((s) => includedNodeIds.has(s)) ||
        mapping.targets.some((t) => includedNodeIds.has(t));
      if (!touchesNs) continue;
    }

    for (const src of mapping.sources) {
      if (!nsFilter || includedNodeIds.has(src) || includedNodeIds.has(mappingName)) {
        edges.push({ from: src, to: mappingName, role: "source" });
      }
    }
    for (const tgt of mapping.targets) {
      if (!nsFilter || includedNodeIds.has(tgt) || includedNodeIds.has(mappingName)) {
        edges.push({ from: mappingName, to: tgt, role: "target" });
      }
    }
  }

  // ── Metric source edges ────────────────────────────────────────────────────
  for (const [metricName, srcSchemas] of index.referenceGraph.metricsReferences) {
    const metric = index.metrics.get(metricName);
    if (nsFilter && metric?.namespace !== nsFilter) continue;

    for (const src of srcSchemas) {
      if (!nsFilter || includedNodeIds.has(src) || includedNodeIds.has(metricName)) {
        edges.push({ from: src, to: metricName, role: "metric_source" });
      }
    }
  }

  // ── NL @ref edges ──────────────────────────────────────────────────────────
  // Promote resolved NL schema references to first-class edges.
  // Now that hidden-source-in-nl is an error (P5.1), these references are
  // guaranteed to be declared in the mapping's source list, so they represent
  // intentional data lineage, not phantom paths.
  if (index.nlRefData) {
    const seen = new Set<string>();
    for (const item of index.nlRefData) {
      const mappingKey = item.namespace ? `${item.namespace}::${item.mapping}` : item.mapping;
      const mapping = index.mappings.get(mappingKey);
      if (!mapping) continue;

      const backtickRefs = extractNlSchemaRefs(
        item.text,
        {
          sources: mapping.sources ?? [],
          targets: mapping.targets ?? [],
          namespace: item.namespace,
        },
        index,
      );

      for (const schemaRef of backtickRefs) {
        const key = `${schemaRef}|${mappingKey}|nl_ref`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!nsFilter || includedNodeIds.has(schemaRef) || includedNodeIds.has(mappingKey)) {
          edges.push({ from: schemaRef, to: mappingKey, role: "nl_ref" });
        }
      }
    }
  }

  return edges;
}

// ── NL schema ref extraction ─────────────────────────────────────────────────

/**
 * Extract index-key-format schema names referenced via @refs in NL text.
 * Filters out schemas already in the mapping's declared sources/targets (those
 * are already covered by the standard source/target edges).
 */
function extractNlSchemaRefs(
  text: string,
  mappingContext: { sources: string[]; targets: string[]; namespace: string | null },
  index: ExtractedWorkspace,
): string[] {
  const refs = extractAtRefs(text);
  const schemas: string[] = [];
  const allDeclared = new Set([...mappingContext.sources, ...mappingContext.targets]);

  for (const { raw } of refs) {
    // raw keeps backtick quoting so literal names with "." / "::" classify
    // and resolve correctly (sl-g6ga).
    const classification = classifyRef(raw);
    const resolution = resolveRef(raw, mappingContext, index);
    if (!resolution.resolved) continue;

    let canonicalSchema: string | null = null;
    if (classification === "namespace-qualified-schema" || classification === "bare") {
      if (resolution.resolvedTo?.kind === "schema") {
        canonicalSchema = resolution.resolvedTo.name;
      }
    } else if (
      classification === "dotted-field" ||
      classification === "namespace-qualified-field"
    ) {
      if (resolution.resolvedTo?.kind === "field") {
        const fieldName = resolution.resolvedTo.name;
        const lastDot = fieldName.lastIndexOf(".");
        if (lastDot > 0) {
          canonicalSchema = fieldName.slice(0, lastDot);
        }
      }
    }

    if (!canonicalSchema) continue;

    // Convert canonical form (::name) to index key form (name)
    const indexKey = canonicalSchema.startsWith("::") ? canonicalSchema.slice(2) : canonicalSchema;

    // Skip schemas already declared as source or target
    if (allDeclared.has(indexKey) || allDeclared.has(canonicalSchema)) continue;

    schemas.push(indexKey);
  }

  return schemas;
}

// ── Field-level edges ────────────────────────────────────────────────────────

/**
 * Decide whether a mapping belongs in graph's caller-owned namespace slice.
 * Core sees only the already-filtered iterables and therefore remains unaware of
 * workspace nodes, namespace selection, and the CLI's index representation.
 */
function mappingIncludedInNamespace(
  index: ExtractedWorkspace,
  mappingKey: string,
  includedNodeIds: Set<string>,
  nsFilter: string | null,
): boolean {
  if (!nsFilter) return true;
  const mapping = index.mappings.get(mappingKey);
  if (mapping?.namespace === nsFilter) return true;
  return (
    (mapping?.sources ?? []).some((schema) => includedNodeIds.has(schema)) ||
    (mapping?.targets ?? []).some((schema) => includedNodeIds.has(schema))
  );
}

// ── Schema-only aggregation ──────────────────────────────────────────────────

/**
 * Aggregate field-level edges into schema-level edges by projecting each
 * endpoint onto its owning schema and deduplicating. For mappings with no field
 * edges (e.g. derived-only), adds edges from the declared source/target lists.
 *
 * The owning schema comes from core's endpoint accessor, not from splitting the
 * serialized endpoint here: this walk and the field-level walk must agree about
 * who owns an endpoint, and two independent derivations of that is how they stop
 * agreeing (`sl-jyee`).
 */
function aggregateFieldEdgesToSchemaLevel(
  fieldEdges: readonly CoreFieldEdge[],
  index: ExtractedWorkspace,
  nsFilter: string | null,
): FieldEdge[] {
  const aggregated: FieldEdge[] = [];
  const seen = new Set<string>();

  for (const edge of fieldEdges) {
    const fromSchema = edge.from ? fieldEndpointSchema(edge.from) : null;
    const toSchema = edge.to ? fieldEndpointSchema(edge.to) : null;
    if (fromSchema && toSchema) {
      const key = `${fromSchema}->${toSchema}:${edge.mapping}`;
      if (!seen.has(key)) {
        seen.add(key);
        aggregated.push({
          from: fromSchema,
          to: toSchema,
          mapping: edge.mapping,
          classification: edge.classification,
          file: edge.file,
          line: edge.line,
        });
      }
    }
  }

  // For mappings with no field edges (e.g. derived-only), add schema-level
  // edges from the declared source/target lists.
  const mappingsWithEdges = new Set(aggregated.map((e) => e.mapping));
  for (const [id, mapping] of index.mappings) {
    if (nsFilter && mapping.namespace !== nsFilter) continue;
    if (id && mappingsWithEdges.has(id)) continue;
    for (const src of mapping.sources) {
      for (const tgt of mapping.targets) {
        const key = `${src}->${tgt}:${id}`;
        if (!seen.has(key)) {
          seen.add(key);
          aggregated.push({
            from: src,
            to: tgt,
            mapping: id,
            classification: "none",
            file: mapping.file,
            line: mapping.row + 1,
          });
        }
      }
    }
  }

  return aggregated;
}

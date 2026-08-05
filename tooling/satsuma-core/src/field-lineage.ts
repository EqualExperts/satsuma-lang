/**
 * field-lineage.ts — browser-portable field-edge assembly and traversal.
 *
 * Owns the semantic edge list shared by graph and field-lineage consumers, plus
 * breadth-first upstream/downstream traversal over that list. It deliberately
 * knows no workspace index: callers adapt their index through FieldEdgeSource,
 * deduplicate authored arrows, resolve NL refs, and apply namespace filters.
 */

import { createCanonicalFieldEndpoint } from "./reference-stages.js";
import type { CanonicalFieldEndpoint } from "./reference-stages.js";
import type { Classification } from "./types.js";

/** Text carried by one natural-language transform step. */
export interface FieldEdgeStepLike {
  /** Step text exactly as extracted from the arrow body. */
  readonly text: string;
}

/** The arrow properties required to assemble field-level lineage. */
export interface FieldArrowLike {
  /** Mapping name without its namespace, or null when extraction has none. */
  readonly mapping: string | null;
  /** Namespace owning the mapping, or null for global scope. */
  readonly namespace: string | null;
  /** Authored source field expressions; empty means a computed source. */
  readonly sources: readonly string[];
  /** Authored target field expression, or null for a source-only arrow. */
  readonly target: string | null;
  /** Transform classification attached to the authored arrow. */
  readonly classification: Classification;
  /** Natural-language transform steps in authored order. */
  readonly steps: readonly FieldEdgeStepLike[];
  /** Whether the arrow was emitted from a `derived` block. */
  readonly derived: boolean;
  /** Source file containing the arrow. */
  readonly file: string;
  /** Zero-based source row used by extraction records. */
  readonly line: number;
}

/** The declared schemas on both sides of one mapping. */
export interface FieldMappingSides {
  /** Source schema index keys in declaration order. */
  readonly sources: readonly string[];
  /** Target schema index keys in declaration order. */
  readonly targets: readonly string[];
}

/** The resolved NL-ref properties that can create implicit lineage. */
export interface ResolvedFieldNlRefLike {
  /** Whether resolution found a workspace definition. */
  readonly resolved: boolean;
  /** Resolved definition identity, or null when resolution failed. */
  readonly resolvedTo: { readonly kind: string; readonly name: string } | null;
  /** Already namespace-qualified mapping index key. */
  readonly mapping: string;
  /** Authored target field of the arrow carrying the prose. */
  readonly targetField: string | null;
  /** Source file containing the reference. */
  readonly file: string;
  /** Zero-based source row used by extraction records. */
  readonly line: number;
}

/** Resolve one authored arrow endpoint against the schemas declared on its side. */
export type FieldEndpointResolver = (
  authored: string,
  schemas: readonly string[],
) => CanonicalFieldEndpoint;

/**
 * Narrow adapter from any consumer-owned workspace index to field-edge inputs.
 *
 * `arrows` must already be deduplicated, `nlRefs` must already be resolved, and
 * both iterables may already be filtered to the caller's desired namespace.
 */
export interface FieldEdgeSource {
  /** One entry per authored arrow, with consumer-specific index aliases removed. */
  readonly arrows: Iterable<FieldArrowLike>;
  /** Look up the schemas declared by a mapping index key. */
  readonly mappingSides: (mappingKey: string) => FieldMappingSides | null;
  /** Resolved NL mentions that may contribute implicit field edges. */
  readonly nlRefs: Iterable<ResolvedFieldNlRefLike>;
  /** Consumer policy for the still-pending schema-root endpoint ambiguity. */
  readonly resolveEndpoint: FieldEndpointResolver;
}

/** One canonical field edge, including the metadata required by graph output. */
export interface FieldEdge {
  /** Canonical source endpoint, or null for a computed source. */
  from: CanonicalFieldEndpoint | null;
  /** Canonical target endpoint, or null for a source-only arrow. */
  to: CanonicalFieldEndpoint | null;
  /** Mapping index key; global mappings do not carry a leading `::`. */
  mapping: string;
  /** Whether the edge is direct, transformed NL, or inferred from NL. */
  classification: Classification;
  /** Source file containing the arrow or NL reference. */
  file: string;
  /** One-based source line for user-facing output. */
  line: number;
  /** Individual transform texts for an authored NL arrow. */
  transforms?: string[];
  /** Joined NL text when a consumer elects to include it. */
  nl_text?: string;
  /** True when the authored arrow came from a `derived` block. */
  derived?: boolean;
}

/** One authored NL transform retained for the graph's unresolved-NL section. */
export interface UnresolvedFieldNl {
  /** Human-readable mapping scope. */
  scope: string;
  /** Human-readable target arrow. */
  arrow: string;
  /** Full transform text. */
  text: string;
  /** Source file containing the transform. */
  file: string;
  /** One-based source line. */
  line: number;
}

/** Complete result of building field edges from a consumer adapter. */
export interface FieldEdgeBuildResult {
  /** Declared and NL-derived field edges in stable input order. */
  edges: FieldEdge[];
  /** Authored NL transforms retained for graph diagnostics. */
  unresolvedNl: UnresolvedFieldNl[];
}

/** Options affecting metadata rather than which edges are assembled. */
export interface FieldEdgeBuildOptions {
  /** Include joined transform text in each NL edge. Defaults to false. */
  includeNl?: boolean;
}

/** Minimal plain edge accepted by the traversal independently of graph metadata. */
export interface FieldLineageEdge {
  /** Canonical source endpoint, or null for a computed source. */
  readonly from: CanonicalFieldEndpoint | null;
  /** Canonical target endpoint, or null for a source-only arrow. */
  readonly to: CanonicalFieldEndpoint | null;
  /** Mapping index key through which the fields connect. */
  readonly mapping: string;
  /** Classification exposed on the resulting traversal hop. */
  readonly classification: Classification;
}

/** One reached field in a traversal direction. */
export interface FieldLineageHop {
  /** Canonical field endpoint reached by this hop. */
  field: CanonicalFieldEndpoint;
  /** Canonical mapping reference through which the field was reached. */
  via_mapping: string;
  /** Classification of the edge used for the hop. */
  classification: Classification;
  /**
   * Mapping-hop distance from the focus field (1 for its direct neighbours).
   * A hop with `depth === options.depth` sits exactly at the traversal's
   * depth cap: because BFS is depth-exact (see `traceDirection`), any further
   * neighbours it may have were never visited. Consumers use this to render
   * an honest "depth limit reached" affordance rather than presenting such a
   * hop as a confirmed dead end (no-silent-truncation rule).
   */
  depth: number;
}

/** Published field-lineage payload shared by CLI and browser hosts. */
export interface FieldLineageResult {
  /** Canonical focus field. */
  field: CanonicalFieldEndpoint;
  /** Breadth-first ancestors of the focus field. */
  upstream: FieldLineageHop[];
  /** Breadth-first descendants of the focus field. */
  downstream: FieldLineageHop[];
  /**
   * The traversal's requested depth cap (the `depth` this result was built
   * with). Consumers compare a hop's own `depth` against this value to tell a
   * boundary hop (may have further, untraced neighbours) from a genuine dead
   * end reached before the cap — the per-hop `depth` field alone cannot make
   * that distinction.
   */
  maxDepth: number;
}

/** Which side or sides of a field should be traversed. */
export type FieldLineageDirection = "upstream" | "downstream" | "both";

/** Controls one field-lineage traversal. */
export interface FieldLineageOptions {
  /** Maximum number of mapping hops from the focus field. */
  readonly depth: number;
  /** Direction to include in the returned payload. */
  readonly direction: FieldLineageDirection;
}

// ── Edge assembly ───────────────────────────────────────────────────────────

/** Convert an arrow's split mapping identity to the index-key convention. */
function arrowMappingKey(arrow: FieldArrowLike): string {
  return arrow.namespace ? `${arrow.namespace}::${arrow.mapping}` : (arrow.mapping ?? "");
}

/** Build the metadata shared by every source of one declared arrow. */
function declaredEdgeMetadata(
  arrow: FieldArrowLike,
  mapping: string,
  includeNl: boolean,
): Omit<FieldEdge, "from" | "to"> {
  const edge: Omit<FieldEdge, "from" | "to"> = {
    mapping,
    classification: arrow.classification,
    file: arrow.file,
    line: arrow.line + 1,
  };

  if (arrow.classification === "nl") {
    edge.transforms = arrow.steps.map((step) => step.text);
    if (includeNl) edge.nl_text = edge.transforms.join(" ");
  }
  if (arrow.derived) edge.derived = true;
  return edge;
}

/** Add declared arrows and their unresolved-NL records in authored order. */
function appendDeclaredEdges(
  result: FieldEdgeBuildResult,
  source: FieldEdgeSource,
  includeNl: boolean,
): void {
  for (const arrow of source.arrows) {
    const mappingKey = arrowMappingKey(arrow);
    const sides = source.mappingSides(mappingKey);
    const sourceSchemas = sides?.sources ?? [];
    const targetSchemas = sides?.targets ?? [];
    const targets = arrow.target ? source.resolveEndpoint(arrow.target, targetSchemas) : null;
    const sources =
      arrow.sources.length > 0
        ? arrow.sources.map((field) => source.resolveEndpoint(field, sourceSchemas))
        : [null];
    const metadata = declaredEdgeMetadata(arrow, mappingKey, includeNl);

    for (const from of sources) result.edges.push({ from, to: targets, ...metadata });

    if (arrow.classification === "nl" && arrow.steps.length > 0) {
      result.unresolvedNl.push({
        scope: `mapping ${mappingKey}`,
        arrow: `-> ${arrow.target ?? "?"}`,
        text: arrow.steps.map((step) => step.text).join(" "),
        file: arrow.file,
        line: arrow.line + 1,
      });
    }
  }
}

/** Whether a declared edge already carries the same lineage as an NL mention. */
function hasDeclaredEquivalent(
  edges: readonly FieldEdge[],
  from: CanonicalFieldEndpoint,
  to: CanonicalFieldEndpoint,
  mapping: string,
): boolean {
  return edges.some(
    (edge) =>
      edge.from === from &&
      edge.to === to &&
      edge.mapping === mapping &&
      edge.classification !== "nl-derived",
  );
}

/** Add deduplicated, non-self implicit edges derived from resolved NL refs. */
function appendNlDerivedEdges(result: FieldEdgeBuildResult, source: FieldEdgeSource): void {
  const seen = new Set<string>();

  for (const ref of source.nlRefs) {
    if (!ref.resolved || ref.resolvedTo?.kind !== "field" || !ref.targetField) continue;
    const sides = source.mappingSides(ref.mapping);
    if (!sides) continue;

    const from = createCanonicalFieldEndpoint(ref.resolvedTo.name);
    const to = source.resolveEndpoint(ref.targetField, sides.targets);
    if (from === to) continue;

    const identity = `${from}|${to}|${ref.mapping}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (hasDeclaredEquivalent(result.edges, from, to, ref.mapping)) continue;

    result.edges.push({
      from,
      to,
      mapping: ref.mapping,
      classification: "nl-derived",
      file: ref.file,
      line: ref.line + 1,
    });
  }
}

/**
 * Assemble declared and NL-derived field edges from a consumer-owned index.
 *
 * Callers retain ownership of arrow deduplication, NL resolution, namespace
 * filtering, and endpoint ambiguity policy. The returned order follows the two
 * supplied iterables and is stable for deterministic graph and lineage output.
 */
export function buildFieldEdges(
  source: FieldEdgeSource,
  options: FieldEdgeBuildOptions = {},
): FieldEdgeBuildResult {
  const result: FieldEdgeBuildResult = { edges: [], unresolvedNl: [] };
  appendDeclaredEdges(result, source, options.includeNl ?? false);
  appendNlDerivedEdges(result, source);
  return result;
}

// ── Traversal ───────────────────────────────────────────────────────────────

/** Canonical mapping spelling used by the field-lineage JSON contract. */
function canonicalMappingRef(mapping: string): string {
  return mapping.includes("::") ? mapping : `::${mapping}`;
}

/** Return the next endpoint when an edge continues the requested direction. */
function nextEndpoint(
  edge: FieldLineageEdge,
  field: CanonicalFieldEndpoint,
  direction: Exclude<FieldLineageDirection, "both">,
): CanonicalFieldEndpoint | null {
  if (direction === "upstream") return edge.to === field ? edge.from : null;
  return edge.from === field ? edge.to : null;
}

/** Traverse one direction breadth-first while preserving the existing CLI order. */
function traceDirection(
  edges: readonly FieldLineageEdge[],
  start: CanonicalFieldEndpoint,
  maxDepth: number,
  direction: Exclude<FieldLineageDirection, "both">,
): FieldLineageHop[] {
  // Marking a field visited on enqueue is depth-exact *because* the queue is
  // FIFO and every field edge is one hop: fields therefore leave the queue in
  // non-decreasing depth order, so a field's first visit is always along a
  // shortest path and its subtree is expanded with the full remaining budget.
  // No shallower revisit can exist, so nothing needs re-expanding here. The
  // CLI's schema-level walk needs an explicit shallowest-visit map instead,
  // because it recurses depth-first and weights mapping nodes at zero depth —
  // there a first visit really can be deeper than the shortest path.
  const visited = new Set<CanonicalFieldEndpoint>([start]);
  const queue: Array<{ field: CanonicalFieldEndpoint; depth: number }> = [
    { field: start, depth: 0 },
  ];
  const result: FieldLineageHop[] = [];

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || item.depth >= maxDepth) continue;

    for (const edge of edges) {
      const next = nextEndpoint(edge, item.field, direction);
      if (!next || visited.has(next)) continue;
      visited.add(next);
      result.push({
        field: next,
        via_mapping: canonicalMappingRef(edge.mapping),
        classification: edge.classification,
        depth: item.depth + 1,
      });
      queue.push({ field: next, depth: item.depth + 1 });
    }
  }
  return result;
}

/**
 * Trace a field's upstream and/or downstream lineage over a plain edge list.
 *
 * The function performs no workspace access and mutates neither its edges nor
 * options. Cycles terminate at the first visited field, matching the published
 * CLI behavior; `depth` counts mapping hops from `start`.
 *
 * Each direction is depth-exact: it contains exactly the fields whose shortest
 * path from `start` is at most `depth` hops, each listed once and reached via a
 * shortest-path edge. Callers may rely on that (Feature 41 R4 asserts it).
 */
export function traceFieldLineage(
  edges: Iterable<FieldLineageEdge>,
  start: CanonicalFieldEndpoint,
  options: FieldLineageOptions,
): FieldLineageResult {
  const stableEdges = [...edges];
  const upstream =
    options.direction === "downstream"
      ? []
      : traceDirection(stableEdges, start, options.depth, "upstream");
  const downstream =
    options.direction === "upstream"
      ? []
      : traceDirection(stableEdges, start, options.depth, "downstream");
  return { field: start, upstream, downstream, maxDepth: options.depth };
}

/**
 * lint-lineage-cycle.ts — the `lineage-cycle` lint rule (PRD 37 R2).
 *
 * Owns one question about the schema-level mapping graph: does data flow in a
 * loop? `a -> b` in one mapping and `b -> a` in another is occasionally
 * intentional (a bidirectional sync spec) but more often a reversed arrow, or
 * two mappings authored independently that disagree about direction. The symptom
 * is subtle, because every traversal in the toolchain is already cycle-guarded:
 * lineage output silently omits an expected upstream hop and nothing says why.
 * Guarding is not reporting.
 *
 * Owns: the graph's edge semantics, the self-mapping exemption, one finding per
 * strongly-connected component, and the canonical representative path. Does not
 * own rule registration, suppression, or schema resolution.
 *
 * Edges are the same ones `satsuma lineage` and `graph --compact` draw — each
 * mapping's source schemas to its target schemas — so a cycle this rule reports
 * is a cycle those commands traverse.
 */

import type { LintFinding } from "./lint-findings.js";
import { createAuthoredEntityRef } from "./reference-stages.js";
import type { AuthoredEntityRef } from "./reference-stages.js";

/** Rule id. Stable — CI jobs and `lint.suppress` entries key off it. */
export const LINEAGE_CYCLE_RULE_ID = "lineage-cycle";

// ── Structural inputs ───────────────────────────────────────────────────────

/** A mapping, reduced to the edges it contributes and where to find it. */
export interface LineageCycleMapping {
  /** Mapping label, or null for an anonymous `mapping { … }` block. */
  readonly name: string | null;
  /** Namespace the mapping is declared in, or null/absent at file scope. */
  readonly namespace?: string | null;
  /** Absolute path or URI of the declaring file. */
  readonly file: string;
  /** 0-indexed declaration row, as extraction records it. */
  readonly row: number;
  /** Schema references from the `source {}` block, as written. */
  readonly sources: readonly string[];
  /** Schema references from the `target {}` block, as written. */
  readonly targets: readonly string[];
}

/**
 * Resolve a schema reference written in a mapping to its stable workspace id, or
 * null when the workspace declares no such schema.
 *
 * The id is what the graph's nodes *are*, so it must be the same string for two
 * mappings that spell one schema differently (`orders` inside `namespace crm`,
 * `crm::orders` from outside). Getting that wrong splits one schema into two
 * nodes and hides the cycle running between them.
 *
 * Unresolvable references drop their edge rather than becoming a node of their
 * own: an invented node cannot participate in a real cycle, and `validate`
 * already reports a mapping pointing at a schema that does not exist.
 */
export type LineageSchemaIdResolver = (
  writtenRef: AuthoredEntityRef,
  mappingNamespace: string | null,
) => string | null;

/** Everything {@link detectLineageCycles} reads. */
export interface LineageCycleInput {
  /** Mappings by index key. Only the values are read; the key itself is not used. */
  readonly mappings: ReadonlyMap<string, LineageCycleMapping>;
  /** See {@link LineageSchemaIdResolver}. */
  readonly resolveSchemaId: LineageSchemaIdResolver;
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Report each cyclic tangle in the schema-level mapping graph, once.
 *
 * Severity is `warning`: a cross-schema cycle can be a deliberate bidirectional
 * spec, so this is policy, not correctness — `validate` semantics are untouched.
 * Not fixable: closing a cycle means reversing an arrow or splitting a schema,
 * and only the author knows which.
 *
 * **One finding per strongly-connected component, not per elementary cycle.**
 * Enumerating elementary cycles (Johnson) is output-exponential: a densely
 * cross-linked platform graph holds combinatorially many cycles that all
 * describe the same tangle of mappings, which is why the rule was originally
 * specified with a truncation cap. An SCC *is* that tangle — its count is
 * bounded by the number of schemas, so nothing is capped and nothing is
 * truncated — and untangling the component is what the reviewer has to do
 * anyway, rather than auditing each rotation through it. Settled in doc review
 * 2026-07-31.
 */
export function detectLineageCycles(input: LineageCycleInput): LintFinding[] {
  const graph = buildSchemaGraph(input);

  const findings: LintFinding[] = [];
  for (const component of stronglyConnectedComponents(graph)) {
    // Self-edges were dropped at graph-build time, so a single-node component
    // can never be cyclic and is never a finding.
    if (component.length < MIN_CYCLIC_COMPONENT_SIZE) continue;
    findings.push(describeCycle(component, graph));
  }

  return findings;
}

/**
 * A component smaller than this cannot hold a cycle once self-edges are gone:
 * two distinct schemas, each reaching the other, is the smallest real tangle.
 */
const MIN_CYCLIC_COMPONENT_SIZE = 2;

// ── The schema graph ────────────────────────────────────────────────────────

/** Where a mapping is, and what to call it in a message. */
interface MappingSite {
  /** Label for the message — anonymous blocks are named by position instead. */
  readonly label: string;
  /** Absolute path or URI of the declaring file. */
  readonly file: string;
  /** 1-indexed declaration line, ready to report. */
  readonly line: number;
}

/**
 * The schema-level graph: sorted adjacency plus, for every edge, the mappings
 * that declare it.
 *
 * Adjacency lists and each edge's mapping list are sorted, which is what makes
 * every walk below independent of the order the files were loaded in.
 *
 * Edge attribution is a map of maps rather than one map under a composite key.
 * A backtick-quoted schema name may contain spaces, dots and colons, so any
 * separator that joined two ids into one string could itself be part of an id
 * and let two distinct edges collide.
 */
interface SchemaGraph {
  /** Every node, sorted by id. */
  readonly nodes: readonly string[];
  /** Successors of each node, sorted by id. */
  readonly successors: ReadonlyMap<string, readonly string[]>;
  /** Mappings declaring each edge, as `from` → `to` → sites sorted by position. */
  readonly edgeMappings: ReadonlyMap<string, ReadonlyMap<string, readonly MappingSite[]>>;
}

/** The mappings declaring the edge `from -> to`; empty when there is no such edge. */
function edgeSites(graph: SchemaGraph, from: string, to: string): readonly MappingSite[] {
  return graph.edgeMappings.get(from)?.get(to) ?? [];
}

/**
 * Build the schema graph from the workspace's mappings.
 *
 * **Self-mapping edges are dropped here, before any cycle detection runs.** A
 * mapping whose source and target are the same schema is legitimate — it is how
 * an incremental load is expressed — and that is a recorded product decision,
 * not an implementation convenience: *"self-mappings (same source and target
 * schema) are OK — we can use that to represent things like increments, and
 * DON'T cause graph cycles"* (`docs/product-owner/ROADMAP.md`).
 *
 * Note the exemption is per-*edge*, not per-mapping: a mapping with
 * `source { a }` and `target { a, b }` still contributes `a -> b`.
 */
function buildSchemaGraph(input: LineageCycleInput): SchemaGraph {
  const successorSets = new Map<string, Set<string>>();
  const edgeMappings = new Map<string, Map<string, MappingSite[]>>();

  for (const mapping of input.mappings.values()) {
    const namespace = mapping.namespace ?? null;
    const resolve = (ref: string): string | null =>
      input.resolveSchemaId(createAuthoredEntityRef(ref), namespace);

    const sources = mapping.sources.map(resolve).filter(isResolved);
    const targets = mapping.targets.map(resolve).filter(isResolved);

    for (const from of sources) {
      for (const to of targets) {
        if (from === to) continue; // the self-mapping exemption
        recordEdge(successorSets, edgeMappings, from, to, mappingSite(mapping));
      }
    }
  }

  return {
    nodes: [...successorSets.keys()].sort(),
    successors: sortedAdjacency(successorSets),
    edgeMappings: sortedEdgeMappings(edgeMappings),
  };
}

/** Add one `from -> to` edge and credit `site` with declaring it. */
function recordEdge(
  successorSets: Map<string, Set<string>>,
  edgeMappings: Map<string, Map<string, MappingSite[]>>,
  from: string,
  to: string,
  site: MappingSite,
): void {
  // Both endpoints become nodes, so a node that only ever appears as a target
  // still exists in the graph.
  for (const node of [from, to]) {
    if (!successorSets.has(node)) successorSets.set(node, new Set());
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- created just above
  successorSets.get(from)!.add(to);

  const outgoing = edgeMappings.get(from) ?? new Map<string, MappingSite[]>();
  const sites = outgoing.get(to) ?? [];
  sites.push(site);
  outgoing.set(to, sites);
  edgeMappings.set(from, outgoing);
}

/** Freeze adjacency into sorted arrays, the form every walk below relies on. */
function sortedAdjacency(
  successorSets: ReadonlyMap<string, Set<string>>,
): ReadonlyMap<string, readonly string[]> {
  const successors = new Map<string, readonly string[]>();
  for (const [node, set] of successorSets) {
    successors.set(node, [...set].sort());
  }
  return successors;
}

/** Sort each edge's mapping list so message text never depends on load order. */
function sortedEdgeMappings(
  edgeMappings: ReadonlyMap<string, Map<string, MappingSite[]>>,
): ReadonlyMap<string, ReadonlyMap<string, readonly MappingSite[]>> {
  for (const outgoing of edgeMappings.values()) {
    for (const sites of outgoing.values()) {
      sites.sort(compareMappingSites);
    }
  }
  return edgeMappings;
}

/** Type guard narrowing away the nulls a failed schema resolution produces. */
function isResolved(id: string | null): id is string {
  return id !== null;
}

/** Name and locate a mapping for the message; anonymous blocks get their position. */
function mappingSite(mapping: LineageCycleMapping): MappingSite {
  const line = mapping.row + 1;
  const qualified =
    mapping.namespace && mapping.name ? `${mapping.namespace}::${mapping.name}` : mapping.name;
  return {
    label: qualified ?? `anonymous mapping at line ${line}`,
    file: mapping.file,
    line,
  };
}

/** Order mapping sites by position, then label, so output never depends on load order. */
function compareMappingSites(left: MappingSite, right: MappingSite): number {
  return (
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.label.localeCompare(right.label)
  );
}

// ── Tarjan's strongly-connected components ──────────────────────────────────

/**
 * The graph's strongly-connected components — every maximal set of nodes each
 * reachable from every other. Each returned component is sorted by id.
 *
 * Iterative rather than recursive: a platform entry point can pull in hundreds of
 * schemas, and recursive Tarjan's stack depth is bounded by the longest path
 * through them.
 *
 * Roots are visited in sorted order and each node's successors in sorted order,
 * so the components — and the order they are returned in — are the same whatever
 * order the mappings were indexed in.
 */
function stronglyConnectedComponents(graph: SchemaGraph): string[][] {
  const search = new TarjanSearch(graph);
  for (const root of graph.nodes) search.visit(root);
  return search.components;
}

/** One frame of the explicit DFS stack: a node, and how far through its successors. */
interface SearchFrame {
  readonly node: string;
  nextSuccessor: number;
}

/**
 * Tarjan's algorithm, with the traversal state held as fields so the iterative
 * DFS reads as three short steps (descend, note a back-edge, close a component)
 * rather than one long loop.
 *
 * `index` is each node's discovery order; `lowLink` is the smallest discovery
 * index reachable from its subtree. A node whose two are equal opened the
 * component sitting above it on `stack`, which is Tarjan's central invariant.
 */
class TarjanSearch {
  readonly components: string[][] = [];

  private readonly index = new Map<string, number>();
  private readonly lowLink = new Map<string, number>();
  private readonly onStack = new Set<string>();
  private readonly stack: string[] = [];
  private nextIndex = 0;

  constructor(private readonly graph: SchemaGraph) {}

  /** Explore everything reachable from `root` that has not been visited yet. */
  visit(root: string): void {
    if (this.index.has(root)) return;

    const frames: SearchFrame[] = [{ node: root, nextSuccessor: 0 }];
    this.discover(root);

    while (frames.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by the loop
      const frame = frames[frames.length - 1]!;
      const successors = this.graph.successors.get(frame.node) ?? [];

      if (frame.nextSuccessor < successors.length) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds checked above
        const successor = successors[frame.nextSuccessor]!;
        frame.nextSuccessor += 1;

        if (!this.index.has(successor)) {
          this.discover(successor);
          frames.push({ node: successor, nextSuccessor: 0 });
        } else if (this.onStack.has(successor)) {
          // A back-edge into the component currently under construction.
          this.lower(frame.node, this.index.get(successor));
        }
        continue;
      }

      frames.pop();
      // Carry this node's low-link up to its parent before closing it off.
      const parent = frames[frames.length - 1];
      if (parent) this.lower(parent.node, this.lowLink.get(frame.node));
      if (this.lowLink.get(frame.node) === this.index.get(frame.node)) {
        this.closeComponent(frame.node);
      }
    }
  }

  /** Assign a node its discovery index and push it onto the component stack. */
  private discover(node: string): void {
    this.index.set(node, this.nextIndex);
    this.lowLink.set(node, this.nextIndex);
    this.nextIndex += 1;
    this.stack.push(node);
    this.onStack.add(node);
  }

  /** Pull `node`'s low-link down to `candidate` when that reaches further back. */
  private lower(node: string, candidate: number | undefined): void {
    if (candidate === undefined) return;
    this.lowLink.set(node, Math.min(this.lowLink.get(node) ?? candidate, candidate));
  }

  /** Pop the component `root` opened, up to and including `root` itself. */
  private closeComponent(root: string): void {
    const component: string[] = [];
    for (;;) {
      const member = this.stack.pop();
      if (member === undefined) break;
      this.onStack.delete(member);
      component.push(member);
      if (member === root) break;
    }
    this.components.push(component.sort());
  }
}

// ── The representative cycle ────────────────────────────────────────────────

/**
 * Turn one cyclic component into a finding: a canonical path through it, the
 * mapping responsible for each hop, and the members that path does not visit.
 *
 * The finding is reported against the mapping declaring the path's first edge.
 * The reviewer's next question is always "which mapping do I look at?", so an
 * editor jump should land on one of the answers rather than on a schema.
 */
function describeCycle(component: readonly string[], graph: SchemaGraph): LintFinding {
  const path = representativeCycle(component, graph);
  const hops = describeHops(path, graph);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- a cycle has at least one hop
  const anchor = hops[0]!.site;

  // Name the members the representative path does not pass through, so a large
  // tangle is not misread as a two-schema problem.
  const unvisited = component.filter((node) => !path.includes(node));
  const alsoIncludes =
    unvisited.length > 0 ? ` Component also includes ${unvisited.join(", ")}.` : "";

  return {
    rule: LINEAGE_CYCLE_RULE_ID,
    severity: "warning",
    file: anchor.file,
    line: anchor.line,
    column: 1,
    message:
      `Lineage cycle: ${path.join(" -> ")}. ` +
      `Edges: ${hops.map((hop) => hop.description).join(", ")}.` +
      alsoIncludes,
  };
}

/**
 * A deterministic shortest cycle through the component, entered at its
 * lexicographically smallest member.
 *
 * Returns the node sequence with the entry node repeated at the end
 * (`a -> b -> a`), so the path reads as a loop.
 *
 * Canonicalisation matters because the finding is a *representative*: without a
 * fixed entry point and a fixed walk, the same tangle would be described
 * differently depending on which file happened to load first, and a CI diff of
 * lint output would show phantom changes. Entry is the smallest id; the walk is
 * a breadth-first search over sorted adjacency, which discovers nodes in a fully
 * determined order and so picks the same shortest path on every run.
 */
function representativeCycle(component: readonly string[], graph: SchemaGraph): string[] {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- callers pass a non-empty component
  const entry = component[0]!; // components arrive sorted, so this is the smallest id
  const { distance, predecessor } = breadthFirstSearch(entry, new Set(component), graph);

  // Close the loop through whichever member reaches the entry soonest. Ties go
  // to the smallest id, which iterating the sorted component already gives us.
  let closest: string | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const node of component) {
    const reachesEntry = (graph.successors.get(node) ?? []).includes(entry);
    const nodeDistance = distance.get(node);
    if (!reachesEntry || nodeDistance === undefined) continue;
    if (nodeDistance < closestDistance) {
      closest = node;
      closestDistance = nodeDistance;
    }
  }

  // A component of two or more nodes is strongly connected, so some member
  // reaches the entry by construction; the fallback only keeps the types honest.
  if (closest === null) return [entry, entry];

  const path: string[] = [];
  for (let node: string | undefined = closest; node !== undefined; node = predecessor.get(node)) {
    path.unshift(node);
    if (node === entry) break;
  }
  path.push(entry);
  return path;
}

/** Shortest-path distances and BFS-tree predecessors from `entry`, within `members`. */
function breadthFirstSearch(
  entry: string,
  members: ReadonlySet<string>,
  graph: SchemaGraph,
): { distance: Map<string, number>; predecessor: Map<string, string> } {
  const distance = new Map<string, number>([[entry, 0]]);
  const predecessor = new Map<string, string>();
  const queue: string[] = [entry];

  for (let head = 0; head < queue.length; head += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guarded by the loop
    const node = queue[head]!;
    for (const successor of graph.successors.get(node) ?? []) {
      if (!members.has(successor) || distance.has(successor)) continue;
      distance.set(successor, (distance.get(node) ?? 0) + 1);
      predecessor.set(successor, node);
      queue.push(successor);
    }
  }

  return { distance, predecessor };
}

/** One hop of the representative path, with the mapping that declares it. */
interface CycleHop {
  /** Where to report the finding when this is the path's first hop. */
  readonly site: MappingSite;
  /** Message fragment: the edge, and the mapping responsible for it. */
  readonly description: string;
}

/**
 * Attribute every hop of the path to the mapping that declares it.
 *
 * An edge can be declared by more than one mapping — two mappings can both read
 * `a` and write `b` — and all of them are named, because hiding the others would
 * send the reviewer to fix one arrow and leave the cycle standing.
 */
function describeHops(path: readonly string[], graph: SchemaGraph): CycleHop[] {
  const hops: CycleHop[] = [];

  for (let i = 0; i + 1 < path.length; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds fixed by the loop
    const from = path[i]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- bounds fixed by the loop
    const to = path[i + 1]!;
    const sites = edgeSites(graph, from, to);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- every path edge came from a mapping
    const site = sites[0]!;
    const labels = sites.map((s) => `'${s.label}'`).join(" and ");
    hops.push({ site, description: `${from} -> ${to} (mapping ${labels})` });
  }

  return hops;
}

/**
 * lineage.ts — `satsuma lineage` command
 *
 * Traces data lineage through the workspace reference graph.
 *
 * Usage:
 *   satsuma lineage --from <schema>   downstream: schema → mappings → target schemas → metrics
 *   satsuma lineage --to <schema>     upstream: BFS path from any source to target
 *
 * Flags:
 *   --from <name>   start node for downstream walk
 *   --to <name>     target node for upstream path search
 *   --depth <n>     limit recursion depth (default 10)
 *   --compact       print names only (no file/row info)
 *   --json          emit {nodes, edges} DAG
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { parsePositiveInt } from "../option-parsers.js";
import { resolveIndexKey, canonicalKey } from "../index-builder.js";
import { buildFullGraph } from "../schema-graph.js";
import type { FullGraph } from "../schema-graph.js";

/** A directed edge in the lineage DAG. Uses the same from/to convention as graph schema_edges. */
interface DagEdge {
  from: string;
  to: string;
}

interface DagNode {
  name: string;
  type?: string;
  file?: string;
}

interface Dag {
  nodes: DagNode[];
  edges: DagEdge[];
}

export function register(program: Command): void {
  program
    .command("lineage [path]")
    .description("Trace data lineage through a Satsuma file and its imports")
    .option("--from <name>", "start node for downstream walk")
    .option("--to <name>", "target node for upstream BFS")
    .option("--depth <n>", "maximum recursion depth", parsePositiveInt, 10)
    .option("--compact", "print names only")
    .option("--json", "emit {nodes, edges} DAG")
    .addHelpText("after", `
One of --from or --to is required (not both).
  --from  traces downstream: schema → mappings → target schemas → metrics
  --to    traces upstream: BFS path from any source back to the target

JSON shape (--json):
  {
    "nodes": [{"name": str, "type": "schema"|"mapping"|"metric"|"transform", "file": str}, ...],
    "edges": [{"from": str, "to": str}, ...]
  }
  Schema names: global schemas use bare names ("s1"), namespaced use qualified ("ns::s1").
  Edge direction: from → to follows data flow (upstream → downstream).

Examples:
  satsuma lineage --from hub_customer              # what does hub_customer feed?
  satsuma lineage --to mart_customer_360           # what feeds mart_customer_360?
  satsuma lineage --from pos::stores --depth 3     # namespace-qualified, limited depth
  satsuma lineage --from hub_customer --json       # DAG as JSON`)
    .action(runCommand(async (pathArg: string | undefined, opts: { from?: string; to?: string; depth: number; compact?: boolean; json?: boolean }) => {
      if (!opts.from && !opts.to) {
        throw new CommandError("Provide --from <name> or --to <name>.", EXIT_NOT_FOUND);
      }

      if (opts.from && opts.to) {
        throw new CommandError(
          "Cannot specify both --from and --to. Use one at a time.",
          EXIT_NOT_FOUND,
        );
      }

      const { index } = await loadWorkspace(pathArg);
      const graph = buildFullGraph(index);

      // Build a "node not found" CommandError that respects the JSON
      // contract: JSON callers receive `{"error": ...}` on stdout so the
      // payload still parses; text callers get the message on stderr.
      const nodeNotFound = (queried: string): CommandError => {
        const msg = `Node '${queried}' not found.`;
        if (opts.json) {
          return new CommandError(JSON.stringify({ error: msg }, null, 2), EXIT_NOT_FOUND, "stdout");
        }
        return new CommandError(msg, EXIT_NOT_FOUND);
      };

      if (opts.from) {
        const resolved = resolveIndexKey(opts.from, graph.nodes);
        if (!resolved) throw nodeNotFound(opts.from);
        const start = resolved.key;
        const dag = buildDownstream(graph, start, opts.depth);
        if (opts.json) {
          console.log(JSON.stringify(dag, null, 2));
        } else if (opts.compact) {
          printCompact(dag, start);
        } else {
          printTree(dag, start, 0);
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: guarded by opts.to existence check in enclosing branch
        const resolvedTo = resolveIndexKey(opts.to!, graph.nodes);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: same guard
        if (!resolvedTo) throw nodeNotFound(opts.to!);
        const target = resolvedTo.key;
        const dag = buildUpstream(graph, target, opts.depth);
        if (dag.nodes.length === 0) {
          console.log(`No upstream path found to '${target}'.`);
          return EXIT_NOT_FOUND;
        }
        if (opts.json) {
          console.log(JSON.stringify(dag, null, 2));
        } else if (opts.compact) {
          for (const n of dag.nodes) console.log(canonicalKey(n.name));
        } else {
          printUpstreamFlat(dag, target);
        }
      }
    }));
}

/**
 * Build a downstream DAG from a start node up to `maxDepth` schema hops.
 * depth increments only when reaching a schema or metric node, so --depth N
 * means N schema-to-schema hops (each hop: schema → mapping → schema).
 *
 * Mapping/transform nodes are "free" (do not increment depth) but are only
 * included when there is room for at least one more schema hop beyond them
 * (`depth < maxDepth`). This prevents dangling mapping nodes: a mapping at
 * the boundary would have no outgoing edge visible within the depth limit.
 *
 * Returns {nodes: [...], edges: [{from, to}]}.
 */
function buildDownstream(graph: FullGraph, start: string, maxDepth: number): Dag {
  const visitedNodes = new Set<string>();
  const dagEdges: DagEdge[] = [];

  function dfs(node: string, depth: number): void {
    if (depth > maxDepth || visitedNodes.has(node)) return;
    visitedNodes.add(node);
    const children = graph.edges.get(node) ?? new Set<string>();
    for (const child of children) {
      const childType = graph.nodes.get(child)?.type;
      const isSchemaLike = childType === "schema" || childType === "metric";
      const nextDepth = isSchemaLike ? depth + 1 : depth;
      // Schema/metric nodes: include if within the depth limit.
      // Mapping/transform nodes: include only if there is room for another schema
      // hop beyond them, so we never emit a mapping with no visible outgoing edge.
      const withinLimit = isSchemaLike ? nextDepth <= maxDepth : depth < maxDepth;
      if (withinLimit) {
        dagEdges.push({ from: node, to: child });
        dfs(child, nextDepth);
      }
    }
  }

  dfs(start, 0);

  return {
    nodes: [...visitedNodes].map((n) => ({ name: n, ...graph.nodes.get(n) })),
    edges: dagEdges,
  };
}

/**
 * Build the full upstream DAG from a target node up to `maxDepth` schema hops.
 * Walks reverse edges; depth increments only when reaching a schema or metric node.
 *
 * Same dangling-node guard as buildDownstream: mapping/transform parent nodes
 * are only included when `depth < maxDepth`, ensuring every mapping node in
 * the result has a visible outgoing edge within the depth limit.
 *
 * Returns {nodes: [...], edges: [{from, to}]}.
 */
function buildUpstream(graph: FullGraph, target: string, maxDepth: number): Dag {
  // Build reverse edges
  const reverseEdges = new Map<string, Set<string>>();
  for (const [src, targets] of graph.edges) {
    for (const tgt of targets) {
      if (!reverseEdges.has(tgt)) reverseEdges.set(tgt, new Set());
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
      reverseEdges.get(tgt)!.add(src);
    }
  }

  const visitedNodes = new Set<string>();
  const dagEdges: DagEdge[] = [];

  function dfs(node: string, depth: number): void {
    if (depth > maxDepth || visitedNodes.has(node)) return;
    visitedNodes.add(node);
    const parents = reverseEdges.get(node) ?? new Set<string>();
    for (const parent of parents) {
      const parentType = graph.nodes.get(parent)?.type;
      const isSchemaLike = parentType === "schema" || parentType === "metric";
      const nextDepth = isSchemaLike ? depth + 1 : depth;
      const withinLimit = isSchemaLike ? nextDepth <= maxDepth : depth < maxDepth;
      if (withinLimit) {
        dagEdges.push({ from: parent, to: node });
        dfs(parent, nextDepth);
      }
    }
  }

  dfs(target, 0);

  return {
    nodes: [...visitedNodes].map((n) => ({ name: n, ...graph.nodes.get(n) })),
    edges: dagEdges,
  };
}

// ── Formatters ────────────────────────────────────────────────────────────────

function printUpstreamFlat(dag: Dag, target: string): void {
  // Build adjacency (upstream direction: parent → child)
  const adj = new Map<string, string[]>();
  for (const { from, to } of dag.edges) {
    if (!adj.has(from)) adj.set(from, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
    adj.get(from)!.push(to);
  }

  // Find roots (nodes with no incoming edges in the dag)
  const hasIncoming = new Set(dag.edges.map((e) => e.to));
  const roots = dag.nodes.filter((n) => !hasIncoming.has(n.name)).map((n) => n.name);
  // If no roots found (e.g. target is isolated), just use target
  if (roots.length === 0) roots.push(target);

  // Print each root-to-target path
  const paths: string[][] = [];
  function findPaths(node: string, currentPath: string[]): void {
    currentPath.push(node);
    const children = adj.get(node) ?? [];
    if (children.length === 0 || node === target) {
      if (node === target) paths.push([...currentPath]);
    } else {
      for (const child of children) {
        findPaths(child, currentPath);
      }
    }
    currentPath.pop();
  }

  for (const root of roots) {
    findPaths(root, []);
  }

  if (paths.length === 0) {
    // Fallback: print all nodes
    console.log(dag.nodes.map((n) => canonicalKey(n.name)).join(" -> "));
    return;
  }

  for (const path of paths) {
    console.log(path.map((n) => canonicalKey(n)).join(" -> "));
  }
}

function printTree(dag: Dag, start: string, _unused: number): void {
  // Build adjacency from dag edges
  const adj = new Map<string, string[]>();
  for (const { from, to } of dag.edges) {
    if (!adj.has(from)) adj.set(from, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
    adj.get(from)!.push(to);
  }

  function render(node: string, depth: number, visited: Set<string>): void {
    const nodeInfo = dag.nodes.find((n) => n.name === node);
    const type = nodeInfo?.type ?? "?";
    const prefix = "  ".repeat(depth);
    const cycleNote = visited.has(node) && depth > 0 ? " (cycle)" : "";
    console.log(`${prefix}${canonicalKey(node)}  [${type}]${cycleNote}`);
    if (visited.has(node)) return;
    visited.add(node);
    for (const child of adj.get(node) ?? []) {
      render(child, depth + 1, new Set(visited));
    }
  }

  render(start, 0, new Set());
}

function printCompact(dag: Dag, start: string): void {
  const adj = new Map<string, string[]>();
  for (const { from, to } of dag.edges) {
    if (!adj.has(from)) adj.set(from, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
    adj.get(from)!.push(to);
  }

  const visited = new Set<string>();
  function walk(node: string): void {
    if (visited.has(node)) return;
    visited.add(node);
    console.log(node);
    for (const child of adj.get(node) ?? []) walk(child);
  }
  walk(start);
}

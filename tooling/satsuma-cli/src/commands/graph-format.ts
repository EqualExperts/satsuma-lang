/**
 * graph-format.ts — output formatters for `satsuma graph`
 *
 * Owns the human-readable output modes for the graph command: the default
 * summary view and the compact adjacency list. JSON output is handled
 * directly by the command via JSON.stringify — it does not need a formatter.
 *
 * Does NOT own graph construction (graph-builder.ts) or CLI registration
 * (graph.ts).
 */

import type { WorkspaceGraph } from "./graph-builder.js";

// ── Formatters ───────────────────────────────────────────────────────────────

/**
 * Print the default human-readable graph summary.
 *
 * Shows node counts by kind, edge counts with classification breakdown,
 * parse error count, and a compact schema topology adjacency list.
 */
export function printDefault(graph: WorkspaceGraph): void {
  console.log(`Satsuma Graph — ${graph.workspace}`);
  console.log();

  // ── Node counts ────────────────────────────────────────────────────────────
  const s = graph.stats;
  console.log("Nodes:");
  if (s.schemas > 0) console.log(`  schemas:    ${s.schemas}`);
  if (s.mappings > 0) console.log(`  mappings:   ${s.mappings}`);
  if (s.metrics > 0) console.log(`  metrics:    ${s.metrics}`);
  if (s.fragments > 0) console.log(`  fragments:  ${s.fragments}`);
  if (s.transforms > 0) console.log(`  transforms: ${s.transforms}`);
  console.log();

  // ── Edge counts with classification breakdown ──────────────────────────────
  console.log("Edges:");
  console.log(`  schema-level: ${graph.schema_edges.length}`);
  console.log(`  field-level:  ${graph.edges.length}`);

  const byClass: Record<string, number> = {};
  for (const e of graph.edges) {
    byClass[e.classification] = (byClass[e.classification] ?? 0) + 1;
  }
  for (const [cls, count] of Object.entries(byClass)) {
    console.log(`    ${cls}: ${count}`);
  }
  console.log();

  // ── Parse errors ───────────────────────────────────────────────────────────
  if (s.errors > 0) {
    console.log(`Parse errors: ${s.errors}`);
    console.log();
  }

  // ── Schema topology adjacency list ─────────────────────────────────────────
  if (graph.schema_edges.length > 0) {
    console.log("Schema topology:");
    const adj = new Map<string, string[]>();
    for (const e of graph.schema_edges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
      adj.get(e.from)!.push(`${e.to} [${e.role}]`);
    }
    for (const [src, targets] of adj) {
      console.log(`  ${src} -> ${targets.join(", ")}`);
    }
  }
}

/**
 * Print the compact schema-level adjacency list (--compact mode).
 *
 * One line per schema edge: `from -> to  [role]`. Designed for minimal
 * token consumption by AI agents.
 */
export function printCompact(graph: WorkspaceGraph): void {
  for (const e of graph.schema_edges) {
    console.log(`${e.from} -> ${e.to}  [${e.role}]`);
  }
}

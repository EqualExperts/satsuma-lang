/**
 * summary.ts — `satsuma summary` command
 *
 * Prints a high-level overview of the Satsuma workspace:
 *   - schemas (name, note, field count)
 *   - metrics (name, display name, field count)
 *   - mappings (name, sources → targets, arrow count)
 *   - fragments and transforms (name only)
 *   - warning and question counts
 *
 * Flags:
 *   --compact   names only (one per line, grouped by type)
 *   --json      full structured JSON output
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand } from "../command-runner.js";
import { canonicalKey } from "../index-builder.js";
import { expandEntityFields } from "../spread-expand.js";
import { countNlDerivedEdgesByMapping } from "../nl-ref-extract.js";
import { canonicalEntityName } from "@satsuma/core";
import type { FieldDecl, ExtractedWorkspace, SchemaRecord } from "../types.js";

function totalFieldCount(schema: { fields: FieldDecl[]; namespace?: string | null }, index: ExtractedWorkspace): number {
  const expanded = expandEntityFields(schema as Parameters<typeof expandEntityFields>[0], schema.namespace ?? null, index);
  return schema.fields.length + expanded.length;
}


export function register(program: Command): void {
  program
    .command("summary [path]")
    .description("Summarise a Satsuma file and its imports")
    .option("--compact", "show names only")
    .option("--json", "output JSON")
    .addHelpText("after", `
JSON shape (--json):
  {
    "schemas":      [{"name": str, "fieldCount": int, "note": str|null, "file": str, "line": int}, ...],
    "metrics":      [{"name": str, "fieldCount": int, "displayName": str|null, "grain": str|null, "sources": [str], "file": str, "line": int}, ...],
    "mappings":     [{"name": str, "arrowCount": int, "nlDerivedArrowCount"?: int, "sources": [str], "targets": [str], "file": str, "line": int}, ...],
    "fragments":    [{"name": str, "fieldCount": int, "file": str, "line": int}, ...],
    "transforms":   [{"name": str, "file": str, "line": int}, ...],
    "fileCount":    int,
    "warningCount": int,
    "questionCount": int,
    "totalErrors":  int
  }
  --compact omits file, line, note, displayName, grain, sources, targets.

Examples:
  satsuma summary pipeline.stm           # human overview
  satsuma summary pipeline.stm --json    # structured index
  satsuma summary pipeline.stm --compact # names only`)
    .action(runCommand(async (pathArg: string | undefined, opts: { compact?: boolean; json?: boolean }) => {
      const { files: parsed, index } = await loadWorkspace(pathArg);

      if (opts.json) {
        printJson(index, parsed.length, opts.compact);
      } else if (opts.compact) {
        printCompact(index);
      } else {
        printDefault(index, parsed.length);
      }
    }));
}

// ── Formatters ────────────────────────────────────────────────────────────────

/**
 * Schema entries excluding metric blocks.
 *
 * Metric schemas live in both index.schemas and index.metrics; every formatter
 * must list them only under metrics, or the schema section double-reports them
 * and its count disagrees with graph stats (sl-s2mh).
 */
function nonMetricSchemas(index: ExtractedWorkspace): Map<string, SchemaRecord> {
  return new Map([...index.schemas].filter(([id]) => !index.metrics.has(id)));
}

function printJson(index: ExtractedWorkspace, fileCount: number, compact?: boolean): void {
  const displayName = canonicalEntityName;
  const nlDerivedCounts = countNlDerivedEdgesByMapping(index);

  const out: Record<string, unknown> = {
    schemas: [...nonMetricSchemas(index).values()].map((s) => {
      const obj: Record<string, unknown> = { name: displayName(s), fieldCount: totalFieldCount(s, index) };
      if (!compact) { obj.note = s.note; obj.file = s.file; obj.line = s.row + 1; }
      return obj;
    }),
    metrics: [...index.metrics.values()].map((m) => {
      const obj: Record<string, unknown> = { name: displayName(m), fieldCount: m.fields.length };
      if (!compact) { obj.displayName = m.displayName; obj.grain = m.grain; obj.sources = m.sources; obj.file = m.file; obj.line = m.row + 1; }
      return obj;
    }),
    mappings: [...index.mappings.entries()].map(([key, m]) => {
      const nlDerived = nlDerivedCounts.get(key) ?? 0;
      const obj: Record<string, unknown> = { name: displayName(m), arrowCount: m.arrowCount + nlDerived };
      if (nlDerived > 0) obj.nlDerivedArrowCount = nlDerived;
      if (!compact) { obj.sources = m.sources; obj.targets = m.targets; obj.file = m.file; obj.line = m.row + 1; }
      return obj;
    }),
    fragments: [...index.fragments.values()].map((f) => {
      const obj: Record<string, unknown> = { name: displayName(f), fieldCount: f.fields.length };
      if (!compact) { obj.file = f.file; obj.line = f.row + 1; }
      return obj;
    }),
    transforms: [...index.transforms.values()].map((t) => {
      const obj: Record<string, unknown> = { name: displayName(t) };
      if (!compact) { obj.file = t.file; obj.line = t.row + 1; }
      return obj;
    }),
    fileCount,
    warningCount: index.warnings.length,
    questionCount: index.questions.length,
    totalErrors: index.totalErrors,
  };
  console.log(JSON.stringify(out, null, 2));
}

function printCompact(index: ExtractedWorkspace): void {
  const section = (label: string, items: string[]): void => {
    if (items.length === 0) return;
    console.log(`${label}:`);
    for (const name of items) console.log(`  ${name}`);
  };

  section("schemas", [...nonMetricSchemas(index).keys()].map(canonicalKey));
  section("metrics", [...index.metrics.keys()].map(canonicalKey));
  section("mappings", [...index.mappings.keys()].map(canonicalKey));
  section("fragments", [...index.fragments.keys()].map(canonicalKey));
  section("transforms", [...index.transforms.keys()].map(canonicalKey));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? "s" : ""}`;
}

function printDefault(index: ExtractedWorkspace, fileCount: number): void {
  const schemas = [...nonMetricSchemas(index).values()];
  const metrics = [...index.metrics.values()];
  const mappings = [...index.mappings.values()];
  const fragments = [...index.fragments.values()];
  const transforms = [...index.transforms.values()];

  console.log(`Satsuma Workspace — ${fileCount} file${fileCount !== 1 ? "s" : ""}`);
  if (index.totalErrors > 0) {
    console.log(`  ⚠ parse errors: ${index.totalErrors}`);
  }
  console.log();

  const displayName = canonicalEntityName;

  if (schemas.length > 0) {
    console.log(`Schemas (${schemas.length}):`);
    for (const s of schemas) {
      const noteText = s.note?.split("\n")[0]?.trim() ?? null;
      const note = noteText ? `  — ${noteText}` : "";
      console.log(`  ${displayName(s)}  [${plural(totalFieldCount(s, index), "field")}]${note}`);
    }
    console.log();
  }

  if (metrics.length > 0) {
    console.log(`Metrics (${metrics.length}):`);
    for (const m of metrics) {
      const display = m.displayName ? ` "${m.displayName}"` : "";
      const grain = m.grain ? `  grain=${m.grain}` : "";
      console.log(`  ${displayName(m)}${display}  [${plural(m.fields.length, "field")}]${grain}`);
    }
    console.log();
  }

  if (mappings.length > 0) {
    console.log(`Mappings (${mappings.length}):`);
    for (const m of mappings) {
      const name = m.name ? displayName(m) : "(anonymous)";
      const src = m.sources.join(", ") || "?";
      const tgt = m.targets.join(", ") || "?";
      console.log(`  ${name}  ${src} → ${tgt}  [${plural(m.arrowCount, "arrow")}]`);
    }
    console.log();
  }

  if (fragments.length > 0) {
    console.log(`Fragments (${fragments.length}):`);
    for (const f of fragments) {
      console.log(`  ${displayName(f)}  [${plural(f.fields.length, "field")}]`);
    }
    console.log();
  }

  if (transforms.length > 0) {
    console.log(`Transforms (${transforms.length}):`);
    for (const t of transforms) {
      console.log(`  ${displayName(t)}`);
    }
    console.log();
  }

  const notes: string[] = [];
  if (index.warnings.length > 0) notes.push(`${index.warnings.length} warning comment${index.warnings.length !== 1 ? "s" : ""}`);
  if (index.questions.length > 0) notes.push(`${index.questions.length} question comment${index.questions.length !== 1 ? "s" : ""}`);
  if (notes.length > 0) console.log(notes.join("  ·  "));
}

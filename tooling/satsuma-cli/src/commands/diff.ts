/**
 * diff.js — `satsuma diff <a> <b>` command
 *
 * Structural comparison of two Satsuma files.
 *
 * Flags:
 *   --json         structured delta object
 *   --names-only   list changed block names only
 *   --stat         summary counts
 */

import type { Command } from "commander";
import { runCommand, CommandError, EXIT_PARSE_ERROR } from "../command-runner.js";
import { resolveInput } from "../workspace.js";
import { parseFile } from "../parser.js";
import { buildIndex } from "../index-builder.js";
import { diffIndex } from "../diff-engine.js";
import type { Delta, BlockDelta, SchemaChange, MappingChange, TransformChange } from "../types.js";

/** Union of all change kind strings across schema, mapping, and transform changes. */
type ChangeKind = SchemaChange["kind"] | MappingChange["kind"] | TransformChange["kind"];

/**
 * Dispatch table mapping each change kind to a formatter that prints a
 * single-line description. Replaces the prior 14-branch if-else chain
 * (sl-3kmd) and gives TypeScript exhaustiveness checking via `satisfies`.
 */
const CHANGE_PRINTERS: Record<ChangeKind, (c: SchemaChange | MappingChange | TransformChange) => string> = {
  // Schema / metric field changes
  "field-added":     (c) => `      + field ${(c as SchemaChange).field}`,
  "field-removed":   (c) => `      - field ${(c as SchemaChange).field}`,
  "type-changed":    (c) => `      ~ ${(c as SchemaChange).field}: ${String(c.from)} -> ${String(c.to)}`,
  "metadata-changed":(c) => `      ~ ${(c as SchemaChange).field} metadata: ${String(c.from)} -> ${String(c.to)}`,

  // Metric header attributes
  "source-changed":  (c) => `      ~ source: ${String(c.from)} -> ${String(c.to)}`,
  "grain-changed":   (c) => `      ~ grain: ${String(c.from)} -> ${String(c.to)}`,
  "slices-changed":  (c) => `      ~ slices: ${String(c.from)} -> ${String(c.to)}`,

  // Mapping arrow changes
  "arrow-count-changed":     (c) => `      ~ arrows: ${String(c.from)} -> ${String(c.to)}`,
  "sources-changed":         (c) => `      ~ sources: ${(c.from as string[]).join(", ")} -> ${(c.to as string[]).join(", ")}`,
  "targets-changed":         (c) => `      ~ targets: ${(c.from as string[]).join(", ")} -> ${(c.to as string[]).join(", ")}`,
  "arrow-added":             (c) => `      + arrow ${String((c as MappingChange).arrow)}`,
  "arrow-removed":           (c) => `      - arrow ${String((c as MappingChange).arrow)}`,
  "arrow-transform-changed": (c) => `      ~ arrow ${String((c as MappingChange).arrow)}: ${String(c.from)} -> ${String(c.to)}`,

  // Note changes (schema-level note tag and block notes)
  "note-changed":  (c) => `      ~ note: ${String(c.from)} -> ${String(c.to)}`,
  "note-added":    (c) => `      + note ${JSON.stringify(String(c.from))}`,
  "note-removed":  (c) => `      - note ${JSON.stringify(String(c.from))}`,

  // Transform body changes
  "body-changed":  (c) => `      ~ body: ${String(c.from)} -> ${String(c.to)}`,
} satisfies Record<ChangeKind, (c: SchemaChange | MappingChange | TransformChange) => string>;

export function register(program: Command): void {
  program
    .command("diff <a> <b>")
    .description("Structural diff between two Satsuma files")
    .option("--json", "structured JSON output")
    .option("--names-only", "list changed block names only")
    .option("--stat", "summary counts only")
    .addHelpText("after", `
Compares two Satsuma files structurally (not text diff). Only the two
files themselves are compared — imports are not followed.

JSON shape (--json):
  {
    "schemas":   {"added": [str], "removed": [str], "changed": [{"name": str, "changes": [...]}]},
    "mappings":  {"added": [str], "removed": [str], "changed": [...]},
    "metrics":   {"added": [str], "removed": [str], "changed": [...]},
    "fragments": {"added": [str], "removed": [str], "changed": [...]},
    "transforms":{"added": [str], "removed": [str], "changed": [...]},
    "notes":     {"added": [str], "removed": [str]}
  }

Examples:
  satsuma diff v1/pipeline.stm v2/pipeline.stm      # compare two versions
  satsuma diff old.stm new.stm --stat               # summary counts
  satsuma diff old.stm new.stm --json               # full structural delta
  satsuma diff old.stm new.stm --names-only         # just changed block names`)
    .action(runCommand(async (pathA: string, pathB: string, opts: { json?: boolean; namesOnly?: boolean; stat?: boolean }) => {
      let filesA: string[], filesB: string[];
      try {
        filesA = await resolveInput(pathA, { followImports: false });
        filesB = await resolveInput(pathB, { followImports: false });
      } catch (err: unknown) {
        // diff is one of the three commands that resolve directly rather
        // than through loadWorkspace — it needs `followImports: false` and
        // two separate inputs (see load-workspace.ts header).
        throw new CommandError(
          `Error resolving paths: ${(err as Error).message}`,
          EXIT_PARSE_ERROR,
        );
      }

      const indexA = buildIndex(filesA.map((f) => parseFile(f)));
      const indexB = buildIndex(filesB.map((f) => parseFile(f)));
      const delta = diffIndex(indexA, indexB);

      if (opts.json) {
        console.log(JSON.stringify(delta, null, 2));
        return;
      }

      const sectionHasChanges = (s: { added: unknown[]; removed: unknown[]; changed: unknown[] }) =>
        s.added.length > 0 || s.removed.length > 0 || s.changed.length > 0;
      const notesChanged = delta.notes.added.length > 0 || delta.notes.removed.length > 0;
      const hasChanges =
        sectionHasChanges(delta.schemas) ||
        sectionHasChanges(delta.mappings) ||
        sectionHasChanges(delta.metrics) ||
        sectionHasChanges(delta.fragments) ||
        sectionHasChanges(delta.transforms) ||
        notesChanged;

      if (!hasChanges) {
        console.log("No structural differences.");
        return;
      }

      if (opts.stat) {
        printStat(delta);
        return;
      }

      if (opts.namesOnly) {
        printNamesOnly(delta);
        return;
      }

      printDefault(delta);
    }));
}

function printStat(delta: Delta): void {
  function statSection(label: string, section: { added: unknown[]; removed: unknown[]; changed: unknown[] }): void {
    if (section.added.length > 0) console.log(`  ${section.added.length} ${label} added`);
    if (section.removed.length > 0) console.log(`  ${section.removed.length} ${label} removed`);
    if (section.changed.length > 0) console.log(`  ${section.changed.length} ${label} changed`);
  }
  statSection("schemas", delta.schemas);
  statSection("mappings", delta.mappings);
  statSection("metrics", delta.metrics);
  statSection("fragments", delta.fragments);
  statSection("transforms", delta.transforms);
  if (delta.notes.added.length > 0) console.log(`  ${delta.notes.added.length} notes added`);
  if (delta.notes.removed.length > 0) console.log(`  ${delta.notes.removed.length} notes removed`);
}

function printNamesOnly(delta: Delta): void {
  const names = new Set<string>();
  function collectNames(section: { added: string[]; removed: string[]; changed: Array<{ name: string }> }): void {
    for (const n of section.added) names.add(n);
    for (const n of section.removed) names.add(n);
    for (const c of section.changed) names.add(c.name);
  }
  collectNames(delta.schemas);
  collectNames(delta.mappings);
  collectNames(delta.metrics);
  collectNames(delta.fragments);
  collectNames(delta.transforms);
  for (const n of [...names].sort()) {
    console.log(n);
  }
}

function printDefault(delta: Delta): void {
  printSection("Schemas", delta.schemas);
  printSection("Mappings", delta.mappings);
  printSection("Metrics", delta.metrics);
  printSection("Fragments", delta.fragments);
  printSection("Transforms", delta.transforms);
  printNotes(delta);
}

function printNotes(delta: Delta): void {
  if (delta.notes.added.length === 0 && delta.notes.removed.length === 0) return;
  console.log("Notes:");
  for (const text of delta.notes.added) {
    const preview = text.length > 60 ? text.slice(0, 60) + "..." : text;
    console.log(`  + ${JSON.stringify(preview)}`);
  }
  for (const text of delta.notes.removed) {
    const preview = text.length > 60 ? text.slice(0, 60) + "..." : text;
    console.log(`  - ${JSON.stringify(preview)}`);
  }
  console.log();
}

function printSection(label: string, section: BlockDelta<SchemaChange | MappingChange | TransformChange>): void {
  const total =
    section.added.length + section.removed.length + section.changed.length;
  if (total === 0) return;

  console.log(`${label}:`);
  for (const name of section.added) {
    console.log(`  + ${name}`);
  }
  for (const name of section.removed) {
    console.log(`  - ${name}`);
  }
  for (const { name, changes } of section.changed) {
    console.log(`  ~ ${name}`);
    for (const c of changes) {
      const printer = CHANGE_PRINTERS[c.kind];
      console.log(printer(c));
    }
  }
  console.log();
}

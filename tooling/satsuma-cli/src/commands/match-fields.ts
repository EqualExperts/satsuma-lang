/**
 * match-fields.ts — `satsuma match-fields --source <schema> --target <schema>` command
 *
 * Deterministic normalized name comparison between two schemas.
 *
 * Flags:
 *   --matched-only    show only matched pairs
 *   --unmatched-only  show only unmatched fields
 *   --json            structured JSON output
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey } from "../index-builder.js";
import { matchFields } from "../normalize.js";
import { expandEntityFields } from "../spread-expand.js";
import type { SchemaRecord } from "../types.js";

export function register(program: Command): void {
  program
    .command("match-fields [path]")
    .description("Match fields between source and target schemas by normalized name")
    .requiredOption("--source <schema>", "source schema name")
    .requiredOption("--target <schema>", "target schema name")
    .option("--matched-only", "show only matched pairs")
    .option("--unmatched-only", "show only unmatched fields")
    .option("--json", "structured JSON output")
    .addHelpText(
      "after",
      `
Both --source and --target are required. Matching is case-insensitive with
underscores, hyphens, and spaces normalized. Names can be namespace-qualified.

JSON shape (--json):
  {
    "matched":    [{"source": str, "target": str}, ...],
    "sourceOnly": [str, ...],   # fields in source with no match
    "targetOnly": [str, ...]    # fields in target with no match
  }

Examples:
  satsuma match-fields --source crm --target warehouse
  satsuma match-fields --source pos::stores --target hub_store --matched-only
  satsuma match-fields --source crm --target warehouse --json`,
    )
    .action(
      runCommand(
        async (
          pathArg: string | undefined,
          opts: {
            source: string;
            target: string;
            matchedOnly?: boolean;
            unmatchedOnly?: boolean;
            json?: boolean;
          },
        ) => {
          const { index } = await loadWorkspace(pathArg);

          // Resolve and validate both schemas. Hand-rolling the resolution
          // here (instead of looping) lets TypeScript narrow `srcResolved` /
          // `tgtResolved` to non-null after each guard, which is cleaner than
          // the previous loop + non-null assertion dance.
          const resolveSchema = (name: string): { key: string; entry: SchemaRecord } => {
            const resolved = resolveIndexKey(name, index.schemas);
            if (resolved) return resolved;
            const close = [...index.schemas.keys()].find(
              (k) => k.toLowerCase() === name.toLowerCase(),
            );
            const lines = [`Schema '${name}' not found.`];
            if (close) lines.push(`Did you mean '${close}'?`);
            throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
          };

          const srcEntry = resolveSchema(opts.source).entry;
          const tgtEntry = resolveSchema(opts.target).entry;
          const srcFields = [
            ...srcEntry.fields,
            ...expandEntityFields(srcEntry, srcEntry.namespace ?? null, index),
          ];
          const tgtFields = [
            ...tgtEntry.fields,
            ...expandEntityFields(tgtEntry, tgtEntry.namespace ?? null, index),
          ];
          const result = matchFields(srcFields, tgtFields);

          if (opts.json) {
            const filtered = { ...result };
            if (opts.matchedOnly) {
              filtered.sourceOnly = [];
              filtered.targetOnly = [];
            } else if (opts.unmatchedOnly) {
              filtered.matched = [];
            }
            console.log(JSON.stringify(filtered, null, 2));
            return;
          }

          if (opts.matchedOnly) {
            if (result.matched.length === 0) {
              console.log("No matches found.");
              return;
            }
            for (const m of result.matched) {
              console.log(`  ${m.source} <-> ${m.target}  (${m.normalized})`);
            }
            return;
          }

          if (opts.unmatchedOnly) {
            if (result.sourceOnly.length === 0 && result.targetOnly.length === 0) {
              console.log("All fields matched.");
              return;
            }
            if (result.sourceOnly.length > 0) {
              console.log(`Source-only (${result.sourceOnly.length}):`);
              for (const f of result.sourceOnly) console.log(`  ${f}`);
            }
            if (result.targetOnly.length > 0) {
              console.log(`Target-only (${result.targetOnly.length}):`);
              for (const f of result.targetOnly) console.log(`  ${f}`);
            }
            return;
          }

          // Default: show all
          console.log(
            `Matched: ${result.matched.length}, Source-only: ${result.sourceOnly.length}, Target-only: ${result.targetOnly.length}`,
          );
          console.log();

          if (result.matched.length > 0) {
            console.log("Matched:");
            for (const m of result.matched) {
              console.log(`  ${m.source} <-> ${m.target}  (${m.normalized})`);
            }
            console.log();
          }

          if (result.sourceOnly.length > 0) {
            console.log("Source-only:");
            for (const f of result.sourceOnly) console.log(`  ${f}`);
            console.log();
          }

          if (result.targetOnly.length > 0) {
            console.log("Target-only:");
            for (const f of result.targetOnly) console.log(`  ${f}`);
          }
        },
      ),
    );
}

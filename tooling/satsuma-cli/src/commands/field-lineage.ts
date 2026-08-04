/**
 * field-lineage.ts — `satsuma field-lineage <schema.field>` command
 *
 * Traces the full field-level lineage of a single field in one command:
 * upstream (fields that feed into this field) and downstream (fields this
 * field flows into), following both declared arrows and NL-derived references.
 *
 * Flags:
 *   --upstream     only upstream chain
 *   --downstream   only downstream chain
 *   --depth <n>    limit traversal depth (default 10)
 *   --json         structured JSON output
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND, EXIT_PARSE_ERROR } from "../command-runner.js";
import { parsePositiveInt } from "../option-parsers.js";
import { resolveIndexKey, canonicalKey } from "../index-builder.js";
import { createFieldEdgeSource } from "../field-edge-source.js";
import { expandEntityFields } from "../spread-expand.js";
import {
  buildFieldEdges,
  collectFieldNames,
  createCanonicalFieldEndpoint,
  findFieldByPath,
  traceFieldLineage,
} from "@satsuma/core";
import type { FieldLineageDirection, FieldLineageResult } from "@satsuma/core";

export function register(program: Command): void {
  program
    .command("field-lineage <schema.field> [path]")
    .description("Trace the full upstream and downstream lineage of a single field")
    .option("--upstream", "only upstream chain")
    .option("--downstream", "only downstream chain")
    .option("--depth <n>", "maximum traversal depth", parsePositiveInt, 10)
    .option("--json", "structured JSON output")
    .addHelpText(
      "after",
      `
Traces all fields that flow into (upstream) and out of (downstream) the given
field, following declared arrows and NL-derived references. Detects cycles.

The field reference is <schema>.<field>. Namespace-qualified names work
(e.g. pos::stores.STORE_ID).

JSON output shape:
  {
    "field": "::schema.field",
    "upstream":   [{ "field": "::src.f", "via_mapping": "::m", "classification": "none" }, ...],
    "downstream": [{ "field": "::tgt.f", "via_mapping": "::m", "classification": "none" }, ...]
  }

Examples:
  satsuma field-lineage s2.a                     # full upstream + downstream
  satsuma field-lineage s2.a --upstream          # only upstream chain
  satsuma field-lineage s2.a --json              # structured output
  satsuma field-lineage ns::s2.a --downstream    # namespace-qualified`,
    )
    .action(
      runCommand(
        async (
          fieldRef: string,
          pathArg: string | undefined,
          opts: {
            upstream?: boolean;
            downstream?: boolean;
            depth: number;
            json?: boolean;
          },
        ) => {
          const dot = fieldRef.indexOf(".");
          if (dot === -1) {
            throw new CommandError(
              `Invalid field reference '${fieldRef}'. Expected format: schema.field`,
              EXIT_PARSE_ERROR,
            );
          }

          const schemaName = fieldRef.slice(0, dot);
          const fieldName = fieldRef.slice(dot + 1);

          const { index } = await loadWorkspace(pathArg);

          // Resolve the schema
          const resolvedSchema = resolveIndexKey(schemaName, index.schemas);
          if (!resolvedSchema) {
            throw new CommandError(`Schema '${schemaName}' not found.`, EXIT_NOT_FOUND);
          }

          // Validate field exists (including spread fields)
          const schema = resolvedSchema.entry;
          const spreadFields = expandEntityFields(schema, schema.namespace ?? null, index);
          const allFields = [...schema.fields, ...spreadFields];
          const fieldExists =
            findFieldByPath(allFields, fieldName) !== null ||
            collectFieldNames(allFields).includes(fieldName);
          if (!fieldExists) {
            throw new CommandError(
              `Field '${fieldName}' not found in schema '${schemaName}'.`,
              EXIT_NOT_FOUND,
            );
          }

          const qualifiedField = `${resolvedSchema.key}.${fieldName}`;
          const canonicalField = canonicalKey(qualifiedField);

          // Determine which directions to trace.
          // If both flags are set (or neither), trace both directions.
          const doUpstream = opts.upstream || !opts.downstream;
          const doDownstream = opts.downstream || !opts.upstream;
          const direction: FieldLineageDirection =
            doUpstream && doDownstream ? "both" : doUpstream ? "upstream" : "downstream";
          const edges = buildFieldEdges(createFieldEdgeSource(index)).edges;
          const result = traceFieldLineage(edges, createCanonicalFieldEndpoint(canonicalField), {
            depth: opts.depth,
            direction,
          });

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          printDefault(result, doUpstream, doDownstream);
        },
      ),
    );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function printDefault(
  result: FieldLineageResult,
  doUpstream: boolean,
  doDownstream: boolean,
): void {
  const total = result.upstream.length + result.downstream.length;
  console.log(`${result.field} — ${total} lineage connection${total !== 1 ? "s" : ""}`);
  console.log();

  if (doUpstream) {
    if (result.upstream.length === 0) {
      console.log("  upstream: (none)");
    } else {
      console.log(`  upstream (${result.upstream.length}):`);
      for (const u of result.upstream) {
        console.log(`    ${u.field}  via ${u.via_mapping}  [${u.classification}]`);
      }
    }
    console.log();
  }

  if (doDownstream) {
    if (result.downstream.length === 0) {
      console.log("  downstream: (none)");
    } else {
      console.log(`  downstream (${result.downstream.length}):`);
      for (const d of result.downstream) {
        console.log(`    ${d.field}  via ${d.via_mapping}  [${d.classification}]`);
      }
    }
    console.log();
  }
}

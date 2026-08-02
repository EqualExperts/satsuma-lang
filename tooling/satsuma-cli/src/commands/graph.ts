/**
 * graph.ts — `satsuma graph` command registration
 *
 * Registers the CLI command, parses options, and delegates to the graph
 * builder (graph-builder.ts) for assembly and the formatters (graph-format.ts)
 * for human-readable output. JSON output is emitted directly via
 * JSON.stringify.
 *
 * Does NOT own graph construction logic or output formatting — those concerns
 * live in graph-builder.ts and graph-format.ts respectively.
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, EXIT_PARSE_ERROR } from "../command-runner.js";
import { buildFullGraph } from "../schema-graph.js";
import { buildWorkspaceGraph } from "./graph-builder.js";
import { printDefault, printCompact } from "./graph-format.js";

/** CLI option shape produced by commander's option parsing. */
interface GraphOpts {
  json?: boolean;
  compact?: boolean;
  schemaOnly?: boolean;
  namespace?: string;
  nl?: boolean;
}

export function register(program: Command): void {
  program
    .command("graph [path]")
    .description("Export semantic graph for a Satsuma file and its imports")
    .option("--json", "full structured JSON output")
    .option("--compact", "schema-level adjacency list only")
    .option("--schema-only", "omit field-level edges and field arrays")
    .option("--namespace <ns>", "filter to a namespace")
    .option("--no-nl", "strip NL text from edges")
    .addHelpText(
      "after",
      `
Output modes (pick one):
  --json          full structured JSON (primary agent interface)
  --compact       flat schema-level adjacency list (minimal tokens)
  (default)       human-readable summary

Modifiers (combine with --json):
  --schema-only   drop field arrays and field-level edges (topology only)
  --no-nl         strip NL text from edges (smaller payload)
  --namespace     filter to nodes within a single namespace

JSON shape (--json):
  {
    "version":   int,
    "generated": str,   # ISO timestamp
    "workspace": str,   # absolute path
    "stats":     {"schemas": int, "mappings": int, "metrics": int, "fragments": int, "transforms": int, "arrows": int, "errors": int},
    "nodes":     [{"id": str, "kind": "schema"|"mapping"|"metric"|"transform", "namespace": str|null, "file": str, "line": int, ...}, ...],
    "edges":     [{"from": str|null, "to": str|null, "mapping": str, "classification": str, "file": str, "line": int, ...}, ...],
    "schema_edges": [{"from": str, "to": str, "role": "source"|"target"|"metric_source"|"nl_ref"}, ...],
    "warnings":  [{"text": str, "file": str, "line": int}, ...],
    "unresolved_nl": [{"scope": str, "arrow": str, "text": str, "file": str, "line": int}, ...]
  }
  edges[].classification: "none" | "nl" | "nl-derived"

Examples:
  satsuma graph pipeline.stm --json                  # full graph
  satsuma graph pipeline.stm --json --schema-only    # topology only
  satsuma graph pipeline.stm --json --namespace crm  # one namespace
  satsuma graph pipeline.stm --compact               # minimal output`,
    )
    .action(
      runCommand(async (pathArg: string | undefined, opts: GraphOpts) => {
        const root = pathArg ?? ".";
        const { index } = await loadWorkspace(root);
        const schemaGraph = buildFullGraph(index);
        const graph = buildWorkspaceGraph(index, schemaGraph, root, {
          namespace: opts.namespace ?? null,
          includeNl: opts.nl !== false, // --no-nl sets opts.nl to false
          schemaOnly: opts.schemaOnly ?? false,
        });

        if (opts.json) {
          console.log(JSON.stringify(graph, null, 2));
        } else if (opts.compact) {
          printCompact(graph);
        } else {
          printDefault(graph);
        }

        // The runner flushes stdout/stderr before exit, so we don't need
        // a manual drain here even though `--json` payloads can be large.
        if (index.totalErrors > 0) {
          return EXIT_PARSE_ERROR;
        }
      }),
    );
}

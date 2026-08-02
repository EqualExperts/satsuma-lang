/**
 * nl-refs.ts — `satsuma nl-refs` command
 *
 * Extracts and lists all @ref references from NL blocks
 * in transform bodies. Shows each reference with its classification,
 * resolution status, containing mapping, and source location.
 *
 * Flags:
 *   --mapping <name>   scope to a specific mapping
 *   --json             structured JSON output
 *   --unresolved       show only unresolved references
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey } from "../index-builder.js";
import { resolveAllNLRefs } from "../nl-ref-extract.js";
import type { ResolvedNLRef } from "../nl-ref-extract.js";

export function register(program: Command): void {
  program
    .command("nl-refs [path]")
    .description("Extract @ref references from NL transform bodies in a file and its imports")
    .option("--mapping <name>", "scope to a specific mapping")
    .option("--json", "structured JSON output")
    .option("--unresolved", "show only unresolved references")
    .addHelpText(
      "after",
      `
@ref references are @field_name, @schema.field, or @ns::schema.field
inside "..." NL strings. Each ref is checked against the file index —
"resolved" means the referenced field or schema exists, "unresolved" means
it was not found.

JSON shape (--json): array of ref objects
  [{
    "ref":            str,   # the reference text (without @ or backticks)
    "classification": "bare" | "dotted-field" | "namespace-qualified-field" | "namespace-qualified-schema",
    "resolved":       bool,
    "resolvedTo":     {"kind": str, "name": str} | null,
    "mapping":        str,
    "targetField":    str | null,
    "file":           str,
    "line":           int,
    "column":         int
  }, ...]

Examples:
  satsuma nl-refs pipeline.stm                       # all refs in file and imports
  satsuma nl-refs --mapping 'load hub_customer'      # refs in one mapping
  satsuma nl-refs pipeline.stm --unresolved --json   # broken refs as JSON`,
    )
    .action(
      runCommand(
        async (
          pathArg: string | undefined,
          opts: { mapping?: string; json?: boolean; unresolved?: boolean },
        ) => {
          const { index } = await loadWorkspace(pathArg);

          let refs = resolveAllNLRefs(index);

          // Apply --mapping filter
          if (opts.mapping) {
            const resolved = resolveIndexKey(opts.mapping, index.mappings);
            if (!resolved) {
              throw new CommandError(`Mapping '${opts.mapping}' not found.`, EXIT_NOT_FOUND);
            }
            refs = refs.filter((r) => r.mapping === resolved.key);
          }

          // Apply --unresolved filter
          if (opts.unresolved) {
            refs = refs.filter((r) => !r.resolved);
          }

          if (opts.json) {
            const out = refs.map((r) => ({ ...r, line: r.line + 1 }));
            console.log(JSON.stringify(out, null, 2));
            return refs.length === 0 ? EXIT_NOT_FOUND : undefined;
          }

          if (refs.length === 0) {
            console.log("No NL @ref references found.");
            return EXIT_NOT_FOUND;
          }

          printDefault(refs);
        },
      ),
    );
}

function printDefault(refs: ResolvedNLRef[]): void {
  console.log(`NL @ref references (${refs.length} total):`);
  console.log();

  // Group by mapping
  const byMapping = new Map<string, ResolvedNLRef[]>();
  for (const ref of refs) {
    if (!byMapping.has(ref.mapping)) byMapping.set(ref.mapping, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
    byMapping.get(ref.mapping)!.push(ref);
  }

  for (const [mapping, mappingRefs] of byMapping) {
    // Format the label: "mapping 'name'", "metric 'name'", "schema 'name'", etc.
    let label: string;
    if (mapping.startsWith("note:metric:")) {
      label = `metric '${mapping.slice(12)}'`;
    } else if (mapping.startsWith("note:schema:")) {
      label = `schema '${mapping.slice(12)}'`;
    } else if (mapping.startsWith("note:fragment:")) {
      label = `fragment '${mapping.slice(14)}'`;
    } else if (mapping.startsWith("note:")) {
      label = `note '${mapping.slice(5)}'`;
    } else if (mapping.startsWith("transform:")) {
      label = `transform '${mapping.slice(10)}'`;
    } else {
      label = `mapping '${mapping}'`;
    }
    console.log(`  ${label}:`);
    for (const ref of mappingRefs) {
      const status = ref.resolved ? `-> ${ref.resolvedTo?.name ?? "?"}` : "(unresolved)";
      const padRef = `\`${ref.ref}\``.padEnd(32);
      const padClass = ref.classification.padEnd(28);
      console.log(`    ${padRef} ${padClass} ${status}  (line ${ref.line + 1})`);
    }
    console.log();
  }
}

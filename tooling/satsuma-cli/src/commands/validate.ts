/**
 * validate.ts — `satsuma validate` command
 *
 * Reports parse errors and semantic warnings.
 *
 * Flags:
 *   --json          array of diagnostics
 *   --errors-only   suppress warnings
 *   --quiet         exit code only (0=clean, 2=errors)
 */

import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";
import type { Command } from "commander";
import { runCommand, CommandError, EXIT_PARSE_ERROR } from "../command-runner.js";
import { resolveInput } from "../workspace.js";
import { parseFile } from "../parser.js";
import { buildIndex, extractFileData } from "../index-builder.js";
import { extractImports, collectParseErrors } from "@satsuma/core";
import { collectSemanticWarnings } from "../semantic-warnings.js";
import type { LintDiagnostic } from "../types.js";

export function register(program: Command): void {
  program
    .command("validate [path]")
    .description("Validate a Satsuma file (and its imports) for parse errors and semantic issues")
    .option("--json", "structured JSON output")
    .option("--errors-only", "suppress warnings")
    .option("--quiet", "exit code only (0=clean, 2=errors)")
    .addHelpText(
      "after",
      `
JSON shape (--json):
  {
    "findings": [{"severity": str, "message": str, "file": str, "line": int, "col": int}, ...],
    "summary":  {"files": int, "errors": int, "warnings": int}
  }

Exit codes: 0 = clean, 2 = parse errors or semantic issues.

Examples:
  satsuma validate pipeline.stm              # validate entry file and its imports
  satsuma validate pipeline.stm --json       # structured diagnostics
  satsuma validate pipeline.stm --quiet      # exit code only
  satsuma validate pipeline.stm --errors-only  # suppress warnings`,
    )
    .action(
      runCommand(
        async (
          pathArg: string | undefined,
          opts: { json?: boolean; errorsOnly?: boolean; quiet?: boolean },
        ) => {
          const root = pathArg ?? ".";
          let files: string[];
          try {
            files = await resolveInput(root);
          } catch (err: unknown) {
            // `validate` predates loadWorkspace and is one of the three
            // commands that resolve the input directly (see load-workspace.ts
            // header for why). Its `--json` mode reports the resolve failure
            // as a one-element diagnostics array on stdout so jq pipelines
            // still parse; the text mode prints to stderr like every other
            // resolve failure.
            const msg = `Error resolving path: ${(err as Error).message}`;
            if (opts.json) {
              throw new CommandError(
                JSON.stringify([{ severity: "error", message: msg }], null, 2),
                EXIT_PARSE_ERROR,
                "stdout",
              );
            }
            throw new CommandError(msg, EXIT_PARSE_ERROR);
          }

          // Parse each file and extract data immediately (tree-sitter reuses a
          // single parser buffer, so prior trees become invalid after a new parse).
          const extracted = [];
          const parseErrors: LintDiagnostic[] = [];
          for (const f of files) {
            const parsed = parseFile(f);
            // Collect parse errors and extract data while tree is still valid.
            // Map core's 0-indexed ParseErrorEntry to CLI's 1-indexed LintDiagnostic.
            for (const e of collectParseErrors(parsed.tree)) {
              parseErrors.push({
                file: parsed.filePath,
                line: e.startRow + 1,
                column: e.startColumn + 1,
                severity: "error",
                rule: e.isMissing ? "missing-node" : "parse-error",
                message: e.message,
                fixable: false,
              });
            }

            // Check for missing import files and undefined import names
            const imports = extractImports(parsed.tree.rootNode);
            for (const imp of imports) {
              if (!imp.path) continue;
              const resolved = resolve(dirname(parsed.filePath), imp.path);
              try {
                statSync(resolved);
                // File exists — check that each imported name is defined in the target
                const targetParsed = parseFile(resolved);
                const targetData = extractFileData(targetParsed);
                const targetNames = new Set<string>();
                const allEntities = [
                  ...targetData.mappings,
                  ...targetData.schemas,
                  ...targetData.fragments,
                  ...targetData.transforms,
                ];
                for (const entity of allEntities) {
                  if (entity.name) {
                    targetNames.add(entity.name);
                    if (entity.namespace) targetNames.add(`${entity.namespace}::${entity.name}`);
                  }
                }
                for (const name of imp.names) {
                  if (!targetNames.has(name)) {
                    parseErrors.push({
                      file: parsed.filePath,
                      line: imp.row + 1,
                      column: 1,
                      severity: "warning",
                      rule: "undefined-import",
                      message: `Import name '${name}' not found in "${imp.path}"`,
                      fixable: false,
                    });
                  }
                }
              } catch {
                parseErrors.push({
                  file: parsed.filePath,
                  line: imp.row + 1,
                  column: 1,
                  severity: "warning",
                  rule: "missing-import",
                  message: `Import target "${imp.path}" not found`,
                  fixable: false,
                });
              }
            }

            extracted.push(extractFileData(parsed));
          }

          const index = buildIndex(extracted);

          // Collect diagnostics
          const diagnostics: LintDiagnostic[] = [...parseErrors];

          // Semantic diagnostics (errors always included, warnings only when not --errors-only)
          const semantics = collectSemanticWarnings(index);
          if (opts.errorsOnly) {
            diagnostics.push(...semantics.filter((d) => d.severity === "error"));
          } else {
            diagnostics.push(...semantics);
          }

          // Sort by file, then line
          diagnostics.sort(
            (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
          );

          const errorCount = diagnostics.filter((d) => d.severity === "error").length;
          const warnCount = diagnostics.filter((d) => d.severity === "warning").length;

          // Soft exit code: validate uses 2 for "any error-severity finding"
          // and 0 otherwise. Warnings never push the exit non-zero — that's
          // documented in the command help.
          const exitCode = errorCount > 0 ? EXIT_PARSE_ERROR : 0;

          if (opts.quiet) {
            return exitCode;
          }

          if (opts.json) {
            console.log(
              JSON.stringify(
                {
                  findings: diagnostics,
                  summary: {
                    files: extracted.length,
                    errors: errorCount,
                    warnings: warnCount,
                  },
                },
                null,
                2,
              ),
            );
            return exitCode;
          }

          if (diagnostics.length === 0) {
            console.log(
              `Validated ${extracted.length} file${extracted.length !== 1 ? "s" : ""}: no issues found.`,
            );
            return;
          }

          // Group by file
          const byFile = new Map<string, LintDiagnostic[]>();
          for (const d of diagnostics) {
            if (!byFile.has(d.file)) byFile.set(d.file, []);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
            byFile.get(d.file)!.push(d);
          }

          for (const [file, fileDiags] of byFile) {
            for (const d of fileDiags) {
              const sev = d.severity === "error" ? "error" : "warning";
              console.log(`${file}:${d.line}:${d.column} ${sev} [${d.rule}] ${d.message}`);
            }
          }

          console.log();
          console.log(
            `${errorCount} error${errorCount !== 1 ? "s" : ""}, ${warnCount} warning${warnCount !== 1 ? "s" : ""} in ${extracted.length} file${extracted.length !== 1 ? "s" : ""}`,
          );

          return exitCode;
        },
      ),
    );
}

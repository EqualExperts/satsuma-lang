/**
 * lint.ts — `satsuma lint` command
 *
 * Policy-oriented linting for Satsuma workspaces.  Surfaces workspace
 * hygiene and modelling convention issues as structured diagnostics.
 *
 * **`lint` publishes its own exit-code table** (PRD 37 R5), following the
 * `fmt --check` precedent of a command owning codes that mean something specific
 * to it:
 *
 *   0 — no findings, or warnings only without strict mode
 *   1 — warnings present and strict mode active
 *   2 — error-severity findings present
 *   3 — lint could not run (unusable config, unknown rule id, unreadable workspace)
 *
 * This is a breaking change for CI jobs keying off the previous codes, where `2`
 * doubled as "could not run" — see CHANGELOG.md. The split is what makes a
 * failing gate distinguishable from a broken setup: `2` now means "the workspace
 * has lint errors" and nothing else.
 *
 * Flags:
 *   --json      machine-readable JSON output
 *   --fix       apply safe, deterministic fixes
 *   --select    run only listed rules (comma-separated)
 *   --ignore    skip listed rules (comma-separated)
 *   --config    path to satsuma.config.yaml (default ./satsuma.config.yaml)
 *   --strict    make warnings exit non-zero (--no-strict forces advisory)
 *   --quiet     exit code only
 *
 * Rule selection combines flags and config through
 * `resolveSuppressedRuleIds` — see its contract for the precedence rule.
 */

import type { Command } from "commander";
import { readFileSync, writeFileSync } from "fs";
import {
  SATSUMA_CONFIG_FILENAME,
  resolveSuppressedRuleIds,
  unknownRuleIds,
} from "@satsuma/core/config";
import { loadWorkspace } from "../load-workspace.js";
import type { LoadedWorkspace } from "../load-workspace.js";
import { loadSatsumaConfig } from "../load-config.js";
import {
  CommandError,
  runCommand,
  EXIT_OK,
  EXIT_PARSE_ERROR,
  EXIT_LINT_CANNOT_RUN,
  EXIT_LINT_STRICT_WARNINGS,
} from "../command-runner.js";
import { runLint, applyFixes, RULES } from "../lint-engine.js";
import type { LintDiagnostic, LintFix } from "../types.js";

/** Every rule id the engine knows, used to reject typos wherever ids are named. */
const KNOWN_RULE_IDS: readonly string[] = RULES.map((r) => r.id);

/**
 * Width of the id column in `--rules`, computed from the registry rather than
 * hard-coded so that registering a rule with a longer id cannot knock the
 * description column out of alignment (sl-n4rb).
 */
const RULE_ID_COLUMN_WIDTH = Math.max(...KNOWN_RULE_IDS.map((id) => id.length));

/** Split a comma-separated rule-id flag value, dropping incidental whitespace. */
function parseRuleList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Reject rule ids that do not exist, so a typo fails loudly instead of quietly
 * selecting or suppressing nothing.
 *
 * Applies the same check and message to `--select` and `--ignore` that
 * `@satsuma/core/config` applies to `lint.suppress`: a rule id is a rule id
 * wherever it is written, and until now a misspelled flag value was accepted
 * in silence.
 */
function assertKnownRuleIds(flag: string, ids: readonly string[]): void {
  const unknown = unknownRuleIds(ids, KNOWN_RULE_IDS);
  if (unknown.length === 0) return;

  const plural = unknown.length > 1 ? "s" : "";
  throw new CommandError(
    `Error: ${flag}: unknown lint rule${plural} ${unknown.map((id) => `"${id}"`).join(", ")}. ` +
      `Valid rules: ${[...KNOWN_RULE_IDS].sort().join(", ")}`,
    EXIT_LINT_CANNOT_RUN,
  );
}

/**
 * The code `lint` exits with, given the findings that survived fixing.
 *
 * The whole of PRD 37 R5's table in one place, so the meaning of each code is
 * readable rather than spread across the handler:
 *
 *   - errors outrank warnings — a workspace with both is reported as `2`,
 *     because fixing the errors is the first thing to do either way;
 *   - warnings escalate to `1` only under strict mode, so the advisory default
 *     is preserved and adding a config file cannot break an existing CI job;
 *   - suppressed rules need no special case: a suppressed rule produces no
 *     findings at all, so it can never trigger a strict failure.
 */
function lintExitCode(diagnostics: readonly LintDiagnostic[], strict: boolean): number {
  if (diagnostics.some((d) => d.severity === "error")) return EXIT_PARSE_ERROR;
  if (strict && diagnostics.length > 0) return EXIT_LINT_STRICT_WARNINGS;
  return EXIT_OK;
}

/**
 * Load the workspace, reporting a failure to load as `3` rather than `2`.
 *
 * `loadWorkspace` raises {@link EXIT_PARSE_ERROR} because that is the CLI-wide
 * code for unreadable input, but under lint's own table `2` means "the workspace
 * has lint errors". A CI job must be able to tell a failing gate from a broken
 * checkout, so the code is remapped here — the message and stream the loader
 * chose are passed through untouched.
 */
async function loadLintWorkspace(pathArg: string | undefined): Promise<LoadedWorkspace> {
  try {
    return await loadWorkspace(pathArg);
  } catch (err: unknown) {
    if (err instanceof CommandError && err.code === EXIT_PARSE_ERROR) {
      throw new CommandError(err.message, EXIT_LINT_CANNOT_RUN, err.stream);
    }
    throw err;
  }
}

export function register(program: Command): void {
  program
    .command("lint [path]")
    .description("Lint a Satsuma file (and its imports) for policy and convention issues")
    .option("--json", "structured JSON output")
    .option("--fix", "apply safe, deterministic fixes")
    .option("--select <rules>", "run only listed rules (comma-separated)")
    .option("--ignore <rules>", "skip listed rules (comma-separated)")
    .option("--config <path>", `path to config (default ./${SATSUMA_CONFIG_FILENAME})`)
    .option("--strict", "make warning-severity findings exit non-zero")
    .option("--no-strict", "keep warnings advisory even when the config sets strict")
    .option("--quiet", "exit code only")
    .option("--rules", "list available lint rules and exit")
    .addHelpText(
      "after",
      `
Rules:
  hidden-source-in-nl        error    NL text references a schema not in the mapping's source/target list
  unresolved-nl-ref          warning  @ reference in NL does not resolve to any known identifier
  duplicate-definition       error    Named definition is declared more than once in a namespace
  unenumerated-record-target warning  Arrow targets a record without a record source or child arrows
  type-mismatch-direct-arrow warning  Bare arrow connects fields whose declared types differ
  lineage-cycle              warning  Schema-level mapping graph contains a cycle

  Exemptions worth knowing: type-mismatch-direct-arrow never checks an arrow that
  carries a transform body (a transform may legitimately change type, and judging
  that is NL interpretation the CLI leaves to agents), and lineage-cycle never
  reports a self-mapping (same source and target schema — how an increment is
  expressed).

JSON shape (--json):
  {
    "findings": [{"rule": str, "severity": str, "message": str, "file": str, "line": int, "fixable": bool}, ...],
    "fixes":    [{"rule": str, "file": str, "description": str}, ...],
    "summary":  {"files": int, "findings": int, "fixable": int, "fixed": int}
  }

Exit codes (lint has its own table):
  0  no findings, or warnings only without --strict
  1  warnings present and --strict active
  2  error-severity findings present
  3  lint could not run (unusable config, unknown rule id, unreadable workspace)

Configuration (${SATSUMA_CONFIG_FILENAME}, override with --config):
  lint:
    suppress: [unresolved-nl-ref]   # rules to skip in every run
    typeAliases: [[STRING, TEXT]]   # declared types to treat as equivalent
    strict: false                   # make warnings exit non-zero

  A missing config file is not an error. Suppression is the union of --ignore
  and lint.suppress, except that a rule named by --select always runs.
  --strict / --no-strict win over lint.strict. Suppressed rules produce no
  findings, so they can never trigger a strict failure.

Examples:
  satsuma lint pipeline.stm                  # check conventions
  satsuma lint pipeline.stm --json           # structured diagnostics
  satsuma lint pipeline.stm --fix            # auto-fix fixable issues
  satsuma lint pipeline.stm --strict         # fail CI on warnings too
  satsuma lint --rules                       # list available rules
  satsuma lint pipeline.stm --select hidden-source-in-nl  # run one rule only
  satsuma lint pipeline.stm --config ci.yaml # lint with a specific config`,
    )
    .action(
      runCommand(
        async (
          pathArg: string | undefined,
          opts: {
            json?: boolean;
            fix?: boolean;
            select?: string;
            ignore?: string;
            config?: string;
            /**
             * Tri-state: `undefined` when neither `--strict` nor `--no-strict`
             * was passed, which is what lets the config supply the default.
             */
            strict?: boolean;
            quiet?: boolean;
            rules?: boolean;
          },
        ) => {
          // --rules: list available rules and exit
          if (opts.rules) {
            for (const r of RULES) {
              console.log(`  ${r.id.padEnd(RULE_ID_COLUMN_WIDTH)} ${r.description}`);
            }
            return;
          }

          // Resolve rule selection before touching the workspace: a typo in a
          // rule id or an unusable config is worth reporting without waiting
          // for a large workspace to parse.
          const select = opts.select ? parseRuleList(opts.select) : undefined;
          const ignore = opts.ignore ? parseRuleList(opts.ignore) : undefined;
          if (select) assertKnownRuleIds("--select", select);
          if (ignore) assertKnownRuleIds("--ignore", ignore);

          const config = loadSatsumaConfig({
            explicitPath: opts.config,
            knownRuleIds: KNOWN_RULE_IDS,
            // Config notes go to stderr so they never pollute --json output on
            // stdout, and are silenced entirely by --quiet.
            ...(opts.quiet ? {} : { onWarning: (m: string) => console.error(`Warning: ${m}`) }),
          });

          // Flags win over config; `undefined` means neither flag was passed.
          const strict = opts.strict ?? config.lint.strict;

          const suppressed = resolveSuppressedRuleIds({
            ...(select ? { select } : {}),
            ...(ignore ? { ignore } : {}),
            configSuppress: config.lint.suppress,
          });

          const { files, index } = await loadLintWorkspace(pathArg);
          const fileCount = files.length;

          const ruleOpts: Parameters<typeof runLint>[1] = {
            typeAliases: config.lint.typeAliases,
          };
          if (select) ruleOpts.select = select;
          if (suppressed.size > 0) ruleOpts.ignore = [...suppressed];

          let diagnostics = runLint(index, ruleOpts);

          // --fix: apply safe fixes
          let appliedFixes: LintFix[] = [];
          if (opts.fix && diagnostics.some((d) => d.fixable)) {
            // Read source files that have fixable diagnostics
            const fixableFiles = new Set(
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: d.fix is checked by the filter predicate
              diagnostics.filter((d) => d.fixable && d.fix).map((d) => d.fix!.file),
            );
            const sourceByFile = new Map<string, string>();
            for (const f of fixableFiles) {
              try {
                sourceByFile.set(f, readFileSync(f, "utf8"));
              } catch {
                // skip files that can't be read
              }
            }

            const result = applyFixes(sourceByFile, diagnostics);
            appliedFixes = result.appliedFixes;

            // Write fixed files
            for (const [file, content] of result.fixedFiles) {
              writeFileSync(file, content, "utf8");
            }

            // Remove fixed diagnostics from the output
            const fixedRules = new Set(appliedFixes.map((f) => `${f.file}:${f.rule}`));
            diagnostics = diagnostics.filter(
              (d) => !d.fixable || !fixedRules.has(`${d.file}:${d.rule}`),
            );
          }

          const findingCount = diagnostics.length;
          const fixableCount = diagnostics.filter((d) => d.fixable).length;
          const exitCode = lintExitCode(diagnostics, strict);

          // --quiet: exit code only
          if (opts.quiet) {
            return exitCode;
          }

          // --json: structured output
          if (opts.json) {
            const payload = {
              findings: diagnostics.map(({ fix: _fix, ...rest }) => rest),
              fixes: appliedFixes.map(({ apply: _apply, ...rest }) => rest),
              summary: {
                files: fileCount,
                findings: findingCount,
                fixable: fixableCount,
                fixed: appliedFixes.length,
              },
            };
            console.log(JSON.stringify(payload, null, 2));
            return exitCode;
          }

          // Text output
          if (appliedFixes.length > 0) {
            for (const fix of appliedFixes) {
              console.log(`Fixed: ${fix.file} [${fix.rule}] ${fix.description}`);
            }
            console.log();
          }

          if (findingCount === 0 && appliedFixes.length === 0) {
            console.log(`Linted ${fileCount} file${fileCount !== 1 ? "s" : ""}: no issues found.`);
            return;
          }

          if (findingCount === 0 && appliedFixes.length > 0) {
            console.log(
              `${appliedFixes.length} fixed, no remaining issues in ${fileCount} file${fileCount !== 1 ? "s" : ""}`,
            );
            return;
          }

          // Print remaining findings grouped by file
          for (const d of diagnostics) {
            const sev = d.severity === "error" ? "error" : "warning";
            const fixTag = d.fixable ? " (fixable)" : "";
            console.log(`${d.file}:${d.line}:${d.column} ${sev} [${d.rule}] ${d.message}${fixTag}`);
          }

          console.log();
          if (appliedFixes.length > 0) {
            console.log(
              `${appliedFixes.length} fixed, ${findingCount} remaining in ${fileCount} file${fileCount !== 1 ? "s" : ""} (${fixableCount} fixable)`,
            );
          } else {
            console.log(
              `${findingCount} finding${findingCount !== 1 ? "s" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""} (${fixableCount} fixable)`,
            );
          }

          return exitCode;
        },
      ),
    );
}

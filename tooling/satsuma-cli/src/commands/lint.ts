/**
 * lint.ts — `satsuma lint` command
 *
 * Policy-oriented linting for Satsuma workspaces.  Surfaces workspace
 * hygiene and modelling convention issues as structured diagnostics.
 *
 * Exit codes:
 *   0 — no error-severity findings (warnings alone do not cause exit 2)
 *   1 — internal error (filesystem, parser crash, bad arguments)
 *   2 — error-severity lint findings present
 *   3 — lint could not run (unusable config, unknown rule id)
 *
 * Flags:
 *   --json     machine-readable JSON output
 *   --fix      apply safe, deterministic fixes
 *   --select   run only listed rules (comma-separated)
 *   --ignore   skip listed rules (comma-separated)
 *   --config   path to satsuma.config.yaml (default ./satsuma.config.yaml)
 *   --quiet    exit code only
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
  type SatsumaConfig,
} from "@satsuma/core/config";
import { loadWorkspace } from "../load-workspace.js";
import { loadSatsumaConfig } from "../load-config.js";
import {
  CommandError,
  runCommand,
  EXIT_PARSE_ERROR,
  EXIT_LINT_CANNOT_RUN,
} from "../command-runner.js";
import { runLint, applyFixes, RULES } from "../lint-engine.js";
import type { LintFix } from "../types.js";

/** Every rule id the engine knows, used to reject typos wherever ids are named. */
const KNOWN_RULE_IDS: readonly string[] = RULES.map((r) => r.id);

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
 * Warn about settings this CLI version parses but does not yet act on.
 *
 * `lint.strict` and `lint.typeAliases` are part of the config contract from the
 * start (the LSP and CI need a stable shape to write against) but their
 * consumers ship separately: strict-mode exit codes in `sl-1u6r`, type aliasing
 * with the `type-mismatch-direct-arrow` rule in `sl-j30s`. Accepting them in
 * silence would let an author believe a gate is active when nothing enforces it
 * — the exact failure the config was added to prevent.
 */
function warnInertSettings(
  config: SatsumaConfig,
  warn: ((message: string) => void) | undefined,
): void {
  if (!warn) return;

  if (config.lint.strict) {
    warn("lint.strict is not enforced yet — warnings still exit 0 (see sl-1u6r).");
  }
  if (config.lint.typeAliases.length > 0) {
    warn("lint.typeAliases has no consumer yet — no rule compares declared types (see sl-j30s).");
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
    .option("--quiet", "exit code only")
    .option("--rules", "list available lint rules and exit")
    .addHelpText(
      "after",
      `
Rules:
  hidden-source-in-nl  error    NL text references a schema not in the mapping's source/target list
  unresolved-nl-ref    warning  @ reference in NL does not resolve to any known identifier
  duplicate-definition error    Named definition is declared more than once in a namespace

JSON shape (--json):
  {
    "findings": [{"rule": str, "severity": str, "message": str, "file": str, "line": int, "fixable": bool}, ...],
    "fixes":    [{"rule": str, "file": str, "description": str}, ...],
    "summary":  {"files": int, "findings": int, "fixable": int, "fixed": int}
  }

Exit codes:
  0  no error-severity findings
  2  error-severity findings present
  3  lint could not run (unusable config, or an unknown rule id)

Configuration (${SATSUMA_CONFIG_FILENAME}, override with --config):
  lint:
    suppress: [unresolved-nl-ref]   # rules to skip in every run
    typeAliases: [[STRING, TEXT]]   # declared types to treat as equivalent
    strict: false                   # make warnings exit non-zero

  A missing config file is not an error. Suppression is the union of --ignore
  and lint.suppress, except that a rule named by --select always runs.

Examples:
  satsuma lint pipeline.stm                  # check conventions
  satsuma lint pipeline.stm --json           # structured diagnostics
  satsuma lint pipeline.stm --fix            # auto-fix fixable issues
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
            quiet?: boolean;
            rules?: boolean;
          },
        ) => {
          // --rules: list available rules and exit
          if (opts.rules) {
            for (const r of RULES) {
              console.log(`  ${r.id.padEnd(24)} ${r.description}`);
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

          warnInertSettings(config, opts.quiet ? undefined : (m) => console.error(`Warning: ${m}`));

          const suppressed = resolveSuppressedRuleIds({
            ...(select ? { select } : {}),
            ...(ignore ? { ignore } : {}),
            configSuppress: config.lint.suppress,
          });

          const { files, index } = await loadWorkspace(pathArg);
          const fileCount = files.length;

          const ruleOpts: { select?: string[]; ignore?: string[] } = {};
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
          const errorCount = diagnostics.filter((d) => d.severity === "error").length;
          const fixableCount = diagnostics.filter((d) => d.fixable).length;

          // Soft exit code: lint uses 2 for "any error-severity finding"
          // and 0 otherwise. Warning-severity rules never push the exit
          // non-zero — that's documented in the command help.
          const exitCode = errorCount > 0 ? EXIT_PARSE_ERROR : 0;

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

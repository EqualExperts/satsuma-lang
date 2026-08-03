/**
 * coverage.ts — `satsuma coverage [path]` command
 *
 * Answers the first question every reviewer of a mapping spec asks: which
 * declared fields is nothing mapping yet? Reports covered/uncovered status per
 * mapping, per participating schema, across the whole workspace reachable from
 * the entry file.
 *
 * Owns: scoping flags and rendering (human table and `--json`).
 * Does not own: coverage semantics (`@satsuma/core/coverage`), the counting rule
 * (`@satsuma/core/coverage-rollup`), or index adaptation
 * (`../coverage-workspace.js`). This module must contain no coverage logic of
 * its own — the whole point of feature 35 is that one implementation answers
 * this question for the CLI, the editor, and the viz overlay alike.
 *
 * Flags:
 *   --mapping <name>   report on one mapping
 *   --schema <name>    report on one schema, across every mapping using it
 *   --role <role>      restrict to source or target
 *   --uncovered        list only the fields nothing maps
 *   --fail-under <pct> exit 3 when the gated coverage is below <pct>
 *   --json             structured JSON output
 */

import { Option } from "commander";
import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import {
  runCommand,
  CommandError,
  EXIT_NOT_FOUND,
  EXIT_THRESHOLD_NOT_MET,
} from "../command-runner.js";
import { parsePercentage } from "../option-parsers.js";
import { canonicalKey, displayKey, resolveIndexKey } from "../index-builder.js";
import { coverageForWorkspace } from "../coverage-workspace.js";
import { resolveAllNLRefs } from "../nl-ref-extract.js";
import type { MappingCoverage } from "../coverage-workspace.js";
import { aggregateCoverage, summarizeFieldCoverage, leafFieldEntries } from "@satsuma/core";
import type {
  AggregateCoverage,
  AggregateSchemaCoverage,
  CoverageTotals,
  FieldCoverageEntry,
  RoleTotals,
  SchemaCoverageResult,
} from "@satsuma/core";

/** Roles a schema can play in a mapping; the accepted values of `--role`. */
const ROLES = ["source", "target"] as const;
type Role = (typeof ROLES)[number];

/** Scoping and presentation options, after Commander has parsed them. */
interface CoverageOptions {
  mapping?: string;
  schema?: string;
  role?: string;
  uncovered?: boolean;
  /** Already coerced to a whole 0-100 by {@link parsePercentage}. */
  failUnder?: number;
  json?: boolean;
}

export function register(program: Command): void {
  program
    .command("coverage [path]")
    .description("Report which declared fields each mapping covers, and which nothing maps")
    .option("--mapping <name>", "only this mapping")
    .option("--schema <name>", "only this schema, across every mapping that uses it")
    .addOption(
      // .choices() rather than a hand-rolled check: an invalid value then reports
      // itself as a usage error with help, exactly like every other bad flag
      // value in the CLI, instead of inventing a second convention.
      new Option("--role <role>", "only 'source' or 'target' schemas").choices([...ROLES]),
    )
    .option("--uncovered", "list only the fields nothing maps")
    .option("--fail-under <pct>", "exit 3 when aggregate coverage is below <pct>", parsePercentage)
    .option("--json", "structured JSON output")
    .addHelpText(
      "after",
      `
Coverage follows explicit references. A field counts as covered when an arrow in
the mapping references it (the 'declared' tier) or a resolved NL @ref names it
(the 'nl' tier). Nested paths cover their parents — mapping 'address.city' covers
'address' but not 'address.line1'.

The two tiers share one denominator and never double-count: a field covered both
ways is reported as declared. Rows show the split only when there is NL coverage
to distinguish, e.g. "3/3  100%  (1 declared, 2 nl)"; --json always carries both
counts and tags each covered field with its tier.

Following an @ref is resolution, not interpretation — the author wrote '@' to mark
a reference, and resolving it reads no prose. A field prose merely describes
WITHOUT an @ref is still uncovered, and an @ref that resolves to nothing counts
for nothing: use 'nl-refs' to find the former and 'lint' for the latter.

Percentages count leaf fields only: a record is structure, not data, so counting
it alongside its children would count the same data twice.

Names can be namespace-qualified (e.g. crm::orders).

JSON shape (--json):
  {
    "mappings": [{
      "mapping": str,          # canonical mapping key, e.g. "::load" or "ns::load"
      "file":    str,
      "schemas": [{
        "schema":  str,        # canonical schema key
        "role":    "source" | "target",
        "covered":          int,   # leaf fields covered by THIS mapping
        "covered_declared": int,   # of those, covered by a declared arrow
        "covered_nl":       int,   # of those, covered only by a resolved @ref
        "total":            int,   # leaf fields declared
        "pct":              int,   # covered/total, whole-number percent
        "fields":  [{"path": str, "mapped": bool, "tier": "declared" | "nl",
                     "file": str, "line": int}, ...]
      }, ...]
    }, ...]
  }

  ... plus an "aggregate" section, unioned across the mappings in scope:
    "aggregate": {
      "schemas":    [{"schema": str, "role": str, "mappings": [str, ...],
                      <counts as above>, "fields": [...]}, ...],
      "namespaces": [{"namespace": str | null,
                      "source": <counts as above>, "target": <counts as above>}, ...],
      "workspace":  {"source": {...}, "target": {...}}
    }

The two sections answer different questions and are not interchangeable. Under
"mappings", uncovered means "this mapping does not touch the field" — another
mapping may well populate it. Under "aggregate", uncovered means "no mapping in
scope touches it", which is the claim worth acting on. Deleting a field on the
strength of a per-mapping figure will delete a live one.

'fields' lists leaf fields only, matching the counts; 'tier' is present exactly
when 'mapped' is true; 'line' is 1-indexed and omitted when the declaration
position is unknown. With --uncovered, 'fields' is filtered to unmapped entries
and the counts are unchanged.

--fail-under <pct> turns spec completeness into a CI gate, the way 'fmt --check'
gates formatting. It gates the aggregate percentage for the target role by
default — the share of declared target fields some mapping populates — or the
source role with --role source, and it respects --mapping and --schema, so a
pipeline can gate one mapping or one schema rather than the whole workspace.
The figure gated is the COMBINED one, both tiers together: the gate asks "is this
spec complete", and an @ref is a declaration of intent, not a hint.

Percentages are whole numbers, and the two endpoints are reserved: 100% means
every leaf is covered and 0% means none is. Anything in between floors into
1-99%, so 200 of 201 leaves reports 99% and fails --fail-under 100 rather than
rounding up to a pass, and 1 of 201 reports 1% rather than flooring to a 0% that
reads as nothing mapped. The number printed is the number gated.

Exit codes:
  0  report produced (and the --fail-under threshold met, if given)
  1  --mapping/--schema named something that does not exist, nothing matched, or
     there is no coverage in the gated role to measure
  2  parse or filesystem error
  3  --fail-under threshold not met

An invalid flag *value* (--role banana, --fail-under 150) is a usage error: it
reports the problem with help and exits 1, as everywhere else in the CLI.

3 is distinct from 1 on purpose: 'coverage --fail-under 90 --mapping typo' can
fail because the name is misspelled or because the spec is genuinely incomplete,
and CI has to tell "fix the pipeline" from "finish the mapping".

Examples:
  satsuma coverage pipeline.stm                          # every mapping
  satsuma coverage pipeline.stm --uncovered               # the review queue
  satsuma coverage pipeline.stm --role target             # only what gets written
  satsuma coverage pipeline.stm --mapping 'load hub'      # one mapping
  satsuma coverage pipeline.stm --schema hub_customer     # one schema everywhere
  satsuma coverage pipeline.stm --json                    # machine-readable
  satsuma coverage pipeline.stm --fail-under 90            # CI gate on target coverage
  satsuma coverage pipeline.stm --fail-under 80 --role source
  satsuma coverage pipeline.stm --fail-under 95 --mapping 'load hub'`,
    )
    .action(
      runCommand(async (pathArg: string | undefined, opts: CoverageOptions) => {
        const role = (opts.role ?? null) as Role | null;
        const { files, index } = await loadWorkspace(pathArg);

        // Resolve scope arguments before doing any work, so a typo reports itself
        // as a typo (exit 1) rather than as an empty — and misleading — report.
        const mappingKey = opts.mapping
          ? resolveScopeName(opts.mapping, "Mapping", index.mappings)
          : null;
        const schemaKey = opts.schema
          ? resolveScopeName(opts.schema, "Schema", index.schemas)
          : null;

        // Resolved once for the whole workspace and reused for every mapping —
        // resolution is workspace-wide, and it is what makes the NL tier possible
        // at all (ADR-036).
        const nlRefs = resolveAllNLRefs(index);
        const { mappings, skippedAnonymous } = coverageForWorkspace(index, files, nlRefs);
        const scoped = applyScope(mappings, { mappingKey, schemaKey, role });

        if (scoped.length === 0) {
          console.log(describeEmptyScope(mappings.length, { mappingKey, schemaKey, role }));
          return EXIT_NOT_FOUND;
        }

        // Aggregate over the *scoped* mappings, so `--schema X` reports X's
        // workspace-wide coverage rather than the whole workspace's.
        const aggregate = aggregateCoverage(scoped);
        const gate = evaluateGate(aggregate, role, opts.failUnder);

        if (opts.json) {
          const report: Record<string, unknown> = {
            mappings: scoped.map((m) => toJson(m, opts)),
            aggregate: aggregateToJson(aggregate, opts),
          };
          if (gate) report.gate = gate;
          console.log(JSON.stringify(report, null, 2));
        } else {
          printPerMappingReport(scoped, opts);
          printAggregateReport(aggregate, opts);
          if (gate) printGate(gate);
          if (skippedAnonymous > 0) printAnonymousNote(skippedAnonymous);
        }

        // The report is printed either way — a failed gate must still show the
        // reviewer which fields are missing, not just that a number was too low.
        return gate && !gate.met ? EXIT_THRESHOLD_NOT_MET : undefined;
      }),
    );
}

// ── Scope resolution ────────────────────────────────────────────────────────

/**
 * Resolve a `--mapping` / `--schema` argument to an index key, or fail with
 * EXIT_NOT_FOUND.
 *
 * This is the established CLI meaning of exit 1 and must stay distinct from the
 * coverage-threshold code that `--fail-under` adds (sl-268g): CI has to be able
 * to tell "the spec is incomplete" from "the build invocation is broken".
 */
function resolveScopeName<T>(name: string, kind: string, entities: Map<string, T>): string {
  const resolved = resolveIndexKey(name, entities);
  if (resolved) return resolved.key;
  const close = [...entities.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
  const lines = [`${kind} '${name}' not found.`];
  if (close) lines.push(`Did you mean '${close}'?`);
  throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
}

/** Active scope filters, all optional and combinable. */
interface Scope {
  mappingKey: string | null;
  schemaKey: string | null;
  role: Role | null;
}

/**
 * Narrow a workspace's coverage to the active scope.
 *
 * Filters compose: `--schema X --role target` keeps only X's target-side entry,
 * in only the mappings that write to it. A mapping left with no schemas is
 * dropped rather than printed empty.
 */
function applyScope(mappings: MappingCoverage[], scope: Scope): MappingCoverage[] {
  const result: MappingCoverage[] = [];
  for (const mapping of mappings) {
    if (scope.mappingKey && mapping.mappingId !== scope.mappingKey) continue;
    const schemas = mapping.result.schemas.filter(
      (s) =>
        (!scope.schemaKey || s.schemaId === scope.schemaKey) &&
        (!scope.role || s.role === scope.role),
    );
    if (schemas.length === 0) continue;
    result.push({ ...mapping, result: { schemas } });
  }
  return result;
}

/**
 * Explain an empty result in terms of the scope that produced it.
 *
 * "No results" is ambiguous when several filters are active — the user needs to
 * know which combination excluded everything, because the individual names
 * resolved fine (an unresolvable one would already have exited 1).
 */
function describeEmptyScope(totalMappings: number, scope: Scope): string {
  if (totalMappings === 0) return "No named mappings found in this workspace.";
  const filters: string[] = [];
  if (scope.mappingKey) filters.push(`mapping '${displayKey(scope.mappingKey)}'`);
  if (scope.schemaKey) filters.push(`schema '${displayKey(scope.schemaKey)}'`);
  if (scope.role) filters.push(`role '${scope.role}'`);
  return filters.length > 0
    ? `No coverage matches ${filters.join(" + ")}.`
    : "No coverage to report.";
}

// ── Field selection ─────────────────────────────────────────────────────────

/**
 * The field entries a report shows for one schema.
 *
 * Always leaves only, so the listed fields and the `covered/total` counts beside
 * them are the same population — a list of three paths under a count of two
 * would be a report that contradicts itself. `--uncovered` narrows further to
 * the unmapped ones without touching the counts, which stay the denominator the
 * reviewer needs.
 */
function reportedFields(schema: SchemaCoverageResult, opts: CoverageOptions): FieldCoverageEntry[] {
  const leaves = leafFieldEntries(schema.fields);
  return opts.uncovered ? leaves.filter((f) => !f.mapped) : leaves;
}

// ── JSON output ─────────────────────────────────────────────────────────────

/**
 * One mapping's coverage as JSON, per the shape documented in the command help
 * and SATSUMA-CLI.md. Treated as a stable contract — feature 36's viz overlay
 * renders from it.
 */
function toJson(mapping: MappingCoverage, opts: CoverageOptions): Record<string, unknown> {
  return {
    mapping: canonicalKey(mapping.mappingId),
    file: mapping.file,
    schemas: mapping.result.schemas.map((schema) => ({
      schema: canonicalKey(schema.schemaId),
      role: schema.role,
      ...totalsToJson(summarizeFieldCoverage(schema.fields)),
      fields: reportedFields(schema, opts).map(fieldToJson),
    })),
  };
}

/**
 * Coverage counts as JSON, in the snake_case the contract uses.
 *
 * The single serialiser for {@link CoverageTotals} everywhere it appears — a
 * per-mapping schema, an aggregate schema, a namespace subtotal and the workspace
 * total — so the tier keys cannot be present in one section and absent from
 * another. Core's field names are camelCase; the published contract is
 * snake_case, and this is the one place that translation happens.
 */
function totalsToJson(totals: CoverageTotals): Record<string, number> {
  return {
    covered: totals.covered,
    covered_declared: totals.coveredDeclared,
    covered_nl: totals.coveredNl,
    total: totals.total,
    pct: totals.pct,
  };
}

/**
 * A field entry as JSON. `line` is converted to 1-indexed to match human output
 * and every other command's JSON (cbh-7rvo), and omitted rather than defaulted
 * when the declaration position is unknown.
 */
function fieldToJson(field: FieldCoverageEntry): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    path: field.path,
    mapped: field.mapped,
    file: field.uri,
  };
  // Present exactly when `mapped` is true — an uncovered field has no tier to
  // report. Emitted so a consumer differentiates declared from NL-derived
  // coverage from this contract rather than reconstructing it (ADR-036).
  if (field.tier !== undefined) entry.tier = field.tier;
  if (field.line !== undefined) entry.line = field.line + 1;
  return entry;
}

// ── Human output ────────────────────────────────────────────────────────────

/** Column widths chosen so a two-role table stays narrow enough to paste. */
const ROLE_COLUMN_WIDTH = 6; // "source" — the longer of the two role words
/** Uncovered paths are wrapped rather than printed one per line, to stay compact. */
const UNCOVERED_LINE_BUDGET = 72;
/** Label for the total row, padded to the same width as the namespace rows. */
const WORKSPACE_LABEL = "workspace";

/**
 * Print the per-mapping report: one block per mapping, a row per participating
 * schema, then the field paths themselves.
 *
 * Every figure here is scoped to its own mapping. "Uncovered by this mapping"
 * is a weaker claim than "uncovered by every mapping" — a field another mapping
 * populates appears here as a gap — so the heading says so explicitly rather
 * than leaving a reviewer to infer it.
 */
function printPerMappingReport(mappings: MappingCoverage[], opts: CoverageOptions): void {
  console.log(
    `Coverage — ${mappings.length} mapping${mappings.length !== 1 ? "s" : ""}, per mapping`,
  );

  for (const mapping of mappings) {
    console.log();
    console.log(`mapping ${displayKey(mapping.mappingId)}  (${mapping.file})`);

    const schemaWidth = Math.max(
      ...mapping.result.schemas.map((s) => displayKey(s.schemaId).length),
    );
    for (const schema of mapping.result.schemas) {
      console.log(
        `  ${schema.role.padEnd(ROLE_COLUMN_WIDTH)}  ${displayKey(schema.schemaId).padEnd(schemaWidth)}  ` +
          `${formatTotals(summarizeFieldCoverage(schema.fields))}`,
      );
    }

    for (const schema of mapping.result.schemas) {
      printFieldList(schema, opts);
    }
  }
}

/**
 * List the fields for one schema beneath its table row.
 *
 * In the default view an uncovered field is what the reviewer is looking for, so
 * only those are named — the covered ones are already summarised by the count.
 * `--uncovered` uses the same list; the flag's effect is to suppress schemas
 * that have no gaps at all, not to change what is named.
 */
function printFieldList(schema: SchemaCoverageResult, opts: CoverageOptions): void {
  const uncovered = reportedFields(schema, opts).filter((f) => !f.mapped);
  if (uncovered.length === 0) return;

  console.log(
    `    uncovered in ${displayKey(schema.schemaId)} (${schema.role}): ` +
      `${uncovered.length} field${uncovered.length !== 1 ? "s" : ""}`,
  );
  for (const line of wrapPaths(uncovered.map((f) => f.path))) {
    console.log(`      ${line}`);
  }
}

/** Pack comma-separated paths into lines within {@link UNCOVERED_LINE_BUDGET}. */
function wrapPaths(paths: string[]): string[] {
  const lines: string[] = [];
  let current = "";
  for (const path of paths) {
    const candidate = current ? `${current}, ${path}` : path;
    if (candidate.length > UNCOVERED_LINE_BUDGET && current) {
      lines.push(`${current},`);
      current = path;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ── CI gate ─────────────────────────────────────────────────────────────────

/** The role `--fail-under` gates when `--role` does not say otherwise. */
const DEFAULT_GATED_ROLE: Role = "target";

/** Outcome of a `--fail-under` check, reported in output and as an exit code. */
interface CoverageGate {
  /** Which role's aggregate percentage was measured. */
  role: Role;
  /** The threshold the caller asked for, as a whole percentage. */
  threshold: number;
  /** The measured aggregate percentage for `role`, over the active scope. */
  pct: number;
  /** Whether `pct` reached `threshold`. False is exit 3. */
  met: boolean;
}

/**
 * Evaluate `--fail-under`, or return null when no gate was requested.
 *
 * Gates target coverage by default: "how much of what we are meant to produce do
 * we actually produce?" is the completeness question a sign-off turns on.
 * `--role source` gates consumption instead, for pipelines that care whether an
 * upstream feed is being fully read.
 *
 * The measured figure is the *aggregate* over the active scope, never a
 * per-mapping one — a workspace where each mapping covers a different third of a
 * schema is fully specified, and gating any single mapping would fail it.
 *
 * Throws EXIT_NOT_FOUND when the gated role has no leaves in scope. That is not
 * 0% coverage, it is nothing to measure: `--schema customers --fail-under 90`
 * where `customers` is only ever a source would otherwise report a spec failure
 * caused entirely by the invocation.
 *
 * Compares `totals.pct` rather than re-deriving a ratio, deliberately: core's
 * `coveragePercentage` reserves 100 for a complete spec and floors everything
 * below it, so the figure a reviewer reads is the figure gated. Gating a
 * separately-computed ratio is how the two came apart in `sl-8ba4`.
 */
function evaluateGate(
  aggregate: AggregateCoverage,
  role: Role | null,
  threshold: number | undefined,
): CoverageGate | null {
  if (threshold === undefined) return null;

  const gatedRole = role ?? DEFAULT_GATED_ROLE;
  const totals = aggregate.workspace[gatedRole];
  if (totals.total === 0) {
    throw new CommandError(
      `No ${gatedRole}-role coverage in scope to gate with --fail-under.\n` +
        `Nothing in scope declares ${gatedRole} fields; ` +
        `use --role ${gatedRole === "target" ? "source" : "target"} or widen the scope.`,
      EXIT_NOT_FOUND,
    );
  }

  return { role: gatedRole, threshold, pct: totals.pct, met: totals.pct >= threshold };
}

/**
 * Print the gate verdict.
 *
 * Named as a threshold check rather than as coverage, so a reader scanning CI
 * logs sees which number was compared against what, and does not mistake the
 * gated aggregate for one of the per-mapping percentages above it.
 */
function printGate(gate: CoverageGate): void {
  console.log();
  console.log(
    `--fail-under: ${gate.role} coverage ${gate.pct}% vs threshold ${gate.threshold}% — ` +
      `${gate.met ? "met" : "NOT met"}`,
  );
}

// ── Aggregate output ────────────────────────────────────────────────────────

/**
 * The aggregate section as JSON: every schema in scope counted once, plus
 * namespace and workspace subtotals.
 *
 * Deliberately a sibling of `mappings` rather than merged into it. A consumer
 * reading `aggregate.schemas[].fields[].mapped === false` is being told nothing
 * in scope covers the field; the same key under `mappings` means only that one
 * mapping does not. Keeping them in separate objects means a consumer has to
 * choose which claim it is making.
 */
function aggregateToJson(
  aggregate: AggregateCoverage,
  opts: CoverageOptions,
): Record<string, unknown> {
  return {
    schemas: aggregate.schemas.map((schema) => ({
      schema: canonicalKey(schema.schemaId),
      role: schema.role,
      mappings: schema.mappings.map(canonicalKey),
      ...totalsToJson(schema.totals),
      fields: aggregateFields(schema, opts).map(fieldToJson),
    })),
    namespaces: aggregate.namespaces.map((ns) => ({
      namespace: ns.namespace,
      source: totalsToJson(ns.source),
      target: totalsToJson(ns.target),
    })),
    workspace: {
      source: totalsToJson(aggregate.workspace.source),
      target: totalsToJson(aggregate.workspace.target),
    },
  };
}

/**
 * The aggregate field entries to report, filtered exactly as the per-mapping
 * ones are so the two sections stay comparable line for line.
 */
function aggregateFields(
  schema: AggregateSchemaCoverage,
  opts: CoverageOptions,
): FieldCoverageEntry[] {
  const leaves = leafFieldEntries(schema.fields);
  return opts.uncovered ? leaves.filter((f) => !f.mapped) : leaves;
}

/**
 * Print the aggregate section.
 *
 * The heading states the claim in words rather than trusting the section title:
 * a reviewer skimming for "uncovered" needs to know, at the point of reading it,
 * that these gaps are the ones no mapping fills — the per-mapping list above
 * contains fields another mapping populates.
 */
function printAggregateReport(aggregate: AggregateCoverage, opts: CoverageOptions): void {
  console.log();
  console.log("Aggregate — a field is uncovered here only when NO mapping in scope covers it");

  const schemaWidth = Math.max(...aggregate.schemas.map((s) => displayKey(s.schemaId).length));
  for (const schema of aggregate.schemas) {
    console.log(
      `  ${schema.role.padEnd(ROLE_COLUMN_WIDTH)}  ${displayKey(schema.schemaId).padEnd(schemaWidth)}  ` +
        `${formatTotals(schema.totals)}`,
    );
  }

  for (const schema of aggregate.schemas) {
    const uncovered = aggregateFields(schema, opts).filter((f) => !f.mapped);
    if (uncovered.length === 0) continue;
    console.log(
      `    covered by no mapping — ${displayKey(schema.schemaId)} (${schema.role}): ` +
        `${uncovered.length} field${uncovered.length !== 1 ? "s" : ""}`,
    );
    for (const line of wrapPaths(uncovered.map((f) => f.path))) {
      console.log(`      ${line}`);
    }
  }

  printSubtotals(aggregate);
}

/**
 * Print namespace subtotals and the workspace total.
 *
 * The single-namespace case is suppressed: when every schema is at file scope
 * (or in one namespace) the subtotal row is identical to the workspace row, and
 * printing both invites the reader to look for a difference that cannot exist.
 */
function printSubtotals(aggregate: AggregateCoverage): void {
  const showNamespaces = aggregate.namespaces.length > 1;
  // One label width across namespace rows and the workspace row, so the
  // percentages line up into a column the eye can scan down.
  const labels = showNamespaces
    ? aggregate.namespaces.map((ns) => namespaceLabel(ns.namespace))
    : [];
  const labelWidth = Math.max(...labels.map((l) => l.length), WORKSPACE_LABEL.length);

  console.log();
  if (showNamespaces) {
    for (const ns of aggregate.namespaces) {
      console.log(`  ${namespaceLabel(ns.namespace).padEnd(labelWidth)}  ${formatRoleTotals(ns)}`);
    }
  }
  console.log(`  ${WORKSPACE_LABEL.padEnd(labelWidth)}  ${formatRoleTotals(aggregate.workspace)}`);
}

/** Display name for a namespace subtotal row; file scope has no name of its own. */
function namespaceLabel(namespace: string | null): string {
  return namespace === null ? "(file scope)" : namespace;
}

/** "3/4  75%" — the shared counts-and-percentage cell. */
function formatTotals(totals: CoverageTotals): string {
  return (
    `${`${totals.covered}/${totals.total}`.padStart(7)}  ${String(totals.pct).padStart(3)}%` +
    formatTierSplit(totals)
  );
}

/**
 * "  (1 declared, 2 nl)" — the tier annotation, or "" when there is nothing to
 * distinguish (ADR-036).
 *
 * Printed only when the row actually has NL-tier coverage. A structural-only
 * spec has nothing to tell apart, and annotating every row of every report with
 * "(n declared, 0 nl)" would add a column of noise to the common case; the split
 * appears exactly where a reviewer needs to know that some coverage is inferred
 * from prose rather than declared. `--json` always carries both counts.
 */
function formatTierSplit(totals: CoverageTotals): string {
  if (totals.coveredNl === 0) return "";
  return `  (${totals.coveredDeclared} declared, ${totals.coveredNl} nl)`;
}

/**
 * "source 3/4  75%   target 3/3  100%" — the subtotal row's role cells.
 *
 * A role with no declared leaves in scope is omitted rather than shown as
 * "0/0 0%", which reads as zero coverage. Under `--role source` the target side
 * is structurally absent, and printing it as a failing figure would be a lie
 * about the workspace.
 */
function formatRoleTotals(totals: RoleTotals): string {
  const cells: string[] = [];
  if (totals.source.total > 0) cells.push(`source ${formatTotals(totals.source)}`);
  if (totals.target.total > 0) cells.push(`target ${formatTotals(totals.target)}`);
  return cells.join("   ");
}

/**
 * Report anonymous mappings the pass could not cover.
 *
 * Silently omitting them would let the report read as complete when it is not —
 * the reader must be able to see that part of the workspace was skipped, and
 * why.
 */
function printAnonymousNote(count: number): void {
  console.log();
  console.log(
    `Note: ${count} anonymous mapping${count !== 1 ? "s" : ""} not reported ` +
      `(coverage is looked up by mapping name; name the mapping to include it).`,
  );
}

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
 *   --json             structured JSON output
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND, EXIT_PARSE_ERROR } from "../command-runner.js";
import { canonicalKey, resolveIndexKey } from "../index-builder.js";
import { coverageForWorkspace } from "../coverage-workspace.js";
import type { MappingCoverage } from "../coverage-workspace.js";
import { summarizeFieldCoverage, leafFieldEntries } from "@satsuma/core";
import type { FieldCoverageEntry, SchemaCoverageResult } from "@satsuma/core";

/** Roles a schema can play in a mapping; the accepted values of `--role`. */
const ROLES = ["source", "target"] as const;
type Role = (typeof ROLES)[number];

/** Scoping and presentation options, after Commander has parsed them. */
interface CoverageOptions {
  mapping?: string;
  schema?: string;
  role?: string;
  uncovered?: boolean;
  json?: boolean;
}

export function register(program: Command): void {
  program
    .command("coverage [path]")
    .description("Report which declared fields each mapping covers, and which nothing maps")
    .option("--mapping <name>", "only this mapping")
    .option("--schema <name>", "only this schema, across every mapping that uses it")
    .option("--role <role>", "only 'source' or 'target' schemas")
    .option("--uncovered", "list only the fields nothing maps")
    .option("--json", "structured JSON output")
    .addHelpText("after", `
Coverage is structural: a field counts as covered when at least one arrow in the
mapping references it. Nested paths cover their parents — mapping 'address.city'
covers 'address' but not 'address.line1'. A field described only in prose (a note
block) is uncovered by definition; use 'nl-refs' to find those.

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
        "covered": int,        # leaf fields covered by THIS mapping
        "total":   int,        # leaf fields declared
        "pct":     int,        # covered/total, whole-number percent
        "fields":  [{"path": str, "mapped": bool, "file": str, "line": int}, ...]
      }, ...]
    }, ...]
  }

'fields' lists leaf fields only, matching the counts; 'line' is 1-indexed and
omitted when the declaration position is unknown. With --uncovered, 'fields' is
filtered to unmapped entries and the counts are unchanged.

Exit codes:
  0  report produced
  1  --mapping/--schema named something that does not exist, or nothing matched
  2  parse or filesystem error

Examples:
  satsuma coverage pipeline.stm                          # every mapping
  satsuma coverage pipeline.stm --uncovered               # the review queue
  satsuma coverage pipeline.stm --role target             # only what gets written
  satsuma coverage pipeline.stm --mapping 'load hub'      # one mapping
  satsuma coverage pipeline.stm --schema hub_customer     # one schema everywhere
  satsuma coverage pipeline.stm --json                    # machine-readable`)
    .action(runCommand(async (pathArg: string | undefined, opts: CoverageOptions) => {
      const role = parseRole(opts.role);
      const { files, index } = await loadWorkspace(pathArg);

      // Resolve scope arguments before doing any work, so a typo reports itself
      // as a typo (exit 1) rather than as an empty — and misleading — report.
      const mappingKey = opts.mapping ? resolveScopeName(opts.mapping, "Mapping", index.mappings) : null;
      const schemaKey = opts.schema ? resolveScopeName(opts.schema, "Schema", index.schemas) : null;

      const { mappings, skippedAnonymous } = coverageForWorkspace(index, files);
      const scoped = applyScope(mappings, { mappingKey, schemaKey, role });

      if (scoped.length === 0) {
        console.log(describeEmptyScope(mappings.length, { mappingKey, schemaKey, role }));
        return EXIT_NOT_FOUND;
      }

      if (opts.json) {
        console.log(JSON.stringify({ mappings: scoped.map((m) => toJson(m, opts)) }, null, 2));
        return;
      }

      printPerMappingReport(scoped, opts);
      if (skippedAnonymous > 0) printAnonymousNote(skippedAnonymous);
    }));
}

// ── Scope resolution ────────────────────────────────────────────────────────

/**
 * Validate `--role`, which is a closed set rather than free text: silently
 * ignoring `--role sources` would report both roles and look like a bug in the
 * coverage numbers rather than in the invocation.
 */
function parseRole(raw: string | undefined): Role | null {
  if (raw === undefined) return null;
  if ((ROLES as readonly string[]).includes(raw)) return raw as Role;
  throw new CommandError(
    `Invalid --role '${raw}'. Expected one of: ${ROLES.join(", ")}.`,
    EXIT_PARSE_ERROR,
  );
}

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
      (s) => (!scope.schemaKey || s.schemaId === scope.schemaKey) && (!scope.role || s.role === scope.role),
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
  if (scope.mappingKey) filters.push(`mapping '${canonicalKey(scope.mappingKey)}'`);
  if (scope.schemaKey) filters.push(`schema '${canonicalKey(scope.schemaKey)}'`);
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
    schemas: mapping.result.schemas.map((schema) => {
      const totals = summarizeFieldCoverage(schema.fields);
      return {
        schema: canonicalKey(schema.schemaId),
        role: schema.role,
        covered: totals.covered,
        total: totals.total,
        pct: totals.pct,
        fields: reportedFields(schema, opts).map(fieldToJson),
      };
    }),
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
  if (field.line !== undefined) entry.line = field.line + 1;
  return entry;
}

// ── Human output ────────────────────────────────────────────────────────────

/** Column widths chosen so a two-role table stays narrow enough to paste. */
const ROLE_COLUMN_WIDTH = 6; // "source" — the longer of the two role words
/** Uncovered paths are wrapped rather than printed one per line, to stay compact. */
const UNCOVERED_LINE_BUDGET = 72;

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
  console.log(`Coverage — ${mappings.length} mapping${mappings.length !== 1 ? "s" : ""}, per mapping`);

  for (const mapping of mappings) {
    console.log();
    console.log(`mapping ${canonicalKey(mapping.mappingId)}  (${mapping.file})`);

    const schemaWidth = Math.max(
      ...mapping.result.schemas.map((s) => canonicalKey(s.schemaId).length),
    );
    for (const schema of mapping.result.schemas) {
      const totals = summarizeFieldCoverage(schema.fields);
      const counts = `${totals.covered}/${totals.total}`;
      console.log(
        `  ${schema.role.padEnd(ROLE_COLUMN_WIDTH)}  ${canonicalKey(schema.schemaId).padEnd(schemaWidth)}  ` +
        `${counts.padStart(7)}  ${String(totals.pct).padStart(3)}%`,
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
    `    uncovered in ${canonicalKey(schema.schemaId)} (${schema.role}): ` +
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

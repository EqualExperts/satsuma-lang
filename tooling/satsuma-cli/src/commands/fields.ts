/**
 * fields.js — `satsuma fields <schema>` command
 *
 * Lists all fields in a schema with types. Key feature: --unmapped-by <mapping>
 * computes the set-difference between declared fields and arrow target paths.
 *
 * Flags:
 *   --with-meta         include metadata tags inline
 *   --unmapped-by <m>   only fields with no arrows in mapping <m>
 *   --json              structured JSON output
 */

import type { Command } from "commander";
import { assertNever, classifyFieldDecl } from "@satsuma/core";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey } from "../index-builder.js";
import { expandEntityFields, expandNestedSpreads } from "../spread-expand.js";
import { coverageForMapping, coveredFieldPaths } from "../coverage-workspace.js";
import { resolveAllNLRefs } from "../nl-ref-extract.js";
import type {
  FieldDecl,
  ParsedFile,
  SchemaRecord,
  FragmentRecord,
  MetricRecord,
} from "../types.js";

type FieldWithTags = FieldDecl & {
  tags?: string[];
};

export function register(program: Command): void {
  program
    .command("fields <name> [path]")
    .description("List fields in a schema, fragment, or metric")
    .option("--with-meta", "include metadata tags")
    .option("--unmapped-by <mapping>", "only unmapped fields relative to a mapping")
    .option("--json", "structured JSON output")
    .addHelpText(
      "after",
      `
Looks up <name> in schemas first, then fragments, then metrics.
Names can be namespace-qualified (e.g. pos::stores).

JSON shape (--json): array of field objects
  [{"name": str, "type": str | null}, ...]
  With --unmapped-by: same shape, filtered to fields with no arrows in the named mapping.

Examples:
  satsuma fields hub_customer                                    # list all fields
  satsuma fields hub_customer --with-meta                        # include tags
  satsuma fields hub_customer --unmapped-by 'load hub_customer'  # coverage gaps
  satsuma fields pos::stores --json                              # namespace-qualified`,
    )
    .action(
      runCommand(
        async (
          schemaName: string,
          pathArg: string | undefined,
          opts: { withMeta?: boolean; unmappedBy?: string; json?: boolean },
        ) => {
          const { files: parsedFiles, index } = await loadWorkspace(pathArg);

          // Search schemas first, then fragments, then metrics
          type ResolvedEntity = {
            key: string;
            entry: SchemaRecord | FragmentRecord | MetricRecord;
          };
          let resolved: ResolvedEntity | null = resolveIndexKey(schemaName, index.schemas);
          let entityKind = "schema";
          if (!resolved) {
            resolved = resolveIndexKey(schemaName, index.fragments);
            entityKind = "fragment";
          }
          if (!resolved) {
            resolved = resolveIndexKey(schemaName, index.metrics);
            entityKind = "metric";
          }
          if (!resolved) {
            const allKeys = [
              ...index.schemas.keys(),
              ...index.fragments.keys(),
              ...index.metrics.keys(),
            ];
            const close = allKeys.find((k) => k.toLowerCase() === schemaName.toLowerCase());
            const lines = [`'${schemaName}' not found in schemas, fragments, or metrics.`];
            if (close) lines.push(`Did you mean '${close}'?`);
            throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
          }
          const resolvedSchemaName = resolved.key;

          const entity = resolved.entry;
          let fields: FieldWithTags[] = deepCopyFields(entity.fields);

          // Expand fragment spreads — inline fields from spread fragments (schemas and fragments only)
          if (entityKind !== "metric") {
            // Expand nested record-level spreads in place first
            expandNestedSpreads(fields, entity.namespace ?? null, index);
            // Then expand schema-level spreads
            const spreadFields = expandEntityFields(
              entity as SchemaRecord | FragmentRecord,
              entity.namespace ?? null,
              index,
            );
            fields = [...fields, ...spreadFields];
          }

          // Enrich with metadata if requested
          if (opts.withMeta) {
            enrichFieldMeta(entity.name, fields, parsedFiles);
          }

          // Filter to unmapped fields
          if (opts.unmappedBy) {
            const resolvedMapping = resolveIndexKey(opts.unmappedBy, index.mappings);
            if (!resolvedMapping) {
              const close = [...index.mappings.keys()].find(
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: guarded by outer opts.unmappedBy check
                (k) => k.toLowerCase() === opts.unmappedBy!.toLowerCase(),
              );
              const lines = [`Mapping '${opts.unmappedBy}' not found.`];
              if (close) lines.push(`Did you mean '${close}'?`);
              throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
            }

            // Resolved @refs count toward coverage (ADR-036), and this command must
            // give the same answer as `satsuma coverage` — the lock sl-oqsj put in
            // place — so it feeds core the same refs.
            const coverage = coverageForMapping(
              resolvedMapping.key,
              index,
              parsedFiles,
              resolveAllNLRefs(index),
            );
            // No coverage result means the mapping does not reference this entity at
            // all (or is anonymous, which --unmapped-by cannot name) — every field is
            // then unmapped by it, which is what an empty covered set produces.
            const covered = coverage
              ? coveredFieldPaths(coverage, resolvedSchemaName)
              : new Set<string>();
            fields = filterUnmappedFields(fields, covered, "");
          }

          if (opts.json) {
            console.log(JSON.stringify(fields, null, 2));
            return;
          }

          if (fields.length === 0) {
            // Use resolvedSchemaName (the canonical index key) so bare-name queries
            // still produce the qualified name in output (e.g. "crm::customers" not
            // "customers") — see sl-wfgx.
            if (opts.unmappedBy) {
              console.log(
                `All fields in '${resolvedSchemaName}' are mapped by '${opts.unmappedBy}'.`,
              );
            } else {
              console.log(
                `${entityKind.charAt(0).toUpperCase() + entityKind.slice(1)} '${resolvedSchemaName}' has no fields.`,
              );
            }
            return;
          }

          printDefault(resolvedSchemaName, fields, opts);
        },
      ),
    );
}

function deepCopyFields(fields: FieldDecl[]): FieldWithTags[] {
  return fields.map((field) =>
    field.children ? { ...field, children: deepCopyFields(field.children) } : { ...field },
  );
}

/**
 * Prune a field tree to only the fields the mapping leaves unmapped.
 *
 * `covered` holds the schema-root-relative paths the mapping touches, taken
 * straight from the shared coverage computation — this command derives no
 * coverage of its own, so `fields --unmapped-by X` and
 * `coverage --uncovered --mapping X --schema Y` cannot disagree (sl-oqsj).
 *
 * A record is kept only when it still has unmapped children, and is never
 * judged on its own path: a record's path is registered merely by being an
 * ancestor of a covered child, so treating it as covered would hide its
 * remaining gaps.
 */
function filterUnmappedFields(
  fields: FieldWithTags[],
  covered: Set<string>,
  prefix: string,
): FieldWithTags[] {
  const result: FieldWithTags[] = [];
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    if (f.children && f.children.length > 0) {
      const unmappedChildren = filterUnmappedFields(f.children, covered, path);
      if (unmappedChildren.length > 0) {
        result.push({ ...f, children: unmappedChildren });
      }
    } else if (!covered.has(path)) {
      result.push(f);
    }
  }
  return result;
}

/**
 * Enrich field objects with metadata tags from the FieldDecl metadata array.
 * Recurses into children for record/list blocks.
 */
function enrichFieldMeta(
  _schemaName: string,
  fields: FieldWithTags[],
  _parsedFiles: ParsedFile[],
): void {
  function enrich(fieldList: FieldWithTags[]): void {
    for (const field of fieldList) {
      if (field.metadata && field.metadata.length > 0) {
        const tags: string[] = [];
        for (const m of field.metadata) {
          if (m.kind === "tag") tags.push(m.tag);
          else if (m.kind === "kv") tags.push(`${m.key} ${m.value}`);
          else if (m.kind === "enum") tags.push(`enum {${m.values.join(", ")}}`);
          else if (m.kind === "note") tags.push(`note "${m.text}"`);
          else if (m.kind === "slice") tags.push(`slice {${m.values.join(", ")}}`);
        }
        if (tags.length > 0) field.tags = tags;
      }
      if (field.children) enrich(field.children);
    }
  }
  enrich(fields);
}

function printDefault(
  _schemaName: string,
  fields: FieldWithTags[],
  opts: { withMeta?: boolean },
): void {
  printFieldTree(fields, opts, 1);
}

function printFieldTree(
  fields: FieldWithTags[],
  opts: { withMeta?: boolean },
  indent: number,
): void {
  const maxName = Math.max(...fields.map((f) => f.name.length), 4);
  const displayType = (f: FieldWithTags): string => {
    const classified = classifyFieldDecl(f);
    switch (classified.kind) {
      case "scalar":
      case "record":
        return classified.field.type;
      case "scalar-list":
        return classified.field.type ? `list_of ${classified.field.type}` : "list_of";
      case "record-list":
        return "list_of record";
      default:
        return assertNever(classified, "Unhandled FieldDecl variant");
    }
  };
  const maxType = Math.max(...fields.map((f) => displayType(f).length), 4);
  const pad = "  ".repeat(indent);

  for (const f of fields) {
    let line = `${pad}${f.name.padEnd(maxName)}  ${displayType(f).padEnd(maxType)}`;
    if (opts.withMeta && f.tags) {
      line += `  (${f.tags.join(", ")})`;
    }
    console.log(line);
    if (f.children && f.children.length > 0) {
      printFieldTree(f.children, opts, indent + 1);
    }
  }
}

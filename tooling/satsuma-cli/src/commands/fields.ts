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
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey } from "../index-builder.js";
import { expandEntityFields, expandNestedSpreads } from "../spread-expand.js";
import { addPathAndPrefixes } from "@satsuma/core";
import type { ExtractedWorkspace, FieldDecl, ParsedFile, SchemaRecord, FragmentRecord, MetricRecord } from "../types.js";

interface FieldWithTags extends FieldDecl {
  tags?: string[];
}

export function register(program: Command): void {
  program
    .command("fields <name> [path]")
    .description("List fields in a schema, fragment, or metric")
    .option("--with-meta", "include metadata tags")
    .option("--unmapped-by <mapping>", "only unmapped fields relative to a mapping")
    .option("--json", "structured JSON output")
    .addHelpText("after", `
Looks up <name> in schemas first, then fragments, then metrics.
Names can be namespace-qualified (e.g. pos::stores).

JSON shape (--json): array of field objects
  [{"name": str, "type": str | null}, ...]
  With --unmapped-by: same shape, filtered to fields with no arrows in the named mapping.

Examples:
  satsuma fields hub_customer                                    # list all fields
  satsuma fields hub_customer --with-meta                        # include tags
  satsuma fields hub_customer --unmapped-by 'load hub_customer'  # coverage gaps
  satsuma fields pos::stores --json                              # namespace-qualified`)
    .action(runCommand(async (schemaName: string, pathArg: string | undefined, opts: { withMeta?: boolean; unmappedBy?: string; json?: boolean }) => {
      const { files: parsedFiles, index } = await loadWorkspace(pathArg);

      // Search schemas first, then fragments, then metrics
      type ResolvedEntity = { key: string; entry: SchemaRecord | FragmentRecord | MetricRecord };
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
        const allKeys = [...index.schemas.keys(), ...index.fragments.keys(), ...index.metrics.keys()];
        const close = allKeys.find(
          (k) => k.toLowerCase() === schemaName.toLowerCase(),
        );
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
        const spreadFields = expandEntityFields(entity as SchemaRecord | FragmentRecord, entity.namespace ?? null, index);
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

        const mappedFields = getMappedFieldNames(resolvedMapping.key, resolvedSchemaName, index);
        fields = filterUnmappedFields(fields, mappedFields, "");
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
          console.log(`${entityKind.charAt(0).toUpperCase() + entityKind.slice(1)} '${resolvedSchemaName}' has no fields.`);
        }
        return;
      }

      printDefault(resolvedSchemaName, fields, opts);
    }));
}

function deepCopyFields(fields: FieldDecl[]): FieldWithTags[] {
  return fields.map((f) => {
    const copy: FieldWithTags = { ...f };
    if (f.children) copy.children = deepCopyFields(f.children);
    return copy;
  });
}

/**
 * Get the set of field names from the given schema that participate in arrows
 * for the specified mapping — checking both source and target sides.
 */
function getMappedFieldNames(mappingName: string, schemaName: string, index: ExtractedWorkspace): Set<string> {
  const mapped = new Set<string>();
  const mapping = index.mappings.get(mappingName);
  if (!mapping) return mapped;

  const isSource = mapping.sources.includes(schemaName);
  const isTarget = mapping.targets.includes(schemaName);

  // Arrow records use bare mapping names; qualified key uses "ns::name"
  const nsIdx = mappingName.indexOf("::");
  const bareMappingName = nsIdx !== -1 ? mappingName.slice(nsIdx + 2) : mappingName;

  for (const [_key, arrows] of index.fieldArrows) {
    for (const arrow of arrows) {
      // Match arrow by bare mapping name and namespace
      const arrowQualified = arrow.namespace ? `${arrow.namespace}::${arrow.mapping}` : arrow.mapping;
      if (arrowQualified !== mappingName && arrow.mapping !== bareMappingName) continue;
      if (isSource) {
        for (const source of arrow.sources) {
          // addPathAndPrefixes strips [] and registers all ancestor prefixes —
          // matches the same logic used by the VS Code coverage gutter.
          addPathAndPrefixes(mapped, source);
        }
      }
      if (isTarget && arrow.target) {
        addPathAndPrefixes(mapped, arrow.target);
      }
    }
  }
  return mapped;
}

/**
 * Filter fields to only unmapped ones, recursing into record/list children.
 * A record/list is excluded entirely if all children are mapped; if some
 * children are mapped, the record is kept with only unmapped children.
 */
function filterUnmappedFields(fields: FieldWithTags[], mapped: Set<string>, prefix: string): FieldWithTags[] {
  const result: FieldWithTags[] = [];
  for (const f of fields) {
    const path = prefix ? `${prefix}.${f.name}` : f.name;
    if (f.children && f.children.length > 0) {
      // Record/list field: always recurse to evaluate children individually.
      // Do NOT skip based on mapped.has(f.name) — a parent path appearing in
      // 'mapped' only means it was registered as a prefix of a child arrow
      // (via addPathAndPrefixes), not that the record itself was directly targeted.
      // A record is excluded only when all its children are covered.
      const unmappedChildren = filterUnmappedFields(f.children, mapped, path);
      if (unmappedChildren.length > 0) {
        result.push({ ...f, children: unmappedChildren });
      }
    } else {
      // Leaf field: skip if directly covered by an arrow path.
      if (!mapped.has(f.name) && !mapped.has(path)) {
        result.push(f);
      }
    }
  }
  return result;
}

/**
 * Enrich field objects with metadata tags from the FieldDecl metadata array.
 * Recurses into children for record/list blocks.
 */
function enrichFieldMeta(_schemaName: string, fields: FieldWithTags[], _parsedFiles: ParsedFile[]): void {
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

function printDefault(_schemaName: string, fields: FieldWithTags[], opts: { withMeta?: boolean }): void {
  printFieldTree(fields, opts, 1);
}

function printFieldTree(fields: FieldWithTags[], opts: { withMeta?: boolean }, indent: number): void {
  const maxName = Math.max(...fields.map((f) => f.name.length), 4);
  const displayType = (f: FieldWithTags): string => {
    if (!f.isList) return f.type;
    const inner = f.children && f.children.length > 0 ? "record" : f.type;
    return `list_of ${inner}`;
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

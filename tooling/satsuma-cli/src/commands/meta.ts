/**
 * meta.ts — `satsuma meta <scope>` command
 *
 * Extracts metadata entries for a block or field.
 * Scope: schema <name>, field <schema.field>, mapping <name>, metric <name>.
 *
 * Flags:
 *   --tags-only   just tag tokens, one per line
 *   --json        structured metadata object
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey } from "../index-builder.js";
import { extractMetadata } from "@satsuma/core";
import type { MetaEntry, SatsumaGrammarSymbol } from "@satsuma/core";
import { findBlockNode } from "../cst-query.js";
import type { SyntaxNode, ExtractedWorkspace, ParsedFile, FieldDecl } from "../types.js";
import { findDeclaredFields, findFieldDeclaration } from "../field-lookup.js";
import type { FieldOwner } from "../field-lookup.js";

interface MetaResult {
  scope: string;
  type?: string | null;
  entries: MetaEntry[];
}

export function register(program: Command): void {
  program
    .command("meta <scope> [path]")
    .description("Extract metadata for a schema, field, mapping, or metric")
    .option("--tags-only", "only output tag tokens, one per line")
    .option("--json", "structured JSON output")
    .addHelpText(
      "after",
      `
Scope formats:
  <block-name>     metadata on a schema, mapping, metric, or transform
  <schema.field>   metadata on a specific field (type, tags, constraints)

Names can be namespace-qualified (e.g. pos::stores).

JSON shape (--json):
  {
    "scope":   str,
    "entries": [{"key": str, "value": str | null, "raw": str}, ...]
  }

Examples:
  satsuma meta hub_customer                  # schema-level metadata
  satsuma meta hub_customer.email            # field-level metadata
  satsuma meta 'load hub_store'              # mapping metadata
  satsuma meta hub_customer --tags-only      # just tag tokens
  satsuma meta pos::stores.STORE_ID --json   # namespace-qualified`,
    )
    .action(
      runCommand(
        async (
          scope: string,
          pathArg: string | undefined,
          opts: { tagsOnly?: boolean; json?: boolean },
        ) => {
          const { files: parsedFiles, index } = await loadWorkspace(pathArg);

          let result: MetaResult;
          if (scope.includes(".")) {
            result = extractFieldMeta(scope, parsedFiles, index);
          } else {
            result = extractBlockMeta(scope, parsedFiles, index);
          }

          if (opts.tagsOnly) {
            const tags = result.entries
              .filter((e): e is Extract<MetaEntry, { kind: "tag" }> => e.kind === "tag")
              .map((e) => e.tag);
            if (tags.length === 0) {
              console.log("No tags found.");
              return;
            }
            for (const tag of tags) {
              console.log(tag);
            }
            return;
          }

          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
          }

          printDefault(result);
        },
      ),
    );
}

function extractBlockMeta(
  blockName: string,
  parsedFiles: ParsedFile[],
  index: ExtractedWorkspace,
): MetaResult {
  // Determine block type, resolving namespace-qualified keys
  const blockTypes: SatsumaGrammarSymbol[] = [];
  let resolvedName = blockName;
  const schemaResolved = resolveIndexKey(blockName, index.schemas);
  const mappingResolved = resolveIndexKey(blockName, index.mappings);
  const metricResolved = resolveIndexKey(blockName, index.metrics);
  if (schemaResolved) {
    blockTypes.push("schema_block");
    resolvedName = schemaResolved.key;
  }
  if (mappingResolved) {
    blockTypes.push("mapping_block");
    resolvedName = mappingResolved.key;
  }
  // Metrics are schema_block nodes decorated with the `metric` tag — look up by schema_block.
  // A metric name may coincide with a schema name (they ARE the same node), so only add once.
  if (metricResolved && !schemaResolved) {
    blockTypes.push("schema_block");
    resolvedName = metricResolved.key;
  }

  if (blockTypes.length === 0) {
    const allNames = [...index.schemas.keys(), ...index.mappings.keys(), ...index.metrics.keys()];
    const close = allNames.find((k) => k.toLowerCase() === blockName.toLowerCase());
    const lines = [`'${blockName}' not found as a schema, mapping, or metric.`];
    if (close) lines.push(`Did you mean '${close}'?`);
    throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
  }

  const resolvedEntry =
    schemaResolved?.entry ?? mappingResolved?.entry ?? metricResolved?.entry ?? null;

  const parsed = resolvedEntry ? parsedFiles.find((p) => p.filePath === resolvedEntry.file) : null;
  if (parsed) {
    for (const blockType of blockTypes) {
      const node = findBlockNode(parsed.tree.rootNode, blockType, resolvedName);
      if (!node) continue;
      const metaNode = node.namedChildren.find((c) => c.type === "metadata_block");
      const entries = extractMetadata(metaNode);

      // Also extract note blocks from the body (mapping_body or schema_body for metric schemas).
      const bodyNode = node.namedChildren.find(
        (c) => c.type === "mapping_body" || c.type === "schema_body",
      );
      if (bodyNode) {
        for (const child of bodyNode.namedChildren) {
          if (child.type === "note_block") {
            const strNodes = child.namedChildren.filter(
              (x: SyntaxNode) => x.type === "nl_string" || x.type === "multiline_string",
            );
            if (strNodes.length > 0) {
              const text = strNodes
                .map((s: SyntaxNode) => {
                  if (s.type === "multiline_string") return s.text.slice(3, -3).trim();
                  return s.text.slice(1, -1);
                })
                .join("\n");
              entries.push({ kind: "note" as const, text });
            }
          }
        }
      }

      // Use the resolved canonical key as the scope so bare-name queries still
      // produce the qualified name in output (e.g. "crm::customers" not "customers").
      // resolvedName is updated by each successful resolveIndexKey call above (sl-wfgx).
      return { scope: resolvedName, entries };
    }
  }

  return { scope: resolvedName, entries: [] };
}

function extractFieldMeta(
  fieldRef: string,
  parsedFiles: ParsedFile[],
  index: ExtractedWorkspace,
): MetaResult {
  const dot = fieldRef.indexOf(".");
  const entityName = fieldRef.slice(0, dot);
  const fieldPath = fieldRef.slice(dot + 1);
  // Nested paths like schema.record.field name each record on the way down.
  const pathSegments = fieldPath.split(".");

  // Search schemas, then fragments, then metrics
  type ResolvedEntity = { key: string; entry: FieldOwner & { file: string } };
  let resolved: ResolvedEntity | null = resolveIndexKey(entityName, index.schemas);
  let blockType: SatsumaGrammarSymbol = "schema_block";
  if (!resolved) {
    resolved = resolveIndexKey(entityName, index.fragments);
    blockType = "fragment_block";
  }
  if (!resolved) {
    // Metrics are schema_block nodes decorated with the `metric` tag, and
    // declare no spreads.
    const metric = resolveIndexKey(entityName, index.metrics);
    resolved = metric ? { key: metric.key, entry: { ...metric.entry, hasSpreads: false } } : null;
    blockType = "schema_block";
  }
  if (!resolved) {
    throw new CommandError(
      `'${entityName}' not found in schemas, fragments, or metrics.`,
      EXIT_NOT_FOUND,
    );
  }

  // Spread-supplied fields count at any depth (bsw-ep0m); `meta` reports the
  // first match when a bare name occurs more than once.
  const match = findDeclaredFields(resolved.entry, pathSegments, index)[0];
  if (!match) {
    throw new CommandError(`Field '${fieldPath}' not found in '${entityName}'.`, EXIT_NOT_FOUND);
  }

  // Metadata is written on the declaration — in the fragment's body when a
  // spread supplied the field.
  const declaration = findFieldDeclaration(
    match,
    { key: resolved.key, blockType, file: resolved.entry.file },
    index,
    parsedFiles,
  );
  const metaNode = declaration?.node.namedChildren.find((c) => c.type === "metadata_block");
  return { scope: fieldRef, type: displayType(match.field), entries: extractMetadata(metaNode) };
}

function displayType(field: FieldDecl): string | null {
  if (!field.type) return null;
  return field.isList ? `list_of ${field.type}` : field.type;
}

function printDefault(result: MetaResult): void {
  console.log(`Metadata for '${result.scope}':`);
  if (result.type) {
    console.log(`  type: ${result.type}`);
  }
  console.log();

  if (result.entries.length === 0) {
    console.log("  (no metadata)");
    return;
  }

  for (const entry of result.entries) {
    if (entry.kind === "tag") {
      console.log(`  [tag] ${entry.tag}`);
    } else if (entry.kind === "kv") {
      console.log(`  ${entry.key}: ${entry.value}`);
    } else if (entry.kind === "enum") {
      console.log(`  enum { ${entry.values.join(", ")} }`);
    } else if (entry.kind === "note") {
      console.log(`  note: ${entry.text}`);
    } else if (entry.kind === "slice") {
      console.log(`  slice { ${entry.values.join(", ")} }`);
    }
  }
}

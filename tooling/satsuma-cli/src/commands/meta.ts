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
import { expandEntityFields } from "../spread-expand.js";

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
  // Support nested paths like schema.record.field by using the last segment as field name
  // and intermediate segments to navigate into record/list blocks
  const pathSegments = fieldPath.split(".");
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: split always produces at least one element
  const fieldName = pathSegments[pathSegments.length - 1]!;

  // Search schemas, then fragments, then metrics
  type ResolvedEntity = {
    key: string;
    entry: { fields: FieldDecl[]; file: string; namespace?: string };
  };
  let resolved: ResolvedEntity | null = resolveIndexKey(entityName, index.schemas);
  let blockType: SatsumaGrammarSymbol = "schema_block";
  let bodyType: SatsumaGrammarSymbol = "schema_body";
  if (!resolved) {
    resolved = resolveIndexKey(entityName, index.fragments);
    blockType = "fragment_block";
    bodyType = "schema_body";
  }
  if (!resolved) {
    // Metrics are schema_block nodes decorated with the `metric` tag.
    resolved = resolveIndexKey(entityName, index.metrics);
    blockType = "schema_block";
    bodyType = "schema_body";
  }
  if (!resolved) {
    throw new CommandError(
      `'${entityName}' not found in schemas, fragments, or metrics.`,
      EXIT_NOT_FOUND,
    );
  }

  const entity = resolved.entry;
  let field = findFieldByPath(entity.fields, pathSegments);
  let fromFragment: string | null = null;

  // If field not found directly, try expanded spread fields
  if (!field && blockType === "schema_block") {
    const expanded = expandEntityFields(
      entity as Parameters<typeof expandEntityFields>[0],
      entity.namespace ?? null,
      index,
    );
    const expandedField = expanded.find((f) => f.name === pathSegments[0]);
    if (expandedField) {
      field = expandedField;
      fromFragment = expandedField.fromFragment ?? null;
    }
  }

  if (!field) {
    throw new CommandError(`Field '${fieldPath}' not found in '${entityName}'.`, EXIT_NOT_FOUND);
  }

  // If the field came from a fragment spread, look up metadata from the fragment's CST
  if (fromFragment) {
    const fragment = index.fragments.get(fromFragment);
    if (fragment) {
      const fragParsed = parsedFiles.find((p) => p.filePath === fragment.file);
      if (fragParsed) {
        const fragNode = findBlockNode(fragParsed.tree.rootNode, "fragment_block", fromFragment);
        const fragBody = fragNode?.namedChildren.find((c) => c.type === "schema_body");
        if (fragBody) {
          for (const fieldDecl of findFieldDecls(fragBody, fieldName)) {
            const metaNode = fieldDecl.namedChildren.find((c) => c.type === "metadata_block");
            const entries = extractMetadata(metaNode);
            return { scope: fieldRef, type: displayType(field), entries };
          }
        }
      }
    }
    return { scope: fieldRef, type: displayType(field), entries: [] };
  }

  const parsed = parsedFiles.find((p) => p.filePath === entity.file);
  const entityNode = parsed ? findBlockNode(parsed.tree.rootNode, blockType, resolved.key) : null;
  const body = entityNode?.namedChildren.find((c) => c.type === bodyType);
  if (body) {
    const targetBody = navigateToNestedBody(body, pathSegments.slice(0, -1));
    if (targetBody) {
      for (const fieldDecl of findFieldDecls(targetBody, fieldName)) {
        const metaNode = fieldDecl.namedChildren.find((c) => c.type === "metadata_block");
        const entries = extractMetadata(metaNode);
        return {
          scope: fieldRef,
          type: displayType(field),
          entries,
        };
      }
    }
  }

  return { scope: fieldRef, type: displayType(field), entries: [] };
}

function displayType(field: FieldDecl): string | null {
  if (!field.type) return null;
  return field.isList ? `list_of ${field.type}` : field.type;
}

function getFieldDeclName(fieldDecl: SyntaxNode): string | null {
  const nameNode = fieldDecl.namedChildren.find((c) => c.type === "field_name");
  const inner = nameNode?.namedChildren[0];
  if (!inner) return null;
  if (inner.type === "backtick_name") return inner.text.slice(1, -1);
  return inner.text;
}

function findField(fields: FieldDecl[], fieldName: string): FieldDecl | null {
  for (const field of fields) {
    if (field.name === fieldName) return field;
    if (field.children) {
      const nested = findField(field.children, fieldName);
      if (nested) return nested;
    }
  }
  return null;
}

function findFieldByPath(fields: FieldDecl[], segments: string[]): FieldDecl | null {
  if (segments.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: length === 1 guarantees index 0 exists
  if (segments.length === 1) return findField(fields, segments[0]!);
  // Navigate into nested record/list by matching intermediate segments
  for (const field of fields) {
    if (field.name === segments[0] && field.children) {
      return findFieldByPath(field.children, segments.slice(1));
    }
  }
  // Fallback: flat search for the last segment
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: segments.length > 1 guaranteed by preceding checks
  return findField(fields, segments[segments.length - 1]!);
}

function navigateToNestedBody(body: SyntaxNode, intermediateSegments: string[]): SyntaxNode {
  let current = body;
  for (const seg of intermediateSegments) {
    let found = false;
    for (const c of current.namedChildren) {
      if (c.type === "field_decl") {
        if (getFieldDeclName(c) === seg) {
          const nested = c.namedChildren.find((x) => x.type === "schema_body");
          if (nested) {
            current = nested;
            found = true;
            break;
          }
        }
      }
    }
    if (!found) break;
  }
  return current;
}

function findFieldDecls(
  bodyNode: SyntaxNode,
  fieldName: string,
  acc: SyntaxNode[] = [],
): SyntaxNode[] {
  for (const child of bodyNode.namedChildren) {
    if (child.type === "field_decl") {
      if (getFieldDeclName(child) === fieldName) {
        acc.push(child);
        continue;
      }
      // Recurse into nested record/list_of fields
      const nestedBody = child.namedChildren.find((c) => c.type === "schema_body");
      if (nestedBody) findFieldDecls(nestedBody, fieldName, acc);
    }
  }
  return acc;
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

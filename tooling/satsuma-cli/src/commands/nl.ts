/**
 * nl.ts — `satsuma nl <scope>` command
 *
 * Extracts all NL content (notes, transforms, comments) within a scope.
 * Scope: schema <name>, mapping <name>, field <schema.field>, or all.
 *
 * Flags:
 *   --kind <type>  filter to: note, warning, question, or transform
 *   --json         structured JSON output
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey } from "../index-builder.js";
import { extractNLContent } from "../nl-extract.js";
import type { NLItem } from "../nl-extract.js";
import { labelText } from "@satsuma/core";
import type { SatsumaGrammarSymbol } from "@satsuma/core";
import { findBlockNode } from "../cst-query.js";
import type { SyntaxNode, ExtractedWorkspace, ParsedFile, FieldDecl } from "../types.js";

interface NLItemWithFile extends NLItem {
  file: string;
}

export function register(program: Command): void {
  program
    .command("nl <scope> [path]")
    .description("Extract NL content (notes, transforms, comments) from a scope")
    .option("--kind <type>", "filter by kind: note, warning, question, transform")
    .option("--json", "structured JSON output")
    .addHelpText(
      "after",
      `
Scope formats:
  <block-name>     NL in a schema, mapping, metric, or transform by name
  <schema.field>   NL on a specific field and arrows referencing it
  all              NL across all reachable files

JSON shape (--json): array of NL content objects
  [{
    "kind":      "note" | "warning" | "question" | "transform",
    "scope":     str,   # block or field name
    "text":      str,   # verbatim NL content
    "file":      str,
    "line":      int
  }, ...]

Examples:
  satsuma nl 'demographics to mart'          # NL in a mapping
  satsuma nl hub_customer                    # NL in a schema
  satsuma nl mart_customer_360.email         # NL on a field
  satsuma nl all pipeline.stm                # all NL in file and imports
  satsuma nl all pipeline.stm --kind warning # only //! warnings
  satsuma nl hub_customer --json             # structured output`,
    )
    .action(
      runCommand(
        async (
          scope: string,
          pathArg: string | undefined,
          opts: { kind?: string; json?: boolean },
        ) => {
          const { files: parsedFiles, index } = await loadWorkspace(pathArg);

          let items: NLItemWithFile[];
          if (scope === "all") {
            items = extractFromAll(parsedFiles);
          } else if (scope.includes(".")) {
            items = extractFromField(scope, parsedFiles, index);
          } else {
            items = extractFromBlock(scope, parsedFiles, index);
          }

          if (opts.kind) {
            items = items.filter((i) => i.kind === opts.kind);
          }

          if (opts.json) {
            console.log(JSON.stringify(items, null, 2));
            return;
          }

          if (items.length === 0) {
            console.log(`No NL content found for scope '${scope}'.`);
            return;
          }

          printDefault(items);
        },
      ),
    );
}

function extractFromAll(parsedFiles: ParsedFile[]): NLItemWithFile[] {
  const items: NLItemWithFile[] = [];
  for (const { filePath, tree } of parsedFiles) {
    for (const item of extractNLContent(tree.rootNode)) {
      items.push({ ...item, file: filePath });
    }
  }
  return items;
}

function extractFromBlock(
  blockName: string,
  parsedFiles: ParsedFile[],
  index: ExtractedWorkspace,
): NLItemWithFile[] {
  // Check if it's a schema, mapping, metric, or transform (resolving namespace-qualified keys)
  const schemaResolved = resolveIndexKey(blockName, index.schemas);
  const mappingResolved = resolveIndexKey(blockName, index.mappings);
  const metricResolved = resolveIndexKey(blockName, index.metrics);
  const transformResolved = resolveIndexKey(blockName, index.transforms);

  if (!schemaResolved && !mappingResolved && !metricResolved && !transformResolved) {
    const allNames = [
      ...index.schemas.keys(),
      ...index.mappings.keys(),
      ...index.metrics.keys(),
      ...index.transforms.keys(),
    ];
    const close = allNames.find((k) => k.toLowerCase() === blockName.toLowerCase());
    const lines = [`'${blockName}' not found as a schema, mapping, metric, or transform.`];
    if (close) lines.push(`Did you mean '${close}'?`);
    throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
  }

  // Collect NL content from ALL matching blocks (schema, mapping, metric, transform)
  // to handle ambiguous names where a schema and mapping share a name
  const items: NLItemWithFile[] = [];
  const matches: Array<{
    key: string;
    entry: { file: string };
    blockType: SatsumaGrammarSymbol;
  }> = [];
  if (schemaResolved)
    matches.push({
      key: schemaResolved.key,
      entry: schemaResolved.entry,
      blockType: "schema_block",
    });
  if (mappingResolved)
    matches.push({
      key: mappingResolved.key,
      entry: mappingResolved.entry,
      blockType: "mapping_block",
    });
  // Metrics are schema_block nodes — look up by schema_block. Skip if already added via schemaResolved.
  if (metricResolved && !schemaResolved)
    matches.push({
      key: metricResolved.key,
      entry: metricResolved.entry,
      blockType: "schema_block",
    });
  if (transformResolved)
    matches.push({
      key: transformResolved.key,
      entry: transformResolved.entry,
      blockType: "transform_block",
    });

  for (const { key, entry, blockType } of matches) {
    const parsed = parsedFiles.find((p) => p.filePath === entry.file);
    const node = parsed ? findBlockNode(parsed.tree.rootNode, blockType, key) : null;
    if (node) {
      // Pass the resolved canonical key (e.g. "warehouse::load dim_customer") as
      // the parent scope rather than the user's raw query string, so that JSON
      // "parent" fields and text output always show the qualified name (sl-wfgx).
      for (const item of extractNLContent(node, key)) {
        items.push({ ...item, file: entry.file });
      }
    }
  }

  return items;
}

function extractFromField(
  fieldRef: string,
  parsedFiles: ParsedFile[],
  index: ExtractedWorkspace,
): NLItemWithFile[] {
  const dot = fieldRef.indexOf(".");
  const schemaName = fieldRef.slice(0, dot);
  const fieldPath = fieldRef.slice(dot + 1);
  // Support nested paths like schema.record.nested.field
  const pathSegments = fieldPath.split(".");
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: split always produces at least one element
  const leafName = pathSegments[pathSegments.length - 1]!;

  const resolvedSchema = resolveIndexKey(schemaName, index.schemas);
  if (!resolvedSchema) {
    throw new CommandError(`Schema '${schemaName}' not found.`, EXIT_NOT_FOUND);
  }

  const schema = resolvedSchema.entry;
  // For multi-segment paths, require exact path match; for single-segment, use flat search
  const fieldExists =
    pathSegments.length > 1
      ? schemaHasFieldByPath(schema.fields, pathSegments)
      : schemaHasField(schema.fields, leafName);
  if (!fieldExists) {
    throw new CommandError(
      `Field '${fieldPath}' not found in schema '${schemaName}'.`,
      EXIT_NOT_FOUND,
    );
  }

  const items: NLItemWithFile[] = [];
  const parsed = parsedFiles.find((p) => p.filePath === schema.file);
  const schemaNode = parsed
    ? findBlockNode(parsed.tree.rootNode, "schema_block", resolvedSchema.key)
    : null;
  const body = schemaNode?.namedChildren.find((c) => c.type === "schema_body");
  if (body) {
    // Navigate to the nested body for intermediate path segments, then find the leaf field
    const targetBody = navigateToNestedBody(body, pathSegments.slice(0, -1));
    for (const fieldDecl of findFieldDecls(targetBody, leafName)) {
      for (const item of extractNLContent(fieldDecl, leafName)) {
        items.push({ ...item, file: schema.file });
      }
    }
  }

  // Also extract NL from arrows targeting/sourcing this field in mappings
  // Only include arrows from mappings whose source or target schemas include the resolved schema
  const resolvedSchemaKey = resolvedSchema.key;
  for (const [, mapping] of index.mappings) {
    const mappingSources = mapping.sources ?? [];
    const mappingTargets = mapping.targets ?? [];
    const schemaIsRelevant =
      mappingSources.includes(resolvedSchemaKey) || mappingTargets.includes(resolvedSchemaKey);
    if (!schemaIsRelevant) continue;

    const mappingParsed = parsedFiles.find((p) => p.filePath === mapping.file);
    if (!mappingParsed) continue;

    const mappingKey = mapping.namespace
      ? `${mapping.namespace}::${mapping.name}`
      : (mapping.name ?? "");
    const mappingNode = findBlockNode(mappingParsed.tree.rootNode, "mapping_block", mappingKey);
    if (!mappingNode) continue;

    const mBody = mappingNode.namedChildren.find((c) => c.type === "mapping_body");
    if (!mBody) continue;

    const parentName = labelText(mappingNode) ?? "?";
    collectFieldArrowNL(mBody.namedChildren, leafName, parentName, mapping.file, items);
  }

  return items;
}

function collectFieldArrowNL(
  children: SyntaxNode[],
  leafName: string,
  parentName: string,
  file: string,
  items: NLItemWithFile[],
): void {
  for (let idx = 0; idx < children.length; idx++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: idx is within children.length bounds
    const child = children[idx]!;
    if (child.type === "each_block" || child.type === "flatten_block") {
      collectFieldArrowNL(child.namedChildren, leafName, parentName, file, items);
      continue;
    }
    if (child.type !== "map_arrow" && child.type !== "computed_arrow") continue;
    const src = child.namedChildren.find((c) => c.type === "src_path");
    const tgt = child.namedChildren.find((c) => c.type === "tgt_path");
    const srcText = src?.namedChildren[0]?.text?.replace(/^\./, "") ?? null;
    const tgtText = tgt?.namedChildren[0]?.text?.replace(/^\./, "") ?? null;
    if (srcText !== leafName && tgtText !== leafName) continue;

    // Include warning/question comments immediately preceding this arrow
    for (let ci = idx - 1; ci >= 0; ci--) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: ci >= 0 checked by loop condition
      const prev = children[ci]!;
      if (prev.type === "warning_comment" || prev.type === "question_comment") {
        for (const item of extractNLContent(prev, parentName)) {
          items.push({ ...item, file });
        }
      } else {
        break;
      }
    }

    for (const item of extractNLContent(child, parentName)) {
      items.push({ ...item, file });
    }
  }
}

function getFieldDeclName(fieldDecl: SyntaxNode): string | null {
  const nameNode = fieldDecl.namedChildren.find((c) => c.type === "field_name");
  const inner = nameNode?.namedChildren[0];
  if (!inner) return null;
  if (inner.type === "backtick_name") return inner.text.slice(1, -1);
  return inner.text;
}

function schemaHasField(fields: FieldDecl[], fieldName: string): boolean {
  for (const field of fields) {
    if (field.name === fieldName) return true;
    if (field.children && schemaHasField(field.children, fieldName)) return true;
  }
  return false;
}

function schemaHasFieldByPath(fields: FieldDecl[], segments: string[]): boolean {
  if (segments.length === 0) return false;
  const [head, ...rest] = segments;
  for (const field of fields) {
    if (field.name === head) {
      if (rest.length === 0) return true;
      if (field.children) return schemaHasFieldByPath(field.children, rest);
    }
  }
  return false;
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

function printDefault(items: NLItemWithFile[]): void {
  for (const item of items) {
    const prefix =
      item.kind === "warning"
        ? "//! "
        : item.kind === "question"
          ? "//? "
          : item.kind === "transform"
            ? "[transform] "
            : "[note] ";
    const parent = item.parent ? ` (${item.parent})` : "";
    console.log(`${prefix}${item.text}${parent}`);
  }
}

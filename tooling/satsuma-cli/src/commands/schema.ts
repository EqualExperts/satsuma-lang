/**
 * schema.ts — `satsuma schema <name>` command
 *
 * Looks up a schema by name and renders it. Output modes:
 *   default    — reconstructed schema with nesting and notes
 *   --compact  — omit note text and inline NL strings
 *   --fields-only — one field per line: <name>  <type>  [<metadata>]
 *   --json     — structured field list
 *
 * Exits 1 if the schema name is not found.
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey } from "../index-builder.js";
import { findBlockNode } from "../cst-query.js";
import { expandEntityFields } from "../spread-expand.js";
import { canonicalEntityName, extractMetadata } from "@satsuma/core";
import type { SyntaxNode, ExtractedWorkspace, SchemaRecord } from "../types.js";

export function register(program: Command): void {
  program
    .command("schema <name> [path]")
    .description("Show a schema definition")
    .option("--compact", "omit notes and inline strings")
    .option("--fields-only", "one line per field")
    .option("--json", "output JSON")
    .addHelpText(
      "after",
      `
Names can be namespace-qualified (e.g. pos::stores). Quote names with
spaces (e.g. 'my schema').

Examples:
  satsuma schema hub_customer                        # full schema
  satsuma schema hub_customer --fields-only          # one field per line
  satsuma schema pos::stores --json                  # namespace-qualified`,
    )
    .action(
      runCommand(
        async (
          name: string,
          pathArg: string | undefined,
          opts: { compact?: boolean; fieldsOnly?: boolean; json?: boolean },
        ) => {
          const { files: parsedFiles, index } = await loadWorkspace(pathArg);

          const resolved = resolveIndexKey(name, index.schemas);
          if (!resolved) {
            const keys = [...index.schemas.keys()];
            const close = keys.find((k) => k.toLowerCase() === name.toLowerCase());
            // Check for ambiguous unqualified name
            const ambiguous = !name.includes("::") && keys.filter((k) => k.endsWith(`::${name}`));
            let errorMsg: string;
            if (ambiguous && ambiguous.length > 1) {
              errorMsg = `Schema '${name}' is ambiguous. Found in: ${ambiguous.join(", ")}`;
            } else if (close) {
              errorMsg = `Schema '${name}' not found. Did you mean '${close}'?`;
            } else {
              errorMsg = `Schema '${name}' not found.`;
            }
            if (opts.json) {
              // JSON callers want the error on the same channel as success
              // output so they can pipe `satsuma schema … --json | jq` and
              // still parse the response. Hand the JSON-shaped message to the
              // runner with stream: "stdout".
              const errorObj: Record<string, unknown> = { error: errorMsg };
              if (keys.length > 0) errorObj.available = keys;
              throw new CommandError(JSON.stringify(errorObj, null, 2), EXIT_NOT_FOUND, "stdout");
            }
            const lines: string[] = [errorMsg];
            if (keys.length > 0 && !(ambiguous && ambiguous.length > 1) && !close) {
              lines.push(`Available: ${keys.join(", ")}`);
            }
            throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
          }
          const entry = resolved.entry;

          // Find the raw CST node for richer reconstruction
          const parsed = parsedFiles.find((p) => p.filePath === entry.file);
          const schemaNode = parsed
            ? findBlockNode(parsed.tree.rootNode, "schema_block", resolved.key)
            : null;

          if (opts.json) {
            printJson(entry, schemaNode, index, opts);
          } else if (opts.fieldsOnly) {
            printFieldsOnly(entry);
          } else {
            printDefault(entry, schemaNode, opts.compact);
          }
        },
      ),
    );
}

// ── CST helpers ───────────────────────────────────────────────────────────────

interface CollectedLine {
  indent: number;
  text: string;
}

/** Check if a field_decl has a "list_of" anonymous keyword child. */
function fieldHasListOf(fd: SyntaxNode): boolean {
  if (fd.children) {
    return fd.children.some((c) => !c.isNamed && c.text === "list_of");
  }
  return false;
}

/** Collect edge comments (before first field / after last field) from a block node. */
function collectEdgeComments(
  blockNode: SyntaxNode,
  position: "before" | "after",
  bodyNode: SyntaxNode,
): CollectedLine[] {
  const lines: CollectedLine[] = [];
  const commentTypes = new Set(["comment", "warning_comment", "question_comment"]);
  for (const c of blockNode.children) {
    if (position === "before") {
      // Comments between { and body start
      if (c.startPosition.row >= bodyNode.startPosition.row) break;
      if (commentTypes.has(c.type)) {
        lines.push({ indent: 0, text: `  ${c.text}` });
      }
    } else {
      // Comments between body end and }
      if (c.startPosition.row <= bodyNode.endPosition.row) continue;
      if (commentTypes.has(c.type)) {
        lines.push({ indent: 0, text: `  ${c.text}` });
      }
    }
  }
  return lines;
}

/** Collect fields from schema_body, recursing into nested record/list_of fields. */
function collectFields(bodyNode: SyntaxNode, indent: number = 0): CollectedLine[] {
  const lines: CollectedLine[] = [];
  for (const c of bodyNode.namedChildren) {
    const pad = "  ".repeat(indent);
    if (c.type === "field_decl") {
      const nameNode = c.namedChildren.find((x) => x.type === "field_name");
      const typeNode = c.namedChildren.find((x) => x.type === "type_expr");
      const meta = c.namedChildren.find((x) => x.type === "metadata_block");
      const nested = c.namedChildren.find((x) => x.type === "schema_body");
      const inner = nameNode?.namedChildren[0];
      const fname = inner?.text ?? "";

      const hasRecordKw = c.children?.some((ch: SyntaxNode) => !ch.isNamed && ch.text === "record");
      if (nested || hasRecordKw) {
        // Nested structure: record or list_of record (may have empty body)
        const isList = fieldHasListOf(c);
        const kind = isList ? "list_of record" : "record";
        const blockMeta = meta;
        const blockMetaText = blockMeta ? ` ${blockMeta.text}` : "";
        lines.push({ indent, text: `${pad}${fname} ${kind}${blockMetaText} {` });
        if (nested) lines.push(...collectFields(nested, indent + 1));
        lines.push({ indent, text: `${pad}}` });
      } else {
        // Scalar field (may be list_of scalar)
        const isList = fieldHasListOf(c);
        const typePrefix = isList ? "list_of " : "";
        const metaText = meta ? ` ${meta.text}` : "";
        lines.push({
          indent,
          text: `${pad}${fname.padEnd(24)}${typePrefix}${typeNode?.text ?? ""}${metaText}`,
        });
      }
    } else if (c.type === "fragment_spread") {
      const lbl = c.namedChildren.find((x) => x.type === "spread_label");
      let sname = "";
      if (lbl) {
        const q = lbl.namedChildren.find((x) => x.type === "backtick_name");
        if (q) {
          sname = q.text;
        } else {
          sname = lbl.namedChildren
            .filter(
              (x) =>
                x.type === "identifier" ||
                x.type === "continuation_word" ||
                x.type === "qualified_name",
            )
            .map((x) => x.text)
            .join(" ");
        }
      }
      lines.push({ indent, text: `${pad}...${sname}` });
    } else if (
      c.type === "comment" ||
      c.type === "warning_comment" ||
      c.type === "question_comment"
    ) {
      lines.push({ indent, text: `${pad}${c.text}` });
    }
  }
  return lines;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function printJson(
  entry: SchemaRecord,
  schemaNode: SyntaxNode | null,
  index: ExtractedWorkspace,
  opts: { compact?: boolean; fieldsOnly?: boolean },
): void {
  const spreadFields = expandEntityFields(entry, entry.namespace ?? null, index);
  const allFields = [...entry.fields, ...spreadFields];

  // --json --fields-only: return just the fields array
  if (opts.fieldsOnly) {
    console.log(JSON.stringify(allFields, null, 2));
    return;
  }

  const metaNode = schemaNode?.namedChildren.find((c) => c.type === "metadata_block");
  const metadata = extractMetadata(metaNode);

  const out: Record<string, unknown> = {
    name: canonicalEntityName(entry),
    ...(entry.namespace ? { namespace: entry.namespace } : {}),
    file: entry.file,
    line: entry.row + 1,
    fields: allFields,
  };

  // --json --compact: omit note and metadata
  if (!opts.compact) {
    out.note = entry.note;
    if (metadata.length > 0) out.metadata = metadata;
  }

  // Enrich with nested structure if CST is available
  if (schemaNode) {
    const body = schemaNode.namedChildren.find((c) => c.type === "schema_body");
    if (body) {
      let fieldLines = [
        ...collectEdgeComments(schemaNode, "before", body),
        ...collectFields(body),
        ...collectEdgeComments(schemaNode, "after", body),
      ].map((l) => l.text.trim());
      if (opts.compact) {
        fieldLines = fieldLines.filter((l) => !l.startsWith("//"));
      }
      out.fieldLines = fieldLines;
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

function printFieldsOnly(entry: SchemaRecord): void {
  for (const f of entry.fields) {
    console.log(`${f.name.padEnd(24)}${f.type}`);
  }
}

function printDefault(
  entry: SchemaRecord,
  schemaNode: SyntaxNode | null,
  compact: boolean | undefined,
): void {
  const metaNode = schemaNode?.namedChildren.find((c) => c.type === "metadata_block");
  const metaText = metaNode && !compact ? ` ${metaNode.text}` : "";
  const baseName = entry.name && entry.name.includes(" ") ? `'${entry.name}'` : (entry.name ?? "");
  const nameStr = entry.namespace ? `${entry.namespace}::${baseName}` : baseName;
  console.log(`schema ${nameStr}${metaText} {`);

  if (schemaNode) {
    const body = schemaNode.namedChildren.find((c) => c.type === "schema_body");
    if (body) {
      const allLines = [
        ...collectEdgeComments(schemaNode, "before", body),
        ...collectFields(body, 1),
        ...collectEdgeComments(schemaNode, "after", body),
      ];
      for (const { text } of allLines) {
        if (compact) {
          // Strip comments and inline note text in compact mode
          if (text.trimStart().startsWith("//")) continue;
          console.log(
            text
              .replace(/\s*\(\s*note\s+"""[\s\S]*?"""\s*\)/, "")
              .replace(/\s*\(note\s+"[^"]*"\)/, ""),
          );
        } else {
          console.log(text);
        }
      }
    }
  } else {
    // Fallback to index fields
    for (const f of entry.fields) {
      console.log(`  ${f.name.padEnd(24)}${f.type}`);
    }
  }

  console.log("}");
}

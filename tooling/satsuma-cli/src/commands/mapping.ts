/**
 * mapping.ts — `satsuma mapping <name>` command
 *
 * Looks up a mapping by name and renders it. Output modes:
 *   default      — reconstructed mapping block with arrows and transforms
 *   --compact    — omit transform bodies and note blocks
 *   --arrows-only — table of src → tgt (one per line)
 *   --json       — full structured JSON output
 *
 * Exits 1 if the mapping name is not found.
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND } from "../command-runner.js";
import { resolveIndexKey, canonicalKey } from "../index-builder.js";
import { findBlockNode } from "../cst-query.js";
import { extractMetadata, canonicalEntityName, classifyTransform } from "@satsuma/core";
import type { SyntaxNode, MappingRecord } from "../types.js";

export function register(program: Command): void {
  program
    .command("mapping <name> [path]")
    .description("Show a mapping definition")
    .option("--compact", "omit transform bodies and notes")
    .option("--arrows-only", "print src → tgt table")
    .option("--json", "output JSON")
    .addHelpText(
      "after",
      `
Names can be namespace-qualified (e.g. warehouse::'load hub_store').
Quote names with spaces (e.g. 'load hub_customer').

Examples:
  satsuma mapping 'load hub_customer'                # full mapping
  satsuma mapping 'load hub_customer' --arrows-only  # just src → tgt
  satsuma mapping 'load hub_customer' --json         # structured output`,
    )
    .action(
      runCommand(
        async (
          name: string,
          pathArg: string | undefined,
          opts: { compact?: boolean; arrowsOnly?: boolean; json?: boolean },
        ) => {
          const { files: parsedFiles, index } = await loadWorkspace(pathArg);

          const resolved = resolveIndexKey(name, index.mappings);
          if (!resolved) {
            const keys = [...index.mappings.keys()];
            const close = keys.find((k) => k.toLowerCase() === name.toLowerCase());
            const lines: string[] = [];
            if (close) {
              lines.push(`Mapping '${name}' not found. Did you mean '${close}'?`);
            } else {
              lines.push(`Mapping '${name}' not found.`);
              if (keys.length > 0) lines.push(`Available: ${keys.join(", ")}`);
            }
            throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
          }
          const entry = resolved.entry;

          const parsed = parsedFiles.find((p) => p.filePath === entry.file);
          const mappingNode = parsed
            ? findBlockNode(parsed.tree.rootNode, "mapping_block", resolved.key)
            : null;

          if (opts.json) {
            printJson(entry, mappingNode, opts.compact);
          } else if (opts.arrowsOnly) {
            printArrowsOnly(entry, mappingNode);
          } else {
            printDefault(entry, mappingNode, opts.compact);
          }
        },
      ),
    );
}

// ── CST helpers ───────────────────────────────────────────────────────────────

/** Extract text from a path node (_path_expr variants), preserving backticks. */
function pathText(pathNode: SyntaxNode | undefined): string {
  if (!pathNode) return "?";
  return pathNode.text;
}

interface ArrowInfo {
  kind: string;
  src: string | null;
  tgt: string;
  hasBody: boolean;
  metaNode: SyntaxNode | undefined;
  node: SyntaxNode;
  children?: ArrowInfo[];
}

/** Collect arrows from mapping_body as {kind, src, tgt, hasBody} objects. */
function collectArrows(bodyNode: SyntaxNode | undefined): ArrowInfo[] {
  if (!bodyNode) return [];
  const arrows: ArrowInfo[] = [];
  for (const c of bodyNode.namedChildren) {
    if (c.type === "map_arrow") {
      const src = c.namedChildren.find((x) => x.type === "src_path");
      const tgt = c.namedChildren.find((x) => x.type === "tgt_path");
      const hasBody = c.namedChildren.some((x) => x.type === "pipe_chain");
      const meta = c.namedChildren.find((x) => x.type === "metadata_block");
      arrows.push({
        kind: "map",
        src: pathText(src),
        tgt: pathText(tgt),
        hasBody,
        metaNode: meta,
        node: c,
      });
    } else if (c.type === "computed_arrow") {
      const tgt = c.namedChildren.find((x) => x.type === "tgt_path");
      const hasBody = c.namedChildren.some((x) => x.type === "pipe_chain");
      const meta = c.namedChildren.find((x) => x.type === "metadata_block");
      arrows.push({
        kind: "computed",
        src: null,
        tgt: pathText(tgt),
        hasBody,
        metaNode: meta,
        node: c,
      });
    } else if (c.type === "nested_arrow") {
      const src = c.namedChildren.find((x) => x.type === "src_path");
      const tgt = c.namedChildren.find((x) => x.type === "tgt_path");
      const meta = c.namedChildren.find((x) => x.type === "metadata_block");
      const children = collectArrows(c);
      const hasChildren = children.length > 0;
      arrows.push({
        kind: hasChildren ? "nested" : "map",
        src: pathText(src),
        tgt: pathText(tgt),
        hasBody: hasChildren,
        metaNode: meta,
        node: c,
        children: hasChildren ? children : undefined,
      });
    } else if (c.type === "flatten_block" || c.type === "each_block") {
      const blockKind = c.type === "flatten_block" ? "flatten" : "each";
      const src = c.namedChildren.find((x) => x.type === "src_path");
      const tgt = c.namedChildren.find((x) => x.type === "tgt_path");
      const meta = c.namedChildren.find((x) => x.type === "metadata_block");
      const children = collectArrows(c);
      arrows.push({
        kind: blockKind,
        src: pathText(src),
        tgt: pathText(tgt),
        hasBody: true,
        metaNode: meta,
        node: c,
        children: children.length > 0 ? children : undefined,
      });
    }
  }
  return arrows;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function extractNoteText(node: SyntaxNode | undefined): string | null {
  if (!node) return null;
  const parts: string[] = [];
  for (const c of node.namedChildren) {
    if (c.type === "nl_string") parts.push(c.text.slice(1, -1));
    else if (c.type === "multiline_string") parts.push(c.text.slice(3, -3).trim());
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function printJson(entry: MappingRecord, mappingNode: SyntaxNode | null, compact?: boolean): void {
  const body = mappingNode?.namedChildren.find((c) => c.type === "mapping_body");
  const metaNode = mappingNode?.namedChildren.find((c) => c.type === "metadata_block");
  const metadata = compact ? [] : extractMetadata(metaNode);
  const noteBlock = body?.namedChildren.find((c) => c.type === "note_block");
  const note = compact ? null : extractNoteText(noteBlock);
  function arrowToJson(info: ArrowInfo): Record<string, unknown> {
    const { kind, src, tgt, hasBody, metaNode: arrowMeta, node: arrowNode, children } = info;
    const pipeChain = arrowNode.namedChildren.find((x) => x.type === "pipe_chain");
    const pipeSteps = pipeChain
      ? [...pipeChain.namedChildren].filter((x) => x.type === "pipe_step")
      : [];
    const classification = classifyTransform(pipeSteps.length > 0 ? pipeSteps : null);
    const hasTransform = hasBody && pipeChain != null;
    const arrowObj: Record<string, unknown> = { kind, src, tgt, hasTransform, classification };
    if (!compact && hasBody) {
      if (pipeChain) arrowObj.transform = pipeChain.text;
    }
    if (!compact) {
      const arrowMetadata = extractMetadata(arrowMeta);
      if (arrowMetadata.length > 0) arrowObj.metadata = arrowMetadata;
    }
    if (children && children.length > 0) {
      arrowObj.children = children.map(arrowToJson);
    }
    return arrowObj;
  }
  const arrows = collectArrows(body ?? undefined).map(arrowToJson);
  console.log(
    JSON.stringify(
      {
        name: canonicalEntityName(entry),
        ...(entry.namespace ? { namespace: entry.namespace } : {}),
        sources: entry.sources.map((s) => canonicalKey(s)),
        targets: entry.targets.map((t) => canonicalKey(t)),
        arrowCount: entry.arrowCount,
        topLevelArrowCount: arrows.length,
        ...(note != null ? { note } : {}),
        ...(metadata.length > 0 ? { metadata } : {}),
        arrows,
        file: entry.file,
        line: entry.row + 1,
      },
      null,
      2,
    ),
  );
}

function printArrowsOnly(entry: MappingRecord, mappingNode: SyntaxNode | null): void {
  const body = mappingNode?.namedChildren.find((c) => c.type === "mapping_body");
  if (body) {
    function printArrowsFlat(arrows: ArrowInfo[], prefix: string): void {
      for (const { src, tgt, children } of arrows) {
        const srcStr = src ? prefix + src : "(computed)";
        console.log(`${srcStr.padEnd(30)} -> ${prefix}${tgt}`);
        if (children) printArrowsFlat(children, prefix);
      }
    }
    printArrowsFlat(collectArrows(body), "");
  } else {
    // Fallback
    console.log(`${entry.sources.join(", ")} -> ${entry.targets.join(", ")}`);
  }
}

function printArrowNode(c: SyntaxNode, compact: boolean | undefined, indent: string): void {
  const src = c.namedChildren.find((x) => x.type === "src_path");
  const tgt = c.namedChildren.find((x) => x.type === "tgt_path");
  const pipeChain = c.namedChildren.find((x) => x.type === "pipe_chain");
  const arrowMeta = c.namedChildren.find((x) => x.type === "metadata_block");
  const srcStr = src ? pathText(src) : null;
  const tgtStr = pathText(tgt);
  const metaSuffix = arrowMeta && !compact ? ` ${arrowMeta.text}` : "";
  const srcPart = srcStr ? `${srcStr} -> ` : "-> ";

  // Check if this is a nested arrow with children
  const childArrows = c.namedChildren.filter(
    (x) => x.type === "map_arrow" || x.type === "computed_arrow" || x.type === "nested_arrow",
  );

  if (childArrows.length > 0) {
    console.log(`${indent}${srcPart}${tgtStr}${metaSuffix} {`);
    for (const child of childArrows) {
      printArrowNode(child, compact, indent + "  ");
    }
    console.log(`${indent}}`);
  } else {
    if (compact || !pipeChain) {
      console.log(`${indent}${srcPart}${tgtStr}${metaSuffix}`);
    } else {
      console.log(`${indent}${srcPart}${tgtStr}${metaSuffix} { ${pipeChain.text} }`);
    }
  }
}

function printBlockNode(c: SyntaxNode, compact: boolean | undefined, indent: string): void {
  const keyword = c.type === "flatten_block" ? "flatten" : "each";
  const src = c.namedChildren.find((x) => x.type === "src_path");
  const tgt = c.namedChildren.find((x) => x.type === "tgt_path");
  const meta = c.namedChildren.find((x) => x.type === "metadata_block");
  const srcStr = pathText(src);
  const tgtStr = pathText(tgt);
  const metaSuffix = meta && !compact ? ` ${meta.text}` : "";
  console.log(`${indent}${keyword} ${srcStr} -> ${tgtStr}${metaSuffix} {`);
  for (const child of c.namedChildren) {
    if (
      child.type === "map_arrow" ||
      child.type === "computed_arrow" ||
      child.type === "nested_arrow"
    ) {
      printArrowNode(child, compact, indent + "  ");
    }
  }
  console.log(`${indent}}`);
}

function printDefault(
  entry: MappingRecord,
  mappingNode: SyntaxNode | null,
  compact: boolean | undefined,
): void {
  // Use canonicalEntityName so the header includes the namespace prefix, e.g.
  // "mapping 'warehouse::load hub_store'" not "mapping 'load hub_store'" (sl-qofc).
  const nameStr = entry.name ? ` '${canonicalEntityName(entry)}'` : "";
  const metaNode = mappingNode?.namedChildren.find((c) => c.type === "metadata_block");
  const metaText = metaNode && !compact ? ` ${metaNode.text}` : "";
  console.log(`mapping${nameStr}${metaText} {`);

  const body = mappingNode?.namedChildren.find((c) => c.type === "mapping_body");
  if (body) {
    // source / target blocks
    const srcBlock = body.namedChildren.find((c) => c.type === "source_block");
    const tgtBlock = body.namedChildren.find((c) => c.type === "target_block");
    if (srcBlock)
      console.log(`  source { ${srcBlock.namedChildren.map((c) => c.text).join(", ")} }`);
    if (tgtBlock)
      console.log(`  target { ${tgtBlock.namedChildren.map((c) => c.text).join(", ")} }`);

    // Arrows and notes
    for (const c of body.namedChildren) {
      if (c.type === "note_block") {
        if (!compact) console.log(`  note { ... }`);
        continue;
      }
      if (c.type === "source_block" || c.type === "target_block") continue;

      if (c.type === "map_arrow" || c.type === "nested_arrow" || c.type === "computed_arrow") {
        printArrowNode(c, compact, "  ");
      } else if (c.type === "flatten_block" || c.type === "each_block") {
        printBlockNode(c, compact, "  ");
      }
    }
  } else {
    // Fallback from index
    console.log(`  source { ${entry.sources.join(", ")} }`);
    console.log(`  target { ${entry.targets.join(", ")} }`);
    console.log(`  // ${entry.arrowCount} arrows`);
  }

  console.log("}");
}

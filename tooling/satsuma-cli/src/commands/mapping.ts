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

// ── Arrow tree ───────────────────────────────────────────────────────────────
//
// Every output mode renders the same tree, built by one recursive CST walk,
// so the modes cannot disagree about which arrows a mapping holds. A separate
// text-only walk once lost each/flatten blocks nested in each/flatten
// (bsw-an3y). An arrow keeps every `src_path`, not just the first, so
// `a, b -> c` shows both inputs (bsw-fbd8).
//
// Why not core's extractMappingArrowRecords? Its records are flat and carry
// absolute, backtick-stripped paths — the right shape for lineage and coverage.
// This command shows the mapping as the author wrote it: relative paths,
// backticks kept (DISCOVERED-REQUIREMENTS: backticks must never be stripped)
// and the nesting intact, so it reads the authored text straight from the CST.

/** Arrow kinds that are list blocks; their kind doubles as the keyword printed before them. */
type ListBlockKind = "each" | "flatten";

/** Separator between the sources of a multi-source arrow, as written in Satsuma. */
const SOURCE_SEPARATOR = ", ";

/** Column width the --arrows-only table pads the source column to. */
const ARROWS_ONLY_SOURCE_WIDTH = 30;

/** One arrow declaration in a mapping body, with any arrows nested in it. */
interface ArrowInfo {
  /** `map`, `computed`, `nested` (an arrow whose braces hold arrows), `each` or `flatten`. */
  kind: "map" | "computed" | ListBlockKind | "nested";
  /** Every source path as authored, in order; empty for a computed arrow. */
  srcs: string[];
  /** Target path as authored. */
  tgt: string;
  /** The transform body, when the arrow has one. */
  pipeChain: SyntaxNode | undefined;
  /** The arrow's `( ... )` metadata, when present. */
  metaNode: SyntaxNode | undefined;
  /** Arrows declared inside this one's braces; absent when there are none. */
  children?: ArrowInfo[];
}

/** Authored text of a path node, backticks included; "?" when the node is missing. */
function pathText(pathNode: SyntaxNode | undefined): string {
  return pathNode ? pathNode.text : "?";
}

/**
 * Build the arrow tree for the declarations directly inside `container` (a
 * mapping body, nested arrow, or each/flatten block), recursing into every
 * nested container at any depth. Non-arrow children are skipped.
 */
function collectArrows(container: SyntaxNode | undefined): ArrowInfo[] {
  if (!container) return [];
  return container.namedChildren.map(arrowInfo).filter((info): info is ArrowInfo => info !== null);
}

/** The arrow tree rooted at `node`, or null when `node` is not an arrow declaration. */
function arrowInfo(node: SyntaxNode): ArrowInfo | null {
  const kind = arrowKind(node);
  if (!kind) return null;
  const children = kind === "map" || kind === "computed" ? [] : collectArrows(node);
  return {
    // A nested arrow with nothing in its braces says no more than a plain map.
    kind: kind === "nested" && children.length === 0 ? "map" : kind,
    srcs: node.namedChildren.filter((x) => x.type === "src_path").map((x) => pathText(x)),
    tgt: pathText(node.namedChildren.find((x) => x.type === "tgt_path")),
    pipeChain: node.namedChildren.find((x) => x.type === "pipe_chain"),
    metaNode: node.namedChildren.find((x) => x.type === "metadata_block"),
    ...(children.length > 0 ? { children } : {}),
  };
}

/** The arrow kind a CST node declares, or null when it is not an arrow. */
function arrowKind(node: SyntaxNode): ArrowInfo["kind"] | null {
  switch (node.type) {
    case "map_arrow":
      return "map";
    case "computed_arrow":
      return "computed";
    case "nested_arrow":
      return "nested";
    case "each_block":
      return "each";
    case "flatten_block":
      return "flatten";
    default:
      return null;
  }
}

/** The sources joined as Satsuma writes them: `a, b`. */
function sourcesText(info: ArrowInfo): string {
  return info.srcs.join(SOURCE_SEPARATOR);
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

/**
 * One arrow as JSON. `srcs` lists every source; `src` is kept as the first
 * source (null for a computed arrow) so readers written before multi-source
 * support keep working (bsw-fbd8).
 */
function arrowToJson(info: ArrowInfo, compact: boolean | undefined): Record<string, unknown> {
  const { kind, srcs, tgt, pipeChain, metaNode, children } = info;
  const pipeSteps = pipeChain
    ? [...pipeChain.namedChildren].filter((x) => x.type === "pipe_step")
    : [];
  const classification = classifyTransform(pipeSteps.length > 0 ? pipeSteps : null);
  const arrowObj: Record<string, unknown> = {
    kind,
    src: srcs[0] ?? null,
    srcs,
    tgt,
    hasTransform: pipeChain != null,
    classification,
  };
  if (!compact) {
    if (pipeChain) arrowObj.transform = pipeChain.text;
    const arrowMetadata = extractMetadata(metaNode);
    if (arrowMetadata.length > 0) arrowObj.metadata = arrowMetadata;
  }
  if (children) arrowObj.children = children.map((child) => arrowToJson(child, compact));
  return arrowObj;
}

function printJson(entry: MappingRecord, mappingNode: SyntaxNode | null, compact?: boolean): void {
  const body = mappingNode?.namedChildren.find((c) => c.type === "mapping_body");
  const metaNode = mappingNode?.namedChildren.find((c) => c.type === "metadata_block");
  const metadata = compact ? [] : extractMetadata(metaNode);
  const noteBlock = body?.namedChildren.find((c) => c.type === "note_block");
  const note = compact ? null : extractNoteText(noteBlock);
  const arrows = collectArrows(body).map((info) => arrowToJson(info, compact));
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
  if (!body) {
    // Fallback when the block cannot be found in the CST: schema-level summary.
    console.log(`${entry.sources.join(", ")} -> ${entry.targets.join(", ")}`);
    return;
  }
  const printFlat = (arrows: ArrowInfo[]): void => {
    for (const info of arrows) {
      const srcStr = info.srcs.length > 0 ? sourcesText(info) : "(computed)";
      console.log(`${srcStr.padEnd(ARROWS_ONLY_SOURCE_WIDTH)} -> ${info.tgt}`);
      if (info.children) printFlat(info.children);
    }
  };
  printFlat(collectArrows(body));
}

/**
 * Print one arrow, and everything nested in it, as Satsuma text at `indent`.
 * each/flatten blocks always keep their braces; a nested arrow opens braces
 * only when it holds arrows. --compact drops transform bodies and metadata.
 */
function printArrow(info: ArrowInfo, compact: boolean | undefined, indent: string): void {
  const metaSuffix = info.metaNode && !compact ? ` ${info.metaNode.text}` : "";
  const keyword = info.kind === "each" || info.kind === "flatten" ? `${info.kind} ` : "";
  const srcPart = info.srcs.length > 0 ? `${sourcesText(info)} -> ` : "-> ";
  const head = `${indent}${keyword}${srcPart}${info.tgt}${metaSuffix}`;

  if (keyword || info.children) {
    console.log(`${head} {`);
    for (const child of info.children ?? []) printArrow(child, compact, indent + "  ");
    console.log(`${indent}}`);
  } else if (info.pipeChain && !compact) {
    console.log(`${head} { ${info.pipeChain.text} }`);
  } else {
    console.log(head);
  }
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

    // Arrows and notes, in document order; a note's body is elided.
    for (const c of body.namedChildren) {
      if (c.type === "note_block") {
        if (!compact) console.log(`  note { ... }`);
        continue;
      }
      const info = arrowInfo(c);
      if (info) printArrow(info, compact, "  ");
    }
  } else {
    // Fallback from index
    console.log(`  source { ${entry.sources.join(", ")} }`);
    console.log(`  target { ${entry.targets.join(", ")} }`);
    console.log(`  // ${entry.arrowCount} arrows`);
  }

  console.log("}");
}

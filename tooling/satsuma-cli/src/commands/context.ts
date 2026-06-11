/**
 * context.js — `satsuma context <query>` command
 *
 * Given free-text, scores all workspace blocks by relevance and emits the
 * highest-scoring blocks within a token budget.
 *
 * Scoring (additive, higher = more relevant):
 *   +10  name contains a query term (case-insensitive)
 *   + 5  any field name contains a query term
 *   + 2  note text contains a query term
 *   + 1  any metadata key/value contains a query term
 *
 * Token estimate: Math.ceil(text.length / 4)  (rough GPT-style token count)
 *
 * Flags:
 *   --budget <n>   token budget (default 4000)
 *   --compact      omit notes and transform bodies in emitted blocks
 *   --json         emit ranked list as JSON (no budget truncation)
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, EXIT_NOT_FOUND } from "../command-runner.js";
import { parsePositiveInt } from "../option-parsers.js";
import { extractAtRefs } from "../nl-ref-extract.js";
import { extractNLContent } from "../nl-extract.js";
import { expandEntityFields } from "../spread-expand.js";
import type { ExtractedWorkspace, ParsedFile, SyntaxNode, FieldDecl } from "../types.js";

interface ScoredCandidate {
  name: string;
  type: string;
  score: number;
  file: string;
  /** 1-indexed source line number. */
  line: number;
}

export function register(program: Command): void {
  program
    .command("context <query> [path]")
    .description("Rank and emit blocks relevant to a query from a Satsuma file and its imports")
    .option("--budget <n>", "token budget", parsePositiveInt, 4000)
    .option("--compact", "omit notes and transform bodies")
    .option("--json", "emit ranked JSON list")
    .addHelpText("after", `
Scores blocks by keyword relevance: block name (+10), field names (+5),
notes (+2), metadata (+1). Emits highest-scoring blocks within the token
budget (~4 chars per token). --json bypasses the budget and emits all scores.

Examples:
  satsuma context "customer mapping"                 # blocks about customers
  satsuma context "loyalty tier" --budget 8000       # larger context window
  satsuma context "pii email" --compact              # compact output
  satsuma context "order" --json                     # all scores as JSON`)
    .action(runCommand(async (query: string, pathArg: string | undefined, opts: { budget: number; compact?: boolean; json?: boolean }) => {
      const { files: parsedFiles, index } = await loadWorkspace(pathArg);

      const terms = tokenize(query);
      const candidates = scoreAll(index, terms, parsedFiles);
      candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

      if (opts.json) {
        console.log(
          JSON.stringify(
            candidates.map(({ name, type, score, file, line }) => ({
              name,
              type,
              score,
              file,
              line,
            })),
            null,
            2,
          ),
        );
        return;
      }

      // Emit within token budget
      const budget = opts.budget;
      let used = 0;
      const emitted: Array<ScoredCandidate & { block: string }> = [];

      for (const c of candidates) {
        const block = renderBlock(index, c, opts.compact);
        const tokens = estimateTokens(block);
        if (used + tokens > budget && emitted.length > 0) break;
        used += tokens;
        emitted.push({ ...c, block });
      }

      if (emitted.length === 0) {
        console.log("No relevant blocks found.");
        return EXIT_NOT_FOUND;
      }

      console.log(`// Context for: ${query}  (${used} tokens, ${emitted.length} blocks)`);
      console.log();
      for (const { block } of emitted) {
        console.log(block);
        console.log();
      }
    }));
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/** Split query into lowercase terms, filtering stop words. */
function tokenize(query: string): string[] {
  const stop = new Set(["a", "an", "the", "to", "for", "in", "of", "and", "or", "is"]);
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 1 && !stop.has(t));
}

/** Score a string against terms — returns number of term hits. */
function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t)).length;
}

/**
 * Score all blocks in the index against terms.
 * Returns [{name, type, score, file, line}]
 */
function scoreAll(index: ExtractedWorkspace, terms: string[], parsedFiles: ParsedFile[]): ScoredCandidate[] {
  const results: ScoredCandidate[] = [];

  // Collect NL content (comments, notes) grouped by parent block name
  const nlByParent = new Map<string, string[]>();
  for (const { tree } of parsedFiles) {
    const items = extractNLContent(tree.rootNode);
    for (const item of items) {
      if (!item.parent) continue;
      if (!nlByParent.has(item.parent)) nlByParent.set(item.parent, []);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
      nlByParent.get(item.parent)!.push(item.text);
    }
  }

  // Collect metadata text (tags, kv pairs) grouped by parent block name
  const metaByParent = new Map<string, string[]>();
  // Collect raw block text for full-text keyword search
  const rawTextByBlock = new Map<string, string>();
  for (const { tree } of parsedFiles) {
    collectMetadataText(tree.rootNode, null, metaByParent);
    collectRawBlockText(tree.rootNode, null, rawTextByBlock);
  }

  const scoreEntry = (name: string, type: string, entry: { note?: string | null; fields?: Array<{ name: string; type: string }>; sources?: string[]; targets?: string[]; file: string; row: number }) => {
    let score = 0;
    score += scoreText(name, terms) * 10;
    if (entry.note) score += scoreText(entry.note, terms) * 2;
    if (entry.fields) {
      for (const f of entry.fields) {
        score += scoreText(f.name, terms) * 5;
        score += scoreText(f.type, terms);
      }
    }
    if (entry.sources) {
      for (const s of entry.sources) score += scoreText(s, terms);
    }
    if (entry.targets) {
      for (const t of entry.targets) score += scoreText(t, terms);
    }
    // Score NL content (comments, notes) attributed to this block
    const bareName = name.includes("::") ? name.slice(name.indexOf("::") + 2) : name;
    const nlTexts = nlByParent.get(name) ?? nlByParent.get(bareName) ?? [];
    for (const text of nlTexts) {
      score += scoreText(text, terms) * 2;
    }
    // Score metadata tags/values attributed to this block
    const metaTexts = metaByParent.get(name) ?? metaByParent.get(bareName) ?? [];
    for (const text of metaTexts) {
      score += scoreText(text, terms);
    }
    // Score raw block text (catches language keywords like flatten, list_of, governance)
    const rawText = rawTextByBlock.get(name) ?? rawTextByBlock.get(bareName) ?? "";
    if (rawText) {
      score += scoreText(rawText, terms);
    }
    if (score > 0) {
      results.push({ name, type, score, file: entry.file, line: entry.row + 1 });
    }
  };

  for (const [name, e] of index.schemas) scoreEntry(name, "schema", e);
  for (const [name, e] of index.metrics) scoreEntry(name, "metric", e);
  for (const [name, e] of index.mappings) scoreEntry(name, "mapping", e);
  for (const [name, e] of index.fragments) scoreEntry(name, "fragment", e);
  for (const [name, e] of index.transforms) scoreEntry(name, "transform", e);

  // Boost mappings that contain NL @ref markers matching query terms
  if (index.nlRefData) {
    // Group NL ref data by mapping key
    const nlByMapping = new Map<string, typeof index.nlRefData>();
    for (const item of index.nlRefData) {
      const key = item.namespace ? `${item.namespace}::${item.mapping}` : item.mapping;
      if (!nlByMapping.has(key)) nlByMapping.set(key, []);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
      nlByMapping.get(key)!.push(item);
    }

    for (const [mappingKey, items] of nlByMapping) {
      // Collect all @ref texts for this mapping
      const refTexts: string[] = [];
      for (const item of items) {
        for (const { ref } of extractAtRefs(item.text)) {
          refTexts.push(ref);
        }
      }
      if (refTexts.length === 0) continue;

      const nlScore = refTexts.reduce((sum, ref) => sum + scoreText(ref, terms) * 3, 0);
      if (nlScore > 0) {
        const existing = results.find((r) => r.name === mappingKey);
        if (existing) {
          existing.score += nlScore;
        } else {
          const m = index.mappings.get(mappingKey);
          if (m) {
            results.push({ name: mappingKey, type: "mapping", score: nlScore, file: m.file, line: m.row + 1 });
          }
        }
      }
    }
  }

  return results;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Render a block as a compact string for output. */
function renderBlock(index: ExtractedWorkspace, candidate: ScoredCandidate, compact?: boolean): string {
  const { name, type } = candidate;
  const lines: string[] = [];

  if (type === "schema") {
    const s = index.schemas.get(name);
    const note = s?.note && !compact ? `  (note "${s.note}")` : "";
    lines.push(`schema ${name}${note} {`);
    // Include fields from fragment spreads
    const spreadFields = s ? expandEntityFields(s, s.namespace ?? null, index) : [];
    const allFields: FieldDecl[] = [...(s?.fields ?? []), ...spreadFields];
    const maxLen = Math.max(24, ...allFields.map((f) => f.name.length + 1));
    for (const f of allFields) lines.push(`  ${f.name.padEnd(maxLen)}${f.type}`);
    lines.push("}");
  } else if (type === "metric") {
    const m = index.metrics.get(name);
    const display = m?.displayName ? ` "${m.displayName}"` : "";
    lines.push(`metric ${name}${display} {`);
    const maxLen = Math.max(20, ...((m?.fields ?? []).map((f) => f.name.length + 1)));
    for (const f of m?.fields ?? []) lines.push(`  ${f.name.padEnd(maxLen)}${f.type}`);
    lines.push("}");
  } else if (type === "mapping") {
    const m = index.mappings.get(name);
    lines.push(`mapping '${name}' {`);
    if (m?.sources?.length) lines.push(`  source { ${m.sources.join(", ")} }`);
    if (m?.targets?.length) lines.push(`  target { ${m.targets.join(", ")} }`);
    lines.push(`  // ${m?.arrowCount ?? 0} arrows`);
    lines.push("}");
  } else if (type === "fragment") {
    const f = index.fragments.get(name);
    lines.push(`fragment '${name}' {`);
    const maxLen = Math.max(24, ...((f?.fields ?? []).map((fld) => fld.name.length + 1)));
    for (const fld of f?.fields ?? []) lines.push(`  ${fld.name.padEnd(maxLen)}${fld.type}`);
    lines.push("}");
  } else if (type === "transform") {
    lines.push(`transform ${name} { ... }`);
  }

  return lines.join("\n");
}

// ── Metadata collection ──────────────────────────────────────────────────────

// metric_block is removed — metrics are now schema_block nodes with the `metric` tag.
const BLOCK_TYPES = new Set([
  "schema_block", "mapping_block",
  "fragment_block", "transform_block",
]);

function getBlockName(node: SyntaxNode): string | null {
  const label = node.namedChildren.find((c) => c.type === "block_label");
  if (!label) return null;
  const inner = label.namedChildren[0];
  if (!inner) return label.text;
  if (inner.type === "backtick_name") return inner.text.slice(1, -1);
  if (inner.type === "qualified_name") {
    const ids = inner.namedChildren.filter((c) => c.type === "identifier");
    return ids.map((id) => id.text).join("::");
  }
  return inner.text;
}

/**
 * Walk the CST and collect raw block text grouped by block name.
 * Used for full-text keyword search (flatten, list_of, governance, etc.).
 */
function collectRawBlockText(node: SyntaxNode, _parent: string | null, result: Map<string, string>): void {
  for (const c of node.namedChildren) {
    if (BLOCK_TYPES.has(c.type)) {
      const name = getBlockName(c);
      if (name) {
        result.set(name, c.text);
      }
    }
    if (c.type === "namespace_block") {
      collectRawBlockText(c, null, result);
    }
  }
}

/**
 * Walk the CST and collect metadata_block text grouped by parent block name.
 */
function collectMetadataText(node: SyntaxNode, parent: string | null, result: Map<string, string[]>): void {
  for (const c of node.namedChildren) {
    let newParent = parent;
    if (BLOCK_TYPES.has(c.type)) {
      newParent = getBlockName(c);
    }
    if (c.type === "metadata_block" && newParent) {
      if (!result.has(newParent)) result.set(newParent, []);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
      result.get(newParent)!.push(c.text);
    }
    collectMetadataText(c, newParent, result);
  }
}

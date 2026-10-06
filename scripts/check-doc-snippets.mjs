#!/usr/bin/env node
/**
 * check-doc-snippets.mjs — validates the Satsuma snippets the tutorials and
 * lessons teach, so a reader who copies one gets a mapping the tooling accepts.
 *
 * GitHub issue #525 is why this exists. The BA tutorial and lessons 07 and 14
 * all taught `Order.OrderId -> order_id` inside `flatten Order.LineItems`, which
 * spec §4.4 resolves to `Order.LineItems.Order.OrderId` — a field that does not
 * exist. Nothing checked the snippets, so the docs drifted from the spec and a
 * reader found out from a validator warning on their own work.
 *
 * Most doc snippets are fragments (a lone arrow, a schema with `...`), which no
 * validator can judge. So the check is opt-in, by an HTML comment on the line
 * before the fence. Markdown renderers hide the comment, so readers never see it:
 *
 *   <!-- satsuma-check: standalone -->
 *   <!-- satsuma-check: schemas from examples/xml-to-parquet/pipeline.stm -->
 *   <!-- satsuma-check: schemas from earlier snippets -->
 *   <!-- satsuma-check: skip — <why this snippet cannot be checked> -->
 *
 * Every form but `skip` validates the snippet through the CLI and fails on any
 * finding. `standalone` validates it alone. `schemas from <file>` first adds
 * every top-level schema and fragment declared in that file (repo-relative);
 * `schemas from earlier snippets` adds those declared in the same document's
 * preceding snippets, for guides that build a model up step by step. Only
 * declarations are borrowed — never mappings — so a snippet can reuse a mapping
 * name its context already uses.
 *
 * The opt-in has one teeth-bearing rule: a snippet that parses as a complete
 * mapping containing an `each` or `flatten` block must carry an annotation.
 * Nested paths are where #525's drift happened, so those snippets cannot be
 * left unchecked by accident.
 *
 * This module does not own the validation rules themselves — it shells out to
 * the built CLI, which is the tool a reader would run. It needs a built
 * workspace (`npm run build:all`).
 *
 * Run standalone with `node scripts/check-doc-snippets.mjs`; it is also
 * exercised by `npm run test:scripts` via check-doc-snippets.test.mjs.
 */

import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { initParser, getParser } from "@satsuma/core";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------- Configuration ----------

/** Directories (repo-relative) whose Markdown teaches Satsuma to readers. */
export const DOC_DIRS = ["docs/tutorials", "docs/nested-data", "lessons"];

/** Fenced code blocks with this info string are Satsuma snippets. */
const SATSUMA_FENCE = "```satsuma";

/** The annotation comment; group 1 is the directive after the colon. */
const ANNOTATION = /^<!--\s*satsuma-check:\s*(.*?)\s*-->$/;

/** Directive validating a snippet with no borrowed declarations. */
const STANDALONE = "standalone";

/** Directive borrowing declarations from the same document's preceding snippets. */
const EARLIER_SNIPPETS = "schemas from earlier snippets";

/** Directive naming the file whose declarations a snippet is validated against. */
const SCHEMAS_FROM = /^schemas from (\S+)$/;

/** Directive opting a snippet out; a reason after the keyword is mandatory. */
const SKIP = /^skip\b\s*[—:-]?\s*(\S.*)$/;

/**
 * Top-level declarations borrowed from a context file. Mappings and transforms
 * are deliberately excluded so the snippet's own mapping is the only one.
 */
const CONTEXT_NODE_TYPES = new Set(["schema_block", "fragment_block"]);

/** Block types whose paths are container-relative (spec §4.4), the #525 hazard. */
const NESTING_NODE_TYPES = new Set(["each_block", "flatten_block"]);

const GRAMMAR_WASM = join(repoRoot, "tooling", "tree-sitter-satsuma", "tree-sitter-satsuma.wasm");
const CLI_ENTRY = join(repoRoot, "tooling", "satsuma-cli", "dist", "index.js");

// ---------- Snippet extraction ----------

/**
 * Finds every ```satsuma fenced block in a Markdown document.
 *
 * Returns `{ line, code, annotation }` per block: `line` is the 1-based line of
 * the opening fence, `code` the block body, and `annotation` the parsed
 * directive from the nearest non-blank line above the fence — `null` when there
 * is none, `{ kind: "standalone" }`, `{ kind: "earlier" }`,
 * `{ kind: "schemas", contextPath }`, `{ kind: "skip", reason }`, or
 * `{ kind: "invalid", text }` for a comment that matches no form.
 */
export function extractSnippets(markdown) {
  const lines = markdown.split("\n");
  const snippets = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== SATSUMA_FENCE) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim() === "```");
    if (end === -1) break;
    snippets.push({
      line: i + 1,
      code: lines.slice(i + 1, end).join("\n") + "\n",
      annotation: annotationAbove(lines, i),
    });
    i = end;
  }
  return snippets;
}

/** Parses the satsuma-check comment on the nearest non-blank line above `fenceIndex`. */
function annotationAbove(lines, fenceIndex) {
  let k = fenceIndex - 1;
  while (k >= 0 && lines[k].trim() === "") k--;
  const match = k >= 0 ? ANNOTATION.exec(lines[k].trim()) : null;
  if (!match) return null;
  const directive = match[1];
  if (directive === STANDALONE) return { kind: "standalone" };
  if (directive === EARLIER_SNIPPETS) return { kind: "earlier" };
  const schemas = SCHEMAS_FROM.exec(directive);
  if (schemas) return { kind: "schemas", contextPath: schemas[1] };
  const skip = SKIP.exec(directive);
  if (skip) return { kind: "skip", reason: skip[1] };
  return { kind: "invalid", text: directive };
}

// ---------- Classification ----------

/**
 * True when `code` parses cleanly and contains a mapping with an each/flatten
 * block — the snippets that must be annotated. Fragments that do not parse are
 * exempt: they are illustrations, not mappings a reader could run.
 */
export function isCompleteNestedMapping(code) {
  const root = getParser().parse(code).rootNode;
  if (root.hasError) return false;
  return root.namedChildren.some((n) => n.type === "mapping_block" && containsNesting(n));
}

function containsNesting(node) {
  return NESTING_NODE_TYPES.has(node.type) || node.namedChildren.some(containsNesting);
}

/**
 * Concatenates the schema and fragment declarations of a Satsuma source. When a
 * name is declared more than once — a guide that refines a schema across
 * snippets — only the last declaration is kept, as a reader would understand it.
 */
export function contextDeclarations(source) {
  const root = getParser().parse(source).rootNode;
  const byName = new Map();
  for (const node of root.namedChildren.filter((n) => CONTEXT_NODE_TYPES.has(n.type))) {
    const label = node.namedChildren.find((c) => c.type === "block_label")?.text;
    byName.delete(label);
    byName.set(label, node.text);
  }
  return [...byName.values()].join("\n\n");
}

// ---------- Validation ----------

/**
 * Validates one snippet against its context file's declarations via the CLI.
 * Returns the CLI's findings with `line` translated back into the snippet, so a
 * failure points at the line the doc author has to fix.
 */
export function validateWithContext(code, contextSource) {
  const context = contextDeclarations(contextSource) + "\n\n";
  const offset = context.split("\n").length - 1;
  const dir = mkdtempSync(join(tmpdir(), "satsuma-doc-snippet-"));
  try {
    const file = join(dir, "snippet.stm");
    writeFileSync(file, context + code);
    const run = spawnSync(process.execPath, [CLI_ENTRY, "validate", "--json", file], {
      encoding: "utf8",
    });
    if (!run.stdout) throw new Error(`satsuma validate produced no output: ${run.stderr}`);
    return JSON.parse(run.stdout).findings.map((f) => ({ ...f, line: f.line - offset }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Checks every snippet in DOC_DIRS. Returns a list of human-readable problems,
 * each prefixed with `doc:line`; an empty list means the docs are sound.
 */
export function checkDocSnippets(root = repoRoot) {
  const problems = [];
  for (const dir of DOC_DIRS) {
    for (const name of readdirSync(join(root, dir))
      .filter((n) => n.endsWith(".md"))
      .sort()) {
      const doc = `${dir}/${name}`;
      const snippets = extractSnippets(readFileSync(join(root, doc), "utf8"));
      snippets.forEach((snippet, i) => {
        const earlier = snippets
          .slice(0, i)
          .map((s) => s.code)
          .join("\n");
        problems.push(...checkSnippet(root, doc, snippet, earlier));
      });
    }
  }
  return problems;
}

/** Problems for one snippet; `earlier` is the concatenated code of the snippets above it. */
function checkSnippet(root, doc, { line, code, annotation }, earlier) {
  const at = `${doc}:${line}`;
  if (annotation === null) {
    return isCompleteNestedMapping(code)
      ? [
          `${at}: mapping with each/flatten has no satsuma-check annotation — add "schemas from <file>" or "skip — <reason>"`,
        ]
      : [];
  }
  if (annotation.kind === "invalid")
    return [`${at}: unrecognised satsuma-check directive "${annotation.text}"`];
  if (annotation.kind === "skip") return [];
  return validateWithContext(code, contextFor(root, annotation, earlier)).map(
    (f) => `${at}: snippet line ${f.line}: ${f.severity} [${f.rule}] ${f.message}`,
  );
}

/** The Satsuma source whose declarations a validated snippet borrows. */
function contextFor(root, annotation, earlier) {
  if (annotation.kind === "standalone") return "";
  if (annotation.kind === "earlier") return earlier;
  return readFileSync(join(root, annotation.contextPath), "utf8");
}

/** Loads the grammar; call once before anything that parses. */
export async function initSnippetParser() {
  await initParser(GRAMMAR_WASM);
}

// ---------- Entry point ----------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await initSnippetParser();
  const problems = checkDocSnippets();
  for (const p of problems) console.error(p);
  console.log(
    problems.length === 0 ? "All checked doc snippets validate." : `${problems.length} problem(s).`,
  );
  process.exit(problems.length === 0 ? 0 : 1);
}

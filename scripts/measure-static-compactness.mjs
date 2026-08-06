#!/usr/bin/env node
/**
 * measure-static-compactness.mjs — Feature 44's static-compactness measurement,
 * arms S, Y and J.
 *
 * The site claims Satsuma is "40-60% smaller than YAML" in seven places. The
 * claim cites "our v3", a YAML design that predates this repository and exists
 * nowhere in it, so nobody can check the number. This script replaces it with a
 * measured one:
 *
 *   - arm S: the `.stm` source as authored
 *   - arm Y: the same facts as YAML   (see evals/static-compactness/SERIALISATION-DESIGN.md)
 *   - arm J: the same facts as JSON
 *
 * **Why these three arms and not the spreadsheet arm.** Feature 44's PRD builds
 * `MappingIntent` and a blind pairing audit because a spreadsheet authored from
 * a `.stm` is "causally downstream" of it — it inherits Satsuma's structural
 * discipline and every ambiguity the `.stm` author already resolved. YAML and
 * JSON are not that. "Equivalent YAML" *means* a mechanical re-serialisation of
 * identical content, so deriving arms Y and J from the corpus is the correct
 * method rather than a compromise, and these arms need no `MappingIntent`.
 * Arms X (spreadsheet), M (markdown) and C (CSV) still do, and are not measured
 * here. See the PRD's static-compactness acceptance criterion, which names
 * arms S/X/M/Y/J/C: this script satisfies S/Y/J only.
 *
 * **Why the ratio is a lower bound.** The YAML design is deliberately charitable
 * to YAML — as terse as a competent author plausibly would write. A verbose YAML
 * schema would manufacture a win, which is the same failure the PRD identifies
 * for spreadsheet serialisation ("not a measurement, a rhetorical device").
 *
 * Run via `npm run measure:static-compactness`. Requires a built workspace
 * (`npm run build:all`), because it parses the corpus with the real grammar.
 *
 * Writes reference/static-compactness.json and reference/static-compactness.md.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser, getParser, isSatsumaFilePath } from "@satsuma/core";
import {
  countTokens,
  TOKENIZER_ID,
  countAnthropicTokens,
  ANTHROPIC_TOKENIZER_ID,
} from "../reference/token-cost.mjs";
import { projectSpec, stripPlainComments } from "./static-compactness-model.mjs";
import { renderYaml, renderJson } from "./static-compactness-render.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** The corpus measured. Every immediate subdirectory is one spec (one workspace). */
const CORPUS_ROOT = join(repoRoot, "examples");

/** The grammar the corpus is parsed with — the shipped WASM, never a native build (ADR-002). */
const GRAMMAR_WASM = join(repoRoot, "tooling", "tree-sitter-satsuma", "tree-sitter-satsuma.wasm");

/**
 * Feature 45's measured resident cost of the portable `AI-AGENT-REFERENCE.md`
 * blob, read rather than restated so the two measurements cannot drift.
 *
 * The PRD requires this overhead be charged to the Satsuma arm: an agent that
 * can read YAML unaided needs the reference in context to read `.stm`. It is
 * a per-context constant, not a per-spec cost, so on a small spec it can
 * exceed the spec itself and flip the result — that crossover is a finding,
 * not a defect.
 */
function readReferenceOverheadTokens() {
  const costs = JSON.parse(readFileSync(join(repoRoot, "reference", "token-costs.json"), "utf8"));
  const measured = costs.tokenizers?.[TOKENIZER_ID]?.wholeDocument;
  if (typeof measured !== "number") {
    throw new Error(
      `measure-static-compactness: reference/token-costs.json has no ${TOKENIZER_ID} ` +
        `wholeDocument figure. Regenerate it with npm run measure:agent-reference-tokens.`,
    );
  }
  return measured;
}

// ── Corpus discovery ───────────────────────────────────────────────────────

/** Returns every `.stm` file under `dir`, recursively, sorted for stable output. */
function findSatsumaFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...findSatsumaFiles(path));
    else if (isSatsumaFilePath(path)) found.push(path);
  }
  return found;
}

/**
 * Discovers the corpus as a list of specs, one per immediate subdirectory of
 * `examples/`.
 *
 * A directory is the unit rather than a file because a spec's imports, schemas
 * and mappings routinely span several files, and measuring one file of a
 * multi-file workspace would compare a fragment against a whole.
 */
function discoverCorpus() {
  const specs = [];
  for (const entry of readdirSync(CORPUS_ROOT).sort()) {
    const dir = join(CORPUS_ROOT, entry);
    if (!statSync(dir).isDirectory()) continue;
    const files = findSatsumaFiles(dir);
    if (files.length === 0) continue;
    specs.push({ name: entry, dir, files });
  }
  return specs;
}

// ── Measuring one spec ─────────────────────────────────────────────────────

/**
 * Measures one spec across all three arms.
 *
 * Arm S is the authored source of every `.stm` file in the spec, concatenated
 * — that is exactly what an agent handed the workspace reads. Arms Y and J
 * render the projection of those same files, so all three carry identical
 * facts by construction.
 */
/**
 * Renders one spec's three arms once, so every tokenizer measures the same
 * bytes rather than re-parsing and re-rendering per tokenizer.
 */
function renderSpecArms(spec) {
  const documents = spec.files.map((file) => {
    const source = readFileSync(file, "utf8");
    const root = getParser().parse(source).rootNode;
    return {
      path: relative(repoRoot, file),
      source,
      sourceWithoutComments: stripPlainComments(source, root),
      model: projectSpec(root),
    };
  });
  return {
    // The like-for-like Satsuma arm: comment-free, as both other arms are.
    S: documents.map((d) => d.sourceWithoutComments).join("\n"),
    // The same file as authored, comments and all — reported alongside so the
    // comment policy is visible rather than an unstated thumb on the scale.
    Sauthored: documents.map((d) => d.source).join("\n"),
    Y: renderYaml(documents),
    J: renderJson(documents),
  };
}

/**
 * Measures one spec's already-rendered arms under one tokenizer.
 *
 * `count` may be sync (`o200k_base`) or async (the Anthropic endpoint); both
 * are awaited uniformly. A `count` that returns `null` for any arm means that
 * tokenizer is unavailable, and the caller drops it rather than reporting a
 * partial section.
 */
async function measureSpec(spec, texts, count) {
  const arms = {};
  for (const [arm, text] of Object.entries(texts)) {
    const measured = await count(text);
    if (measured === null || measured === undefined) return null;
    arms[arm] = measured;
  }
  return {
    name: spec.name,
    fileCount: spec.files.length,
    lineCount: texts.Sauthored.split("\n").length,
    arms,
  };
}

/**
 * Derives the reported ratios for one measured spec.
 *
 * `reductionVsYaml` is the site's claim restated exactly: the percentage by
 * which `.stm` is smaller than the equivalent YAML. `withReference` charges the
 * agent-reference overhead to the Satsuma arm and is the honest figure for an
 * agent context; `bare` is the artifact-only figure. Both are reported because
 * they answer different questions and the PRD insists the difference between
 * artifact size and consumption not be blurred.
 */
function deriveRatios(measured) {
  const { S, Sauthored, Y, J } = measured.arms;
  const pct = (satsuma, other) => Number((((other - satsuma) / other) * 100).toFixed(1));
  return {
    // The headline: how much smaller `.stm` is than the same facts as YAML.
    vsYaml: pct(S, Y),
    vsJson: pct(S, J),
    // The same comparison against the file exactly as authored.
    authoredVsYaml: pct(Sauthored, Y),
    // Tokens saved on this spec — the figure the agent-reference overhead has
    // to be repaid out of.
    savingVsYaml: Y - S,
  };
}

// ── Reporting ──────────────────────────────────────────────────────────────

/**
 * Renders the committed human-readable report.
 *
 * Every figure is per tokenizer and never averaged across tokenizers — the PRD
 * is explicit that different tokenizers give materially different ratios on
 * dense-punctuation input, and a single averaged number would hide that.
 */
function renderReport({ tokenizers, characters, referenceOverhead, corpusSize }) {
  const lines = [
    "# Static compactness — `.stm` against equivalent YAML and JSON",
    "",
    "Generated by `npm run measure:static-compactness`. Do not hand-edit — a rerun",
    "after any change to the corpus, the grammar or the serialisation design will",
    "overwrite this file.",
    "",
    "This is Feature 44's static-compactness measurement for **arms S, Y and J only**.",
    "Arms X (spreadsheet), M (markdown) and C (CSV-per-sheet) are not measured here:",
    "they need the `MappingIntent` pairing machinery, because a spreadsheet authored",
    "from a `.stm` is causally downstream of it. YAML and JSON are mechanical",
    "re-serialisations of identical content, so they need no such control.",
    "",
    "The YAML design is deliberately **charitable to YAML** — see",
    "[evals/static-compactness/SERIALISATION-DESIGN.md](../evals/static-compactness/SERIALISATION-DESIGN.md).",
    "Every ratio below is therefore a **lower bound** on Satsuma's advantage.",
    "",
    `Corpus: ${corpusSize} specs under \`examples/\`.`,
    "",
    "## Which tokenizers these figures carry",
    "",
    `Reported per tokenizer and never averaged: ${Object.keys(tokenizers)
      .map((id) => `\`${id}\``)
      .join(", ")}.`,
    "Different tokenizers give materially different ratios on dense punctuation and",
    "identifiers, which is exactly what a `.stm` file is, so a single averaged number",
    "would hide that.",
    "",
    ...(Object.keys(tokenizers).length === 1
      ? [
          "`o200k_base` is a real frontier tokenizer — it is what OpenAI's current models",
          "use — but it is only one, and Anthropic's is proprietary with no offline",
          "implementation. **Set `ANTHROPIC_API_KEY` and rerun** to add a second,",
          "independently-built tokenizer to this report.",
          "",
          "Until then the character counts below are the cross-check: they involve no",
          "tokenizer at all, so a conclusion that holds in both is not an artifact of one",
          "vendor's vocabulary.",
          "",
        ]
      : []),
    "## What the reference overhead is",
    "",
    "An agent reading YAML needs no help. An agent reading `.stm` needs the agent",
    `reference in context, measured by Feature 45 at **${referenceOverhead} tokens** for`,
    "the portable blob (`reference/token-costs.json`). It is a per-*context* constant,",
    "not a per-spec cost, so it is charged once at the corpus level below rather than",
    "restated as a meaningless percentage against each spec.",
    "",
  ];

  for (const [tokenizerId, specs] of Object.entries(tokenizers)) {
    lines.push(
      `## ${tokenizerId}`,
      "",
      "All three arms are comment-free, so the comparison is like-for-like. The",
      "`.stm as authored` column keeps the `//` comments the real file carries.",
      "",
      "| Spec | Lines | `.stm` | …as authored | YAML | JSON | vs YAML | vs JSON |",
      "|---|---:|---:|---:|---:|---:|---:|---:|",
    );
    for (const spec of specs) {
      lines.push(
        `| \`${spec.name}\` | ${spec.lineCount} | ${spec.arms.S} | ${spec.arms.Sauthored} | ` +
          `${spec.arms.Y} | ${spec.arms.J} | ${spec.ratios.vsYaml}% | ${spec.ratios.vsJson}% |`,
      );
    }
    lines.push("", ...renderCorpusSummary(specs, referenceOverhead), "");
  }

  lines.push(
    "## Characters — the tokenizer-free cross-check",
    "",
    "Counted in characters rather than tokens, so no vocabulary is involved. If the",
    "token headline were an artifact of one tokenizer, these would disagree with it.",
    "",
    ...renderCorpusSummary(characters, referenceOverhead).slice(0, 6),
    "",
  );

  return lines.join("\n") + "\n";
}

/**
 * Summarises the corpus with the *median* per-spec ratio, not the ratio of
 * totals. The PRD calls the ratio-of-means error "the single most common error
 * in published comparisons of this kind"; summing tokens across the corpus and
 * dividing commits exactly that error, letting the largest spec set the
 * headline. The full-run protocol uses a geometric mean with a bootstrap CI —
 * that needs the paired instances Phase 1 produces, so the median is the
 * honest summary available here.
 */
function renderCorpusSummary(specs, referenceOverhead) {
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1))
      : sorted[mid];
  };
  const vsYaml = median(specs.map((s) => s.ratios.vsYaml));
  const vsJson = median(specs.map((s) => s.ratios.vsJson));
  const authored = median(specs.map((s) => s.ratios.authoredVsYaml));
  const yamlWins = specs.filter((s) => s.ratios.vsYaml < 0);
  const bestSaving = Math.max(...specs.map((s) => s.ratios.savingVsYaml));

  return [
    "### Corpus summary",
    "",
    `- Median reduction vs YAML: **${vsYaml}%**`,
    `- Median reduction vs JSON (2-space): **${vsJson}%**`,
    `- Median reduction vs YAML using the file as authored: **${authored}%**`,
    "",
    "Median of per-spec ratios, not the ratio of corpus totals — the latter lets the",
    "largest spec set the headline and systematically overstates the effect. The PRD",
    "calls that the single most common error in published comparisons of this kind.",
    "",
    `YAML is **smaller** than \`.stm\` on ${yamlWins.length} of ${specs.length} specs` +
      `${yamlWins.length > 0 ? ` (${yamlWins.map((s) => `\`${s.name}\``).join(", ")})` : ""}.`,
    "",
    "### The agent-reference overhead is never repaid",
    "",
    `The largest saving against YAML anywhere in this corpus is **${bestSaving} tokens**.`,
    `An agent reading \`.stm\` carries the agent reference, measured at`,
    `**${referenceOverhead} tokens** — so no spec here comes close to repaying it, and a`,
    `workspace would need a saving roughly ${Math.round(referenceOverhead / Math.max(bestSaving, 1))}x`,
    "the largest one observed before `.stm` broke even on size alone.",
    "",
    "Stated plainly: **static compactness is not a claim Satsuma can make against YAML.**",
    "That is a finding about artifact size only. It says nothing about what an agent",
    "*consumes* completing a task, which is a different quantity, dominated by agent",
    "loops rather than file size, and measured by this feature's behavioural arms.",
  ];
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  await initParser(GRAMMAR_WASM);
  const referenceOverhead = readReferenceOverheadTokens();
  const corpus = discoverCorpus();

  // Render every arm once; each tokenizer then measures the same bytes.
  const rendered = corpus.map((spec) => ({ spec, texts: renderSpecArms(spec) }));

  const measureAll = async (count) => {
    const specs = [];
    for (const { spec, texts } of rendered) {
      const result = await measureSpec(spec, texts, count);
      if (result === null) return null;
      specs.push({ ...result, ratios: deriveRatios(result) });
    }
    return specs;
  };

  const tokenizers = { [TOKENIZER_ID]: await measureAll(countTokens) };

  // A second, independently-built tokenizer is what stops the headline resting
  // on one vendor's vocabulary. It needs a key and a network call, so its
  // absence narrows the report rather than failing it — and the report says
  // which tokenizers it actually carries.
  const anthropic = await measureAll(countAnthropicTokens);
  if (anthropic === null) {
    console.log(
      "measure-static-compactness: ANTHROPIC_API_KEY not set (or the call failed) — " +
        `reporting ${TOKENIZER_ID} only. Set the key and rerun for a second tokenizer.`,
    );
  } else {
    tokenizers[ANTHROPIC_TOKENIZER_ID] = anthropic;
  }

  // Characters involve no tokenizer at all, so they are the cheapest check that
  // the headline is not an artifact of one vendor's vocabulary.
  const characters = await measureAll((text) => text.length);

  writeFileSync(
    join(repoRoot, "reference", "static-compactness.json"),
    JSON.stringify({ referenceOverhead, tokenizers, characters }, null, 2) + "\n",
  );
  writeFileSync(
    join(repoRoot, "reference", "static-compactness.md"),
    renderReport({ tokenizers, characters, referenceOverhead, corpusSize: corpus.length }),
  );

  console.log(
    "measure-static-compactness: wrote reference/static-compactness.json and " +
      "reference/static-compactness.md",
  );
}

export { discoverCorpus, measureSpec, deriveRatios, renderCorpusSummary };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

#!/usr/bin/env node
/**
 * measure-agent-reference-tokens.mjs — Feature 45's real-tokenizer measurement.
 *
 * The Feature 45 PRD's Background section originally reported every section
 * and profile's size as a bytes/4 estimate, and its Non-goals section
 * asserted — without measuring — that eagerly-injected MCP tool schemas
 * would be the worst option on the resident-cost axis. This script replaces
 * both with real numbers:
 *
 *   - Per-section, per-profile, and whole-document token counts under a real
 *     tokenizer (`o200k_base` via `js-tiktoken` — see reference/token-cost.mjs),
 *     plus the Anthropic count-tokens endpoint when `ANTHROPIC_API_KEY` is set.
 *   - The *resident* vs *loaded* cost of each delivery envelope this feature
 *     ships (CLI, portable blob, skill), stated explicitly rather than left
 *     implicit.
 *   - A comparison point (not a shipped feature): what it would cost to expose
 *     every CLI command as an eagerly-injected MCP tool schema, built from the
 *     same command registrations `index.ts` loads at startup.
 *
 * Run via `npm run measure:agent-reference-tokens`. Requires the CLI to be
 * built first (`npm run build:all` or `turbo run build --filter=satsuma-cli`),
 * because the MCP-schema comparison introspects the real command
 * registrations under `tooling/satsuma-cli/dist/`, not a hand-maintained copy
 * of what each command's flags are.
 *
 * Writes reference/token-costs.json (machine-readable) and
 * reference/token-costs.md (the human-readable report Feature 45's PRD links
 * to instead of restating these numbers inline).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { composeFull, composeProfile, loadSections } from "../reference/compose.mjs";
import { countTokens, TOKENIZER_ID } from "../reference/token-cost.mjs";
import { PROFILES } from "../reference/manifest.mjs";
import { FRONTMATTER as SKILL_FRONTMATTER } from "./regenerate-satsuma-language-skill.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// ── MCP tool-schema comparison: describe each command from its real registration ──

/**
 * Extracts a plain-data description of the one subcommand a command module
 * registers, by actually calling `register()` against a throwaway Commander
 * program. This reads the same options/description a user sees from
 * `--help` — never a hand-maintained restatement of them — so the MCP
 * comparison cannot silently drift from the real CLI surface.
 */
function describeRegisteredCommand(register) {
  const program = new Command();
  register(program);
  const [cmd] = program.commands;
  return {
    name: cmd.name(),
    description: cmd.description(),
    args: (cmd.registeredArguments ?? []).map((arg) => ({
      name: arg.name(),
      required: arg.required,
      description: arg.description || undefined,
    })),
    options: cmd.options.map((opt) => ({
      key: opt.attributeName(),
      takesValue: /[<[]/.test(opt.flags),
      description: opt.description || undefined,
    })),
  };
}

/**
 * Builds a tool-use-style JSON schema for one command — the shape an MCP
 * server or Anthropic tool definition would ship, so its serialized size is
 * a fair stand-in for what an eagerly-injected tool schema costs.
 */
export function buildToolSchema({ name, description, args, options }) {
  const properties = {};
  const required = [];
  for (const arg of args) {
    properties[arg.name] = {
      type: "string",
      ...(arg.description && { description: arg.description }),
    };
    if (arg.required) required.push(arg.name);
  }
  for (const opt of options) {
    properties[opt.key] = {
      type: opt.takesValue ? "string" : "boolean",
      ...(opt.description && { description: opt.description }),
    };
  }
  return {
    name: `satsuma_${name.replace(/[^a-z0-9_]/gi, "_")}`,
    description,
    input_schema: { type: "object", properties, ...(required.length > 0 && { required }) },
  };
}

/**
 * Loads every registered command from the built CLI and returns its
 * MCP-style schema. `command-loader.js` is imported dynamically, from
 * `dist/`, rather than statically at module scope: a static import would
 * make every consumer of this module — including this file's own unit
 * tests, which exercise {@link buildToolSchema} against hand-built fixtures
 * and need no build at all — fail unless the CLI happened to be built first.
 */
async function loadMcpToolSchemas() {
  const distDir = join(repoRoot, "tooling", "satsuma-cli", "dist");
  const loaderPath = join(distDir, "command-loader.js");
  const { COMMAND_MODULES, commandModuleSpecifier } = await import(
    pathToFileURL(loaderPath).href
  ).catch(() => {
    throw new Error(
      `measure-agent-reference-tokens: could not load ${loaderPath}. ` +
        "Build the CLI first: npm run build:all (or turbo run build --filter=satsuma-cli).",
    );
  });
  const schemas = [];
  for (const modulePath of COMMAND_MODULES) {
    const { register } = await import(commandModuleSpecifier(distDir, modulePath));
    schemas.push(buildToolSchema(describeRegisteredCommand(register)));
  }
  return schemas;
}

// ── Optional second tokenizer: the Anthropic count-tokens endpoint ──

const ANTHROPIC_COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
// Any current Claude model reports the same tokenizer's count for a given
// string; the choice of model here does not change the number.
const ANTHROPIC_COUNT_TOKENS_MODEL = "claude-sonnet-4-5";

/**
 * Counts `text`'s tokens via the Anthropic API, or returns `null` if no API
 * key is configured or the call fails. This tokenizer is a nice-to-have per
 * the PRD ("too, if ANTHROPIC_API_KEY is available") — its absence must
 * never fail the measurement, only narrow which tokenizers get reported.
 */
async function countAnthropicTokens(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch(ANTHROPIC_COUNT_TOKENS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_COUNT_TOKENS_MODEL,
        messages: [{ role: "user", content: text }],
      }),
    });
    if (!response.ok) return null;
    const { input_tokens } = await response.json();
    return input_tokens ?? null;
  } catch {
    return null;
  }
}

// ── Assembling the report ──

/**
 * Measures every section, profile, and the whole document under one
 * tokenizer's `count` function. `count` may be async (the Anthropic path) or
 * sync (`o200k_base`) — both are awaited uniformly here.
 */
async function measureReferenceContent(sections, count) {
  const perSection = {};
  for (const section of sections) {
    perSection[section.id] = await count(section.content);
  }
  const perProfile = {};
  for (const profile of PROFILES) {
    perProfile[profile] = await count(composeProfile(sections, profile));
  }
  const wholeDocument = await count(composeFull(sections));
  return { perSection, perProfile, wholeDocument };
}

/**
 * The resident-vs-loaded cost of each envelope Feature 45 ships, plus the
 * MCP comparison point. "Resident" is what a session pays before the
 * content is ever used; "loaded" is what it additionally pays once it is.
 *
 *   - cli: nothing is resident — `agent-reference` is pull-based. "Loaded" is
 *     whichever section/profile/whole-document figure the caller requested,
 *     already reported above, so it is not repeated here.
 *   - portable-blob: `AI-AGENT-REFERENCE.md` pasted into a system prompt has
 *     no lazy option — the whole document is resident for the entire
 *     session whether or not any of it is used.
 *   - skill: only the frontmatter `description` is resident; the composed
 *     body is loaded on top of that once the skill actually triggers.
 *   - mcp: a comparison point, not a shipped envelope (see the PRD's
 *     Non-goals). Every command's schema is resident for every request,
 *     whether or not that tool is called in it.
 */
async function measureEnvelopes({ wholeDocument, skillBody, mcpSchemas }, count) {
  const mcpSchemaTokens = await Promise.all(
    mcpSchemas.map((schema) => count(JSON.stringify(schema))),
  );
  const mcpResident = mcpSchemaTokens.reduce((sum, n) => sum + n, 0);
  const skillResident = await count(SKILL_FRONTMATTER);
  const skillLoaded = skillResident + (await count(skillBody));
  return {
    cli: { resident: 0, loaded: "on demand — see per-section/profile figures above" },
    "portable-blob": { resident: wholeDocument, loaded: wholeDocument },
    skill: { resident: skillResident, loaded: skillLoaded },
    "mcp-comparison": {
      resident: mcpResident,
      loaded: mcpResident,
      commandCount: mcpSchemas.length,
    },
  };
}

async function main() {
  const sections = loadSections();
  const mcpSchemas = await loadMcpToolSchemas();
  // The skill's body is everything after its own frontmatter block — read
  // from the real shipped file, not reconstructed, so this measurement can
  // never drift from what regenerate-satsuma-language-skill.mjs actually wrote.
  const skillFile = readFileSync(join(repoRoot, "skills", "satsuma-language", "SKILL.md"), "utf8");
  const skillBody = skillFile.slice(SKILL_FRONTMATTER.length);

  const tokenizers = {};

  tokenizers[TOKENIZER_ID] = {
    ...(await measureReferenceContent(sections, (text) => countTokens(text))),
  };
  tokenizers[TOKENIZER_ID].envelopes = await measureEnvelopes(
    { wholeDocument: tokenizers[TOKENIZER_ID].wholeDocument, skillBody, mcpSchemas },
    (text) => countTokens(text),
  );

  const anthropicWholeDoc = await countAnthropicTokens(composeFull(sections));
  if (anthropicWholeDoc === null) {
    console.log(
      "measure-agent-reference-tokens: ANTHROPIC_API_KEY not set (or the call failed) — " +
        "reporting o200k_base only, per the PRD's 'if available' requirement.",
    );
  } else {
    tokenizers["anthropic-claude-sonnet-4-5"] = {
      ...(await measureReferenceContent(sections, countAnthropicTokens)),
    };
    tokenizers["anthropic-claude-sonnet-4-5"].envelopes = await measureEnvelopes(
      { wholeDocument: anthropicWholeDoc, skillBody, mcpSchemas },
      countAnthropicTokens,
    );
  }

  writeFileSync(
    join(repoRoot, "reference", "token-costs.json"),
    JSON.stringify({ sectionOrder: sections.map((s) => s.id), tokenizers }, null, 2) + "\n",
  );
  writeFileSync(join(repoRoot, "reference", "token-costs.md"), renderReport(sections, tokenizers));

  console.log(
    "measure-agent-reference-tokens: wrote reference/token-costs.json and reference/token-costs.md",
  );
}

/** Renders the committed, human-readable report from the measured data. */
function renderReport(sections, tokenizers) {
  const lines = [
    "# AI Agent Reference — measured token costs",
    "",
    "Generated by `npm run measure:agent-reference-tokens`. Do not hand-edit — a",
    "rerun after any change to `reference/*.md` or the CLI's command surface",
    "will overwrite this file.",
    "",
    "See [archive/features/45-agent-reference-progressive-disclosure/PRD.md]" +
      "(../archive/features/45-agent-reference-progressive-disclosure/PRD.md) for what " +
      "these figures replace and why they're measured rather than estimated.",
    "",
  ];

  for (const [tokenizerId, data] of Object.entries(tokenizers)) {
    lines.push(`## ${tokenizerId}`, "", "### Per section", "", "| Section | Tokens |", "|---|---|");
    for (const section of sections) {
      lines.push(`| \`${section.id}\` | ${data.perSection[section.id]} |`);
    }
    lines.push(
      "",
      "### Per profile",
      "",
      "| Profile | Tokens |",
      "|---|---|",
      ...Object.entries(data.perProfile).map(
        ([profile, tokens]) => `| \`${profile}\` | ${tokens} |`,
      ),
      "",
      `### Whole document: ${data.wholeDocument} tokens`,
      "",
      "### Envelope resident vs loaded cost",
      "",
      "| Envelope | Resident | Loaded |",
      "|---|---|---|",
      ...Object.entries(data.envelopes).map(
        ([envelope, { resident, loaded }]) => `| \`${envelope}\` | ${resident} | ${loaded} |`,
      ),
      "",
    );
    const mcp = data.envelopes["mcp-comparison"];
    lines.push(
      `The MCP comparison point covers ${mcp.commandCount} command schemas, resident on ` +
        "every request whether or not the tool is called — see the PRD's Non-goals section.",
      "",
    );
  }

  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

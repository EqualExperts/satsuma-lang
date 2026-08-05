#!/usr/bin/env node
/**
 * regenerate-satsuma-language-skill.mjs — rebuild skills/satsuma-language/SKILL.md.
 *
 * The satsuma-language skill is Feature 45's lazy-loading envelope: its
 * frontmatter `description` is the only part an agent runtime keeps resident
 * before the skill triggers (a few dozen tokens); the body is the full AI
 * Agent Reference, loaded only once the skill actually fires. The body is
 * composed from reference/*.md via reference/compose.mjs — never
 * hand-restated — so it cannot drift from the CLI's own `agent-reference`
 * output or the generated AI-AGENT-REFERENCE.md portable blob.
 *
 * Edit FRONTMATTER below for skill metadata, or a canonical section under
 * reference/ for content, then run:
 *
 *   node scripts/regenerate-satsuma-language-skill.mjs
 *
 * scripts/agent-reference-compose.test.mjs's sibling assertions (see the
 * "envelope drift" tests added for arpd-f3xm) fail `npm run test:scripts`
 * if this file's body and the canonical sections disagree.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeFull, loadSections } from "../reference/compose.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outPath = join(repoRoot, "skills", "satsuma-language", "SKILL.md");

// Hand-authored skill metadata — the only part of this file that is not
// composed from reference/. Kept small deliberately: this is exactly the
// "resident" cost a skill-aware harness pays before the skill triggers.
const FRONTMATTER = `---
name: satsuma-language
description: >
  Reference for writing or reading Satsuma (.stm) data-mapping files —
  grammar, authoring conventions, common mistakes, the \`satsuma\` CLI's
  command surface, and workflow patterns for both generating and
  interpreting mappings. Use whenever the user asks about Satsuma syntax or
  semantics, wants to write or generate a .stm mapping from a description or
  spreadsheet, or wants to read, trace, audit, or reason about an existing
  Satsuma workspace (lineage, impact analysis, coverage, PII audit) — with or
  without the \`satsuma\` CLI on PATH.
license: MIT
metadata:
  author: satsuma
  version: "1.0"
---
`;

// No heading here: the composed content below opens with its own single H1
// ("# Satsuma — AI Agent Reference"), and markdownlint's MD025 requires
// exactly one per document.
const INTRO = `
> This is the full AI Agent Reference — the same content \`satsuma
> agent-reference\` prints and \`AI-AGENT-REFERENCE.md\` carries, composed here
> as a lazy-loading skill body (Feature 45). It is generated from the
> canonical sections under \`reference/\` — see \`reference/manifest.mjs\` —
> and must never be hand-edited directly.

---

`;

writeFileSync(outPath, FRONTMATTER + INTRO + composeFull(loadSections()));

console.log(
  "regenerate-satsuma-language-skill: wrote skills/satsuma-language/SKILL.md from reference/*.md",
);

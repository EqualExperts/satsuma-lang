#!/usr/bin/env node
/**
 * regenerate-agent-reference.mjs — rebuild AI-AGENT-REFERENCE.md from reference/.
 *
 * AI-AGENT-REFERENCE.md is the "portable blob" envelope from Feature 45's
 * design: the full AI Agent Reference, in one file, for the no-CLI web-LLM
 * path that useful-prompts/ serves and for anyone browsing the repo on
 * GitHub. It is generated, not hand-authored — editing it directly will be
 * overwritten the next time this script runs. Edit the canonical section
 * under reference/ instead, then run:
 *
 *   node scripts/regenerate-agent-reference.mjs
 *
 * scripts/agent-reference-compose.test.mjs is the drift guard: it fails
 * `npm run test:scripts` (part of the pre-commit hook) if this file and the
 * canonical sections disagree, so a hand-edit or a missed regeneration
 * cannot silently ship.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeFull, loadSections } from "../reference/compose.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outPath = join(repoRoot, "AI-AGENT-REFERENCE.md");

writeFileSync(outPath, composeFull(loadSections()));

console.log("regenerate-agent-reference: wrote AI-AGENT-REFERENCE.md from reference/*.md");

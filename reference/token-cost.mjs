/**
 * reference/token-cost.mjs — the one place that turns text into a token count.
 *
 * Feature 45's PRD set out to replace every bytes/4 estimate in its tables
 * with a measured number. Two call sites need that measurement and must
 * agree on it: the CLI's prebuild step (bakes a per-section cost into
 * `agent-reference --list`) and scripts/measure-agent-reference-tokens.mjs
 * (the full per-section/profile/envelope report, including the MCP-schema
 * comparison point). Counting in one module means those two can't drift
 * into reporting different numbers for the same text.
 *
 * o200k_base (via `js-tiktoken`) is the baseline tokenizer used everywhere in
 * this repo's own measurements: it is real subword tokenization rather than
 * an approximation, and — unlike the Anthropic count-tokens endpoint that
 * scripts/measure-agent-reference-tokens.mjs also reports when available —
 * it needs no network call or API key, so it is always available.
 */

import { getEncoding } from "js-tiktoken";

/** The tokenizer every baked and reported count in this repo is measured with. */
export const TOKENIZER_ID = "o200k_base";

// Building the encoder loads and indexes ~200k BPE merge ranks — worth doing
// once per process, not once per call.
let cachedEncoding;
function encoding() {
  if (!cachedEncoding) cachedEncoding = getEncoding(TOKENIZER_ID);
  return cachedEncoding;
}

/** Counts `text`'s tokens under {@link TOKENIZER_ID}. */
export function countTokens(text) {
  return encoding().encode(text).length;
}

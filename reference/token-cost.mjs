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

// ── The second tokenizer: Anthropic's, via the count-tokens endpoint ────────
//
// o200k_base is a real frontier tokenizer — it is what OpenAI's current models
// use — but it is only one, and Anthropic's is proprietary with no offline
// implementation. Any measurement reported as a *ratio* between two texts wants
// more than one tokenizer behind it, because vocabularies differ most exactly
// where this repo's inputs live: dense punctuation and identifiers. Reported
// per tokenizer and never averaged, so a difference between them stays visible.

/** Identifier used for the Anthropic figures in committed reports. */
export const ANTHROPIC_TOKENIZER_ID = "anthropic-claude-sonnet-4-5";

const ANTHROPIC_COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
// Any current Claude model reports the same tokenizer's count for a given
// string; the choice of model here does not change the number.
const ANTHROPIC_COUNT_TOKENS_MODEL = "claude-sonnet-4-5";

/**
 * Counts `text`'s tokens via the Anthropic API, or returns `null` when no API
 * key is configured or the call fails.
 *
 * Returning `null` rather than throwing is deliberate: this tokenizer needs a
 * network call and a key, so its absence must narrow which tokenizers a report
 * carries, never fail the measurement. Callers check for `null` and say so in
 * their output rather than silently reporting one tokenizer as if it were all
 * of them.
 */
export async function countAnthropicTokens(text) {
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

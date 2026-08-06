/**
 * token-cost.test.mjs — unit coverage for reference/token-cost.mjs, the one
 * module in this repo that turns text into a token count.
 *
 * Two callers depend on it (`measure-agent-reference-tokens.mjs` and
 * `measure-static-compactness.mjs`), and both publish committed figures, so the
 * properties worth pinning are the ones that would silently change a published
 * number or fail a measurement outright.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { countTokens, countAnthropicTokens, TOKENIZER_ID } from "../reference/token-cost.mjs";

test("counts with o200k_base, so committed figures across scripts stay comparable", () => {
  // Every published figure in this repo — Feature 45's reference costs and
  // Feature 44's compactness ratios — is measured with this tokenizer. If the
  // identifier or the encoder changed, two reports that claim to be comparable
  // would silently stop being so.
  assert.equal(TOKENIZER_ID, "o200k_base");
  assert.equal(countTokens("hello world"), 2);
});

test("a missing Anthropic key narrows the report rather than failing the measurement", async () => {
  // The Anthropic tokenizer needs a network call and a key, so it cannot be a
  // hard dependency of a measurement that must run offline and in CI. Returning
  // null is the contract callers branch on to drop that section and say which
  // tokenizers the report actually carries; throwing would take the whole
  // measurement down whenever the key is absent.
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(await countAnthropicTokens("hello world"), null);
  } finally {
    if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
  }
});

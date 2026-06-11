/**
 * option-parsers.ts — Shared coercion functions for Commander option values.
 *
 * Owns the argument-validation layer that sits between the raw CLI string
 * and a command handler: a handler that declares `--depth <n>` through one
 * of these parsers can trust it receives a number in range, never NaN.
 *
 * Why this exists (sl-bvd0): the numeric options used bare `parseInt`, so
 * `--depth banana` became NaN and `--budget banana` silently disabled the
 * budget — garbage input changed behaviour instead of failing. Throwing
 * Commander's InvalidArgumentError here makes bad values surface as a
 * standard usage error (message + help via showHelpAfterError, exit 1),
 * the same way Commander reports an unknown option.
 *
 * This module owns option *coercion* only — exit policy for handler
 * failures stays in command-runner.ts.
 */

import { InvalidArgumentError } from "commander";

// Strictly positive decimal integers only. Anchored so trailing garbage
// ("12abc") and signs/decimals ("-1", "3.5") are rejected rather than
// silently truncated by parseInt.
const POSITIVE_INT_PATTERN = /^[0-9]+$/;

/**
 * Commander coercion for options that must be a positive integer (>= 1),
 * such as `--depth` and `--budget`. Zero is rejected: a zero depth or
 * budget would make the command emit nothing, which is never what the
 * user meant.
 *
 * @param value  raw option value as typed on the command line.
 * @returns the parsed integer.
 * @throws InvalidArgumentError for anything that is not a whole number >= 1.
 */
export function parsePositiveInt(value: string): number {
  const parsed = POSITIVE_INT_PATTERN.test(value) ? parseInt(value, 10) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("Expected a positive whole number (1 or greater).");
  }
  return parsed;
}

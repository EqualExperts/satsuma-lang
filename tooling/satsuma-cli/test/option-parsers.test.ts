/**
 * option-parsers.test.ts — Coverage for shared Commander option coercions.
 *
 * Unit-tests the parsePositiveInt contract once, then verifies through the
 * built CLI that each numeric option (--depth, --budget) is actually wired
 * through the parser — regression coverage for sl-bvd0, where bare parseInt
 * let garbage values silently change command behaviour (NaN depth printed
 * only the start node; NaN budget disabled the budget entirely).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidArgumentError } from "commander";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePositiveInt, parsePercentage } from "../src/option-parsers.js";
import { run as runCli } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const LINEAGE_CHAIN = resolve(__dirname, "fixtures/lineage-chain.stm");
const PLATFORM = resolve(__dirname, "fixtures/platform.stm");

const run = (...args: string[]) => runCli(CLI, ...args);

describe("parsePositiveInt", () => {
  it("parses positive whole numbers", () => {
    // The happy path must return a real number, not a string, so handlers
    // can use it directly in depth/budget arithmetic.
    assert.equal(parsePositiveInt("1"), 1);
    assert.equal(parsePositiveInt("4000"), 4000);
  });

  it("rejects values that are not whole numbers >= 1", () => {
    // Each rejected shape was previously accepted by bare parseInt:
    // "banana" -> NaN, "-1" -> -1, "0" -> 0, "12abc" -> 12, "3.5" -> 3.
    // All must now raise Commander's usage error instead of silently
    // changing behaviour.
    for (const bad of ["banana", "-1", "0", "12abc", "3.5", ""]) {
      assert.throws(
        () => parsePositiveInt(bad),
        InvalidArgumentError,
        `expected "${bad}" to be rejected`,
      );
    }
  });
});

describe("numeric options reject garbage as a usage error", () => {
  it("lineage --depth banana exits non-zero with an invalid-argument message", async () => {
    // Before sl-bvd0 this printed only the start node and exited 0.
    const { stderr, code } = await run(
      "lineage",
      "--from",
      "source_a",
      "--depth",
      "banana",
      LINEAGE_CHAIN,
    );

    assert.notEqual(code, 0);
    assert.match(stderr, /option '--depth <n>' argument 'banana' is invalid/);
  });

  it("field-lineage --depth -1 exits non-zero with an invalid-argument message", async () => {
    // Negative depths previously walked nothing and annotated the start node [?].
    const { stderr, code } = await run(
      "field-lineage",
      "schema_b.field_b",
      "--depth",
      "-1",
      LINEAGE_CHAIN,
    );

    assert.notEqual(code, 0);
    assert.match(stderr, /option '--depth <n>' argument '-1' is invalid/);
  });

  it("context --budget 0 exits non-zero with an invalid-argument message", async () => {
    // A NaN/zero budget previously disabled budgeting and emitted all blocks.
    const { stderr, code } = await run("context", "customer", "--budget", "0", PLATFORM);

    assert.notEqual(code, 0);
    assert.match(stderr, /option '--budget <n>' argument '0' is invalid/);
  });
});

describe("parsePercentage", () => {
  it("accepts the full 0-100 range, including both boundaries", () => {
    // 0 must be accepted: a pipeline that computes its own --fail-under
    // threshold can legitimately arrive at zero, and rejecting it would break
    // the boundary case rather than the mistake.
    assert.equal(parsePercentage("0"), 0);
    assert.equal(parsePercentage("71"), 71);
    assert.equal(parsePercentage("100"), 100);
  });

  it("rejects a threshold above 100", () => {
    // A gate no coverage figure can ever satisfy is a typo, not a policy.
    assert.throws(() => parsePercentage("101"), InvalidArgumentError);
  });

  it("rejects non-integer and non-numeric values rather than truncating them", () => {
    // Bare parseInt would turn "90.5" into 90 and "ninety" into NaN, silently
    // gating on a threshold the caller never asked for (the sl-bvd0 shape).
    for (const bad of ["90.5", "ninety", "-1", "", "90abc"]) {
      assert.throws(
        () => parsePercentage(bad),
        InvalidArgumentError,
        `expected "${bad}" to be rejected`,
      );
    }
  });
});

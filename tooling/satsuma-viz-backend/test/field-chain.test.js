/**
 * field-chain.test.js — browser-side field lineage over in-memory sources.
 *
 * The semantic walk is core's and is tested there. These tests pin the backend
 * adapter: import scoping, endpoint qualification, NL resolution, and parity
 * with the CLI's checked-in JSON contract.
 */

const fs = require("node:fs");
const path = require("node:path");
const { before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser } = require("./helper");
const { buildFieldChainFromSources } = require("../dist/field-chain");

const FIXTURE_DIRECTORY = path.join(__dirname, "fixtures");
const FIXTURE_URI = "file:///field-chain.stm";

before(async () => {
  await initTestParser();
});

/** Build a field chain from one virtual document. */
function chainFrom(source, field, options) {
  return buildFieldChainFromSources(
    "file:///workspace.stm",
    [{ uri: "file:///workspace.stm", source }],
    field,
    options,
  );
}

describe("field-chain model builder", () => {
  it("qualifies the focus and preserves ordered upstream and downstream hops", () => {
    // A browser host starts with the schema card's unprefixed qualifiedId. The
    // adapter must produce the same canonical names and BFS order as the CLI.
    const result = chainFrom(
      `
schema a { id string }
schema b { id string }
schema c { id string }
mapping ab { source { a } target { b } id -> id }
mapping bc { source { b } target { c } id -> id }
`,
      "b.id",
    );

    assert.deepEqual(result, {
      field: "::b.id",
      upstream: [{ field: "::a.id", via_mapping: "::ab", classification: "none" }],
      downstream: [{ field: "::c.id", via_mapping: "::bc", classification: "none" }],
    });
  });

  it("adds a distinct nl-derived hop for a field referenced only in prose", () => {
    // A resolved @ref is an implicit dependency that cannot be reconstructed
    // from declared arrow endpoints. Losing it is the critical adapter failure.
    const result = chainFrom(
      `
schema source_data {
  id string
  audit string
}
schema target_data { id string }
mapping load {
  source { source_data }
  target { target_data }
  id -> id { "checked against @source_data.audit" }
}
`,
      "target_data.id",
    );

    assert.deepEqual(result.upstream, [
      { field: "::source_data.id", via_mapping: "::load", classification: "nl" },
      {
        field: "::source_data.audit",
        via_mapping: "::load",
        classification: "nl-derived",
      },
    ]);
  });

  it("limits traversal by mapping depth while retaining the nearest hop", () => {
    // The public builder must forward its limit to core; silently ignoring it
    // would make a wide workspace expensive and contradict the CLI contract.
    const result = chainFrom(
      `
schema a { id string }
schema b { id string }
schema c { id string }
mapping ab { source { a } target { b } id -> id }
mapping bc { source { b } target { c } id -> id }
`,
      "c.id",
      { depth: 1, direction: "upstream" },
    );

    assert.deepEqual(result.upstream, [
      { field: "::b.id", via_mapping: "::bc", classification: "none" },
    ]);
    assert.deepEqual(result.downstream, []);
  });
});

describe("field-chain CLI parity golden", () => {
  it("matches checked-in field-lineage --json output byte-for-value", () => {
    // The golden is regenerated explicitly by scripts/regenerate-field-chain-golden.mjs.
    // This test deliberately makes no live CLI call or package dependency.
    const source = fs.readFileSync(path.join(FIXTURE_DIRECTORY, "field-chain.stm"), "utf8");
    const expected = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIRECTORY, "field-chain.json"), "utf8"),
    );
    const actual = buildFieldChainFromSources(
      FIXTURE_URI,
      [{ uri: FIXTURE_URI, source }],
      "curated.id",
    );

    assert.deepEqual(actual, expected);
  });
});

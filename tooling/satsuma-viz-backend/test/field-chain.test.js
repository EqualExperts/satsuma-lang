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
      maxDepth: 10,
      upstream: [{ field: "::a.id", via_mapping: "::ab", classification: "none", depth: 1 }],
      downstream: [{ field: "::c.id", via_mapping: "::bc", classification: "none", depth: 1 }],
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
      { field: "::source_data.id", via_mapping: "::load", classification: "nl", depth: 1 },
      {
        field: "::source_data.audit",
        via_mapping: "::load",
        classification: "nl-derived",
        depth: 1,
      },
    ]);
  });

  it("limits traversal by mapping depth while retaining the nearest hop", () => {
    // The public builder must forward its limit to core; silently ignoring it
    // would make a wide workspace expensive and contradict the CLI contract.
    // maxDepth must echo the caller's limit, not the core default, so a host
    // renderer can tell a boundary hop from a genuine dead end.
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
      { field: "::b.id", via_mapping: "::bc", classification: "none", depth: 1 },
    ]);
    assert.deepEqual(result.downstream, []);
    assert.equal(result.maxDepth, 1);
  });
});

describe("field-chain unknown-field resolution (sv-embb)", () => {
  it("marks the chain unresolved when the focus field names no declared schema", () => {
    // A typo'd or renamed schema must not be reported the same way as a
    // resolved field with genuinely empty lineage — the CLI throws
    // EXIT_NOT_FOUND for this case, so the browser/LSP builder must at least
    // flag it distinctly rather than returning a look-alike empty chain.
    const result = chainFrom("schema a { id string }", "nonexistent.id");

    assert.equal(result.resolved, false);
    assert.deepEqual(result.upstream, []);
    assert.deepEqual(result.downstream, []);
    assert.equal(result.field, "::nonexistent.id");
  });

  it("marks the chain unresolved when the schema exists but the field path does not", () => {
    const result = chainFrom("schema a { id string }", "a.nonexistent");

    assert.equal(result.resolved, false);
    assert.deepEqual(result.upstream, []);
    assert.deepEqual(result.downstream, []);
  });

  it("leaves the chain resolved (the key omitted) when the field genuinely has no lineage", () => {
    // The positive case this feature must not regress: a real, declared field
    // with no arrows touching it is "resolved, empty" — not "not found".
    const result = chainFrom("schema a { id string }", "a.id");

    assert.equal(result.resolved, undefined);
    assert.deepEqual(result.upstream, []);
    assert.deepEqual(result.downstream, []);
  });

  it("resolves a focus field that only exists because a fragment spread materialised it", () => {
    // Spread expansion is not optional here: without it, every field a
    // fragment contributes would be misreported as "not found" even though
    // `satsuma coverage` and the schema card both already treat it as real.
    const result = chainFrom(
      `
fragment address_fields { street string city string }
schema tgt { id string address record { ...address_fields } }
schema src { raw_city string }
mapping load { source { src } target { tgt } raw_city -> address.city }
`,
      "tgt.address.city",
    );

    assert.equal(result.resolved, undefined);
    assert.deepEqual(result.upstream, [
      { field: "::src.raw_city", via_mapping: "::load", classification: "none", depth: 1 },
    ]);
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

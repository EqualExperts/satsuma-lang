/**
 * coverage.test.js — LSP coverage adapter wiring.
 *
 * Coverage semantics are tested once, in satsuma-core/test/coverage.test.js
 * (sl-gsxu). What can only break here is the adapter: resolving a schema
 * reference through the LSP WorkspaceIndex, projecting FieldInfo onto core's
 * field shape, and mapping FieldInfo.range onto the line the gutter decorates.
 * These tests cover exactly that seam and nothing else.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");
const { computeMappingCoverage } = require("../dist/coverage");

before(async () => {
  await initTestParser();
});

/** Run computeMappingCoverage on a single-file source text. */
function coverage(source, mappingName, uri = "file:///test.stm") {
  const tree = parse(source);
  const idx = createWorkspaceIndex();
  indexFile(idx, uri, tree);
  return computeMappingCoverage(uri, tree, mappingName, idx);
}

const SRC = `schema src {
  id INT
  unused INT
}
schema tgt {
  id INT
  memo STRING
}
mapping load {
  source { src }
  target { tgt }
  id -> id
}`;

describe("LSP coverage adapter", () => {
  it("resolves both mapping sides through the workspace index", () => {
    // The adapter's job is index lookup; if resolveDefinition is wired wrongly
    // the gutter silently decorates nothing, with no error to trace.
    const result = coverage(SRC, "load");
    assert.deepEqual(
      result.schemas.map((s) => [s.role, s.schemaId]),
      [
        ["source", "src"],
        ["target", "tgt"],
      ],
    );
  });

  it("reports each field's declaration line and URI for gutter decoration", () => {
    // The overlay places markers at FieldCoverageEntry.line in the file named
    // by .uri, so this projection from FieldInfo.range is load-bearing.
    const tgt = coverage(SRC, "load").schemas.find((s) => s.role === "target");
    assert.deepEqual(
      tgt.fields.map((f) => [f.path, f.line, f.uri, f.mapped]),
      [
        ["id", 5, "file:///test.stm", true],
        ["memo", 6, "file:///test.stm", false],
      ],
    );
  });

  it("projects nested FieldInfo children onto nested coverage paths", () => {
    // FieldInfo nests differently from the CLI's FieldDecl; a dropped
    // children[] mapping would hide every nested field from the gutter.
    const src = `schema src {
  address record {
    line1 STRING
    line2 STRING
  }
}
schema tgt { addr STRING }
mapping load {
  source { src }
  target { tgt }
  address.line1 -> addr
}`;
    const source = coverage(src, "load").schemas.find((s) => s.role === "source");
    assert.deepEqual(
      source.fields.map((f) => [f.path, f.mapped]),
      [
        ["address", true],
        ["address.line1", true],
        ["address.line2", false],
      ],
    );
  });
});

// ── Fragment spreads (sl-5nsv) ──────────────────────────────────────────────
//
// The gutter and the status bar must show what `satsuma coverage` shows, and a
// spread is the case where they did not: the index records spreads unresolved
// (a spread may name a fragment in a file not indexed yet), and the adapter
// used to hand core the unexpanded tree — so `address record {
// ...address_fields }` reached the gutter as one childless leaf.
//
// The two fixtures are shared, deliberately, with the CLI suite
// (satsuma-cli/test/coverage.test.ts) and the viz-backend suite: same file,
// same expected leaves and totals in all three, so a divergence fails a test
// rather than showing up as two numbers on one reviewer's screen.

describe("LSP coverage adapter — fragment spreads", () => {
  const { readFileSync } = require("node:fs");
  const { resolve } = require("node:path");

  /** Fixtures live in the CLI package because the CLI suite asserts on them too. */
  const fixture = (name) =>
    readFileSync(resolve(__dirname, "../../satsuma-cli/test/fixtures", name), "utf8");

  it("reports the leaves a spread materialises inside a record body", () => {
    // The CLI reports 2/5 for this file with `address` partly covered; before
    // the adapter expanded spreads the gutter reported 1/3 with `address` fully
    // covered — the same file, two numbers, and the more flattering one wrong.
    const target = coverage(fixture("nested-record-spread.stm"), "customer_map").schemas.find(
      (s) => s.role === "target",
    );
    assert.deepEqual(
      target.fields.map((f) => [f.path, f.state]),
      [
        ["id", "uncovered"],
        ["name", "uncovered"],
        ["address", "partial"],
        ["address.street", "covered"],
        ["address.city", "covered"],
        ["address.zip", "uncovered"],
      ],
    );
  });

  it("reports them the same way inside a list_of record body", () => {
    // A list_of record is a container like any other. The CLI reports 2/4 here.
    const target = coverage(fixture("list-of-record-spread.stm"), "invoice_load").schemas.find(
      (s) => s.role === "target",
    );
    assert.deepEqual(
      target.fields.map((f) => [f.path, f.state]),
      [
        ["invoice_no", "covered"],
        ["lines", "partial"],
        ["lines.sku", "covered"],
        ["lines.qty", "uncovered"],
        ["lines.unit_price", "uncovered"],
      ],
    );
  });

  it("counts a field the body and a spread both declare exactly once", () => {
    // sl-qead, the gutter's half of the parity claim. `contact` writes out
    // `load_ts` and also spreads `...meta`, which declares it again. Two
    // decorations on one line is the visible symptom; the CLI reports 2/3 for
    // this file and the gutter must be counting the same three leaves.
    const target = coverage(fixture("redeclared-spread-field.stm"), "contact_load").schemas.find(
      (s) => s.role === "target",
    );
    assert.deepEqual(
      target.fields.map((f) => [f.path, f.state]),
      [
        ["id", "covered"],
        ["load_ts", "covered"],
        ["batch_id", "uncovered"],
      ],
    );
  });

  it("keeps two records spread from one fragment independently covered", () => {
    // The examples/lib/sfdc_fragments.stm shape. Both records materialise a
    // field named `Street` from the same fragment, so a coverage model keyed by
    // field *name* — or one that credited the fragment rather than the record
    // that spreads it — would report ShippingAddress.Street as mapped because
    // BillingAddress.Street is. Only the billing arrow exists (sl-joeq).
    const src = `fragment address_fields { Street STRING City STRING }
schema account {
  BillingAddress record { ...address_fields }
  ShippingAddress record { ...address_fields }
}
schema src { billing_street STRING }
mapping load {
  source { src }
  target { account }
  billing_street -> BillingAddress.Street
}`;
    const target = coverage(src, "load").schemas.find((s) => s.role === "target");
    assert.deepEqual(
      target.fields.map((f) => [f.path, f.state]),
      [
        ["BillingAddress", "partial"],
        ["BillingAddress.Street", "covered"],
        ["BillingAddress.City", "uncovered"],
        ["ShippingAddress", "uncovered"],
        ["ShippingAddress.Street", "uncovered"],
        ["ShippingAddress.City", "uncovered"],
      ],
    );
  });
});

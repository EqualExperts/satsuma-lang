/**
 * coverage-parity.test.js — The viz card and `satsuma coverage` report one number.
 *
 * Feature 36's overlay is only worth building if its figures equal the CLI's,
 * and that guarantee had no test that would fail if it broke (sl-5nsv). This
 * file supplies it on the viz side: parse a fixture, build the model through
 * `@satsuma/viz-backend` exactly as the VS Code host does, read the coverage the
 * card is given, and count it the way the card counts.
 *
 * The expected figures are the ones `satsuma coverage --json` prints for the
 * same files, asserted in satsuma-cli/test/coverage.test.ts, and the same leaves
 * the editor gutter reports, asserted in satsuma-lsp/test/coverage.test.js. One
 * fixture, three suites, one set of numbers — change one and the others fail.
 * satsuma-cli/test/coverage-viz-parity.test.ts extends the same guarantee across
 * every file in `examples/`, in one process; the cases here are the named rules,
 * kept close to the consumer that used to get them wrong.
 *
 * `@satsuma/viz-backend` is a devDependency here for exactly this: the runtime
 * dependency still runs component → core only, and nothing in the bundle
 * changes.
 */
import "./dom-shim.js";
import { before, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { countContainerStates, getParser, initParser, summarizeFieldCoverage } from "@satsuma/core";
import { createWorkspaceIndex, indexFile } from "@satsuma/viz-backend/workspace-index";
import { buildVizModel } from "@satsuma/viz-backend/viz-model";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");
/** Fixtures live in the CLI package because its suite asserts on them too. */
const FIXTURES = resolve(__dirname, "../../satsuma-cli/test/fixtures");
const VIZ_FIXTURES = resolve(__dirname, "fixtures");

/** @type {typeof import("../dist/satsuma-viz.js")} */
let viz;

before(async () => {
  await initParser(WASM_PATH);
  viz = await import("../dist/satsuma-viz.js");
});

/**
 * Coverage of the Nth mapping's schema, in one role, as the card receives it.
 *
 * `mappingIndex` matters for the duplicate-label fixture, where two mappings
 * share a label and only their position tells them apart.
 */
function coverageOfMapping(fixtureName, mappingIndex, schemaId, role) {
  const uri = `file://${resolve(FIXTURES, fixtureName)}`;
  const tree = getParser().parse(readFileSync(resolve(FIXTURES, fixtureName), "utf8"));
  const index = createWorkspaceIndex();
  indexFile(index, uri, tree);
  const model = buildVizModel(uri, tree, index);

  const schema = model.namespaces
    .flatMap((ns) => ns.schemas)
    .find((s) => s.qualifiedId === schemaId);
  const mapping = model.namespaces.flatMap((ns) => ns.mappings)[mappingIndex];
  const entries = viz.mappingSchemaCoverage(mapping, schema, role);
  return entries === null ? null : summarizeFieldCoverage(entries);
}

/**
 * Coverage of one schema in one role as the card receives it: model from the
 * backend, entries from the model, counting from core.
 *
 * Deliberately reaches the entries through `mappingSchemaCoverage` — the same
 * selector `satsuma-viz.ts` uses to feed the card — so a test cannot pass
 * against a path the UI does not take.
 */
function coverageOf(fixtureName, schemaId, role = "target") {
  const uri = `file://${resolve(FIXTURES, fixtureName)}`;
  const tree = getParser().parse(readFileSync(resolve(FIXTURES, fixtureName), "utf8"));
  const index = createWorkspaceIndex();
  indexFile(index, uri, tree);
  const model = buildVizModel(uri, tree, index);

  const schema = model.namespaces.flatMap((ns) => ns.schemas).find((s) => s.id === schemaId);
  const mapping = model.namespaces.flatMap((ns) => ns.mappings)[0];
  const entries = viz.mappingSchemaCoverage(mapping, schema, role);
  return {
    leaves: entries.map((f) => [f.path, f.state]),
    tiers: entries.filter((f) => f.mapped).map((f) => [f.path, f.tier]),
    totals: summarizeFieldCoverage(entries),
    containers: countContainerStates(entries),
  };
}

/** Aggregate overview totals from a local viz fixture's browser-built model. */
function overviewCoverageOf(fixtureName, schemaId) {
  const file = resolve(VIZ_FIXTURES, fixtureName);
  const uri = `file://${file}`;
  const tree = getParser().parse(readFileSync(file, "utf8"));
  const index = createWorkspaceIndex();
  indexFile(index, uri, tree);
  const model = buildVizModel(uri, tree, index);
  const fields = viz.buildCoverageIndex(model).get(schemaId);
  return summarizeFieldCoverage(fields);
}

describe("coverage overlay fixture (sl-5m9x)", () => {
  it("reports the CLI-compatible 100% and 50% aggregate figures", () => {
    // This is the component's self-computed path: core coverage embedded by the
    // browser-portable backend, then unioned by the overview selector. The two
    // exact figures are the same values `satsuma coverage --json` reports.
    assert.deepEqual(overviewCoverageOf("coverage-overlay.stm", "complete"), {
      covered: 2,
      coveredDeclared: 2,
      coveredNl: 0,
      total: 2,
      pct: 100,
    });
    assert.deepEqual(overviewCoverageOf("coverage-overlay.stm", "halfway"), {
      covered: 1,
      coveredDeclared: 1,
      coveredNl: 0,
      total: 2,
      pct: 50,
    });
  });
});

describe("viz coverage equals satsuma coverage (sl-5nsv)", () => {
  it("agrees leaf for leaf on a record body materialised by a fragment spread", () => {
    // The CLI reports 2/5 (40%) here with address.street and address.city
    // covered. Every part of that has to match: the leaf list (the model must
    // materialise the spread), the verdicts, the container state, and the
    // percentage.
    const { leaves, totals, containers } = coverageOf("nested-record-spread.stm", "customer");
    assert.deepEqual(leaves, [
      ["id", "uncovered"],
      ["name", "uncovered"],
      ["address", "partial"],
      ["address.street", "covered"],
      ["address.city", "covered"],
      ["address.zip", "uncovered"],
    ]);
    assert.equal(totals.covered, 2);
    assert.equal(totals.total, 5);
    assert.equal(totals.pct, 40);
    assert.deepEqual(containers, { covered: 0, partial: 1, uncovered: 0 });
  });

  it("agrees on a list_of record body whose arrows are element-relative", () => {
    // Two fixes meeting on one file: the spread has to materialise `lines`'
    // leaves (sl-5nsv) and `.item_code -> .sku` inside the `each` has to
    // resolve against its container (3cdd-yavi). Miss either and the card reads
    // 0 covered where the CLI reads 2/4.
    const { leaves, totals } = coverageOf("list-of-record-spread.stm", "invoice");
    assert.deepEqual(leaves, [
      ["invoice_no", "covered"],
      ["lines", "partial"],
      ["lines.sku", "covered"],
      ["lines.qty", "uncovered"],
      ["lines.unit_price", "uncovered"],
    ]);
    assert.equal(totals.covered, 2);
    assert.equal(totals.total, 4);
    assert.equal(totals.pct, 50);
  });
});

// ── The NL @ref tier (sl-46wr, ADR-036) ─────────────────────────────────────

describe("viz coverage counts the resolved NL @ref tier (sl-46wr)", () => {
  it("reports a leaf named only by a resolved @ref as covered, in the nl tier", () => {
    // The divergence sl-46wr records: the CLI reports buy_order 5/7 with
    // tax_amount and discount at tier=nl, and the card reported 3/7 because a
    // covered-path set derived from arrows cannot see a ref at all. The tier
    // must travel with the verdict — ADR-036 forbids a consumer reconstructing
    // the declared/NL split, and a boolean cannot carry it.
    const { totals, tiers } = coverageOf("coverage-nl-tier.stm", "buy_order", "source");
    assert.equal(totals.covered, 5);
    assert.equal(totals.total, 7);
    assert.equal(totals.pct, 71);
    assert.equal(totals.coveredDeclared, 3);
    assert.equal(totals.coveredNl, 2);
    assert.deepEqual(tiers, [
      ["id", "declared"],
      ["net_amount", "declared"],
      ["tax_amount", "nl"],
      ["discount", "nl"],
      ["status", "declared"],
    ]);
  });

  it("leaves a field described in prose without an @ref, and an unresolved @ref, uncovered", () => {
    // The two ways coverage must NOT rise. Reading prose would make coverage an
    // NL interpreter; counting an unresolved ref would make coverage rise when a
    // spec breaks. If either leaked in, the total above would be 6 or 7.
    const { leaves } = coverageOf("coverage-nl-tier.stm", "buy_order", "source");
    const byPath = new Map(leaves);
    assert.equal(byPath.get("internal_ref"), "uncovered");
    assert.equal(byPath.get("unresolved"), "uncovered");
  });
});

// ── Whole-structure conferral (sl-csrs, ADR-037/038) ────────────────────────

describe("viz coverage applies whole-structure conferral (sl-csrs)", () => {
  it("credits every leaf under a record-to-record and a list_of-record arrow", () => {
    // sl-csrs's repro: `addr -> address` and `rows -> lines` confer their whole
    // subtrees, and the card read them as gaps because conferral needs the
    // arrow's declaration kind, which a set of paths has discarded.
    const { leaves } = coverageOf("coverage-whole-structure.stm", "tgt", "target");
    const byPath = new Map(leaves);
    assert.equal(byPath.get("address"), "covered");
    assert.equal(byPath.get("address.line1"), "covered");
    assert.equal(byPath.get("address.postcode"), "covered");
    assert.equal(byPath.get("lines"), "covered");
    assert.equal(byPath.get("lines.quantity"), "covered");
  });

  it("confers from an empty body and from a pipe-chain body alike", () => {
    // ADR-037 names both forms explicitly: `p -> p { }` enumerates nothing, and
    // `r -> r { trim }` is a transform pipeline rather than a nesting scope
    // (spec §4.4), so neither narrows the header's claim.
    const { leaves } = coverageOf("coverage-whole-structure.stm", "tgt", "target");
    const byPath = new Map(leaves);
    assert.equal(byPath.get("plain_out"), "covered");
    assert.equal(byPath.get("plain_out.b"), "covered");
    assert.equal(byPath.get("trimmed_out"), "covered");
    assert.equal(byPath.get("trimmed_out.d"), "covered");
  });

  it("confers only the enumerated children when the body lists any", () => {
    // The limit of the rule, and the reason it is gated on the body: a header
    // that lists child arrows says nothing about the siblings it omits, so
    // reading it as wholesale would report `dropped` as covered when nothing
    // writes it.
    const { leaves } = coverageOf("coverage-whole-structure.stm", "tgt", "target");
    const byPath = new Map(leaves);
    assert.equal(byPath.get("enum_out"), "partial");
    assert.equal(byPath.get("enum_out.kept"), "covered");
    assert.equal(byPath.get("enum_out.dropped"), "uncovered");
  });

  it("does not let a scalar source fill a record target (ADR-038)", () => {
    // One scalar cannot fill two leaves and the arrow says nothing about which,
    // so `full_name -> scalar_into_record` confers nothing — under-counting is
    // the safe direction for a figure `--fail-under` gates.
    const { leaves } = coverageOf("coverage-whole-structure.stm", "tgt", "target");
    const byPath = new Map(leaves);
    assert.equal(byPath.get("scalar_into_record"), "uncovered");
    assert.equal(byPath.get("scalar_into_record.first"), "uncovered");
  });

  it("agrees with the CLI's totals on both sides of the conferral fixture", () => {
    // The figures `satsuma coverage` prints for this file: src 12/14 (85%) and
    // tgt 11/15 (73%). Asserting the totals as well as the verdicts is what
    // catches a rule that confers the right leaves but miscounts them.
    const src = coverageOf("coverage-whole-structure.stm", "src", "source");
    assert.equal(src.totals.covered, 12);
    assert.equal(src.totals.total, 14);
    assert.equal(src.totals.pct, 85);

    const tgt = coverageOf("coverage-whole-structure.stm", "tgt", "target");
    assert.equal(tgt.totals.covered, 11);
    assert.equal(tgt.totals.total, 15);
    assert.equal(tgt.totals.pct, 73);
  });
});

// ── A mapping label is not an identity (sl-46wr review) ─────────────────────

describe("viz coverage identifies the right mapping block", () => {
  it("keeps two same-named mappings in different namespaces apart", () => {
    // Coverage looked the mapping up by label, so both `a::load` and `b::load`
    // resolved to whichever was declared first. With the two namespaces
    // declaring identically-named schemas — the fixture's shape — `b::load`'s
    // card showed `a::load`'s single arrow as 1/2 where the truth is 2/2: a
    // plausible figure that was simply another mapping's. `satsuma coverage`
    // printed the same wrong number, so the two agreed while both were wrong.
    const a = coverageOfMapping("coverage-duplicate-mapping-labels.stm", 0, "a::t", "target");
    assert.equal(a.covered, 1);
    assert.equal(a.total, 2);

    const b = coverageOfMapping("coverage-duplicate-mapping-labels.stm", 1, "b::t", "target");
    assert.equal(b.covered, 2, "b::load has two arrows and must not inherit a::load's one");
    assert.equal(b.total, 2);
  });

  it("attaches coverage to an anonymous mapping, which has no label to look up", () => {
    // The model names an anonymous `mapping { … }` block "unknown", and no CST
    // block carries that label — so a label-based lookup found nothing and
    // dropped the coverage entirely, which the card then rendered as 0/N.
    // Resolving by position finds it.
    const anon = coverageOfMapping("coverage-anonymous-mapping.stm", 0, "tgt", "target");
    assert.notEqual(anon, null, "an anonymous mapping must still get coverage");
    assert.equal(anon.covered, 1);
    assert.equal(anon.total, 2);
  });
});

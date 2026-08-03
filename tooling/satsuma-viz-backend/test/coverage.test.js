/**
 * coverage.test.js — Attaching core's field coverage to an assembled VizModel.
 *
 * Coverage *semantics* are core's and are tested there; cross-consumer agreement
 * is swept over the whole example corpus by
 * satsuma-cli/test/coverage-viz-parity.test.ts. What can only break here is this
 * package's adaptation: which card a written schema reference resolves to, and
 * whether a mapping gets coverage attached at all.
 *
 * The resolver is the load-bearing part. Core reads schema references off the
 * CST *as authored*, because only the authored form can be matched against the
 * schema prefix on an arrow path — so an unqualified reference has to be
 * resolved relative to the namespace its mapping is declared in, and the field
 * tree then has to come from the card the client will render rather than from
 * the index. Each of those two halves silently zeroed a whole class of schema
 * while the other kept working, which is why they are pinned separately.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");
const { buildVizModel } = require("../dist/viz-model");
const { buildModelFromSources } = require("../dist/model-from-sources");
const { summarizeFieldCoverage } = require("@satsuma/core");

before(async () => {
  await initTestParser();
});

/** Build a VizModel from source text, as a single-file host would. */
function vizModel(source, uri = "file:///test.stm") {
  const tree = parse(source);
  const idx = createWorkspaceIndex();
  indexFile(idx, uri, tree);
  return buildVizModel(uri, tree, idx);
}

/** The coverage entry for one schema in one role, from the model's payload. */
function coverageFor(model, mappingId, schemaId, role) {
  const mapping = model.namespaces.flatMap((ns) => ns.mappings).find((m) => m.id === mappingId);
  return mapping?.coverage?.schemas.find((s) => s.role === role && s.schemaId === schemaId) ?? null;
}

describe("attachMappingCoverage — what a mapping's coverage is attached for", () => {
  it("attaches per-schema coverage for both roles of a file-scope mapping", () => {
    // The baseline contract: the payload the card is handed carries an entry per
    // participating schema, with core's verdicts on it.
    const model = vizModel(`
schema src { id INT unused STRING }
schema tgt { id INT spare STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
}`);
    const source = coverageFor(model, "load", "src", "source");
    const target = coverageFor(model, "load", "tgt", "target");
    assert.deepEqual(summarizeFieldCoverage(source.fields), {
      covered: 1,
      coveredDeclared: 1,
      coveredNl: 0,
      total: 2,
      pct: 50,
    });
    assert.equal(summarizeFieldCoverage(target.fields).covered, 1);
  });

  it("resolves an unqualified reference against the namespace its mapping is declared in", () => {
    // The regression this test exists for: `stg` written inside `namespace
    // staging` names `staging::stg`, and resolving it namespace-blind found no
    // card at all — so every namespaced mapping's own-namespace target reported
    // 0/N while its fully-qualified cross-namespace sources kept working. The
    // asymmetry is what made it easy to miss.
    const model = vizModel(`
namespace raw {
  schema feed { a STRING b STRING }
}
namespace staging {
  schema stg { a STRING b STRING }
  mapping stage {
    source { raw::feed }
    target { stg }
    raw::feed.a -> a
  }
}`);
    const target = coverageFor(model, "stage", "staging::stg", "target");
    assert.ok(target, "the target card must resolve through the mapping's own namespace");
    assert.equal(summarizeFieldCoverage(target.fields).covered, 1);
    assert.equal(summarizeFieldCoverage(target.fields).total, 2);

    // The cross-namespace source, written fully qualified, resolves directly.
    const source = coverageFor(model, "stage", "raw::feed", "source");
    assert.equal(summarizeFieldCoverage(source.fields).covered, 1);
  });

  it("reports coverage for a metric endpoint, which the index classifies apart from schemas", () => {
    // A pipeline mapping writes into a metric and a report mapping reads from
    // one, and the detail view renders both as schema cards. Resolving against
    // the index instead of the cards would skip them — the index upgrades a
    // metric's kind away from "schema" — leaving those cards with no figures at
    // all while every ordinary schema looked fine.
    const model = vizModel(`
schema orders { amount DECIMAL(12,2) refunds DECIMAL(12,2) }
schema revenue (metric) { total DECIMAL(12,2) net DECIMAL(12,2) }
mapping roll_up {
  source { orders }
  target { revenue }
  amount -> total
}`);
    const target = coverageFor(model, "roll_up", "revenue", "target");
    assert.ok(target, "a metric target must resolve to its card");
    assert.deepEqual(summarizeFieldCoverage(target.fields), {
      covered: 1,
      coveredDeclared: 1,
      coveredNl: 0,
      total: 2,
      pct: 50,
    });
  });

  it("judges coverage against the card's field tree, spreads already materialised", () => {
    // Coverage must run after spread resolution, or the leaves the card renders
    // and the leaves it counts disagree: the record would be judged as one
    // childless leaf while three rows are drawn under it (sl-5nsv).
    const model = vizModel(`
fragment address_fields { street STRING city STRING zip STRING }
schema tgt { id INT address record { ...address_fields } }
mapping load {
  source { src }
  target { tgt }
  raw_city -> address.city
}
schema src { raw_city STRING }`);
    const target = coverageFor(model, "load", "tgt", "target");
    assert.deepEqual(
      target.fields.map((f) => [f.path, f.state]),
      [
        ["id", "uncovered"],
        ["address", "partial"],
        ["address.street", "uncovered"],
        ["address.city", "covered"],
        ["address.zip", "uncovered"],
      ],
    );
  });

  it("leaves coverage absent when no schema resolves, rather than reporting zero", () => {
    // Absent means "not computed" and a consumer must not render it as 0%. An
    // empty result would be indistinguishable from a mapping that genuinely
    // covers nothing.
    const model = vizModel(`
mapping orphan {
  source { nowhere }
  target { nothing }
  a -> b
}`);
    const mapping = model.namespaces.flatMap((ns) => ns.mappings).find((m) => m.id === "orphan");
    assert.equal(mapping.coverage, undefined);
  });

  it("keeps coverage through the lineage merge, for a schema imported from another file", () => {
    // Coverage is attached per file, *before* mergeVizModels, which upgrades an
    // imported stub card to its full definition. ADR-042 records that as a
    // residual risk: it is safe only because a stub carries the index's fields,
    // so the tree the merge swaps in is the tree that was judged. This pins the
    // property both ways round — single-file and merged must agree, and a
    // cross-file source schema must be counted rather than skipped.
    const docs = [
      { uri: "file:///lib.stm", source: `schema shared { a STRING b STRING }` },
      {
        uri: "file:///main.stm",
        source: `import { shared } from "./lib.stm"
schema tgt { a STRING b STRING }
mapping load { source { shared } target { tgt } shared.a -> a }`,
      },
    ];

    const figures = (lineage) => {
      const model = buildModelFromSources("file:///main.stm", docs, { lineage });
      const mapping = model.namespaces.flatMap((ns) => ns.mappings)[0];
      return (mapping.coverage?.schemas ?? []).map((s) => {
        const t = summarizeFieldCoverage(s.fields);
        return `${s.role} ${s.schemaId} ${t.covered}/${t.total}`;
      });
    };

    const expected = ["source shared 1/2", "target tgt 1/2"];
    assert.deepEqual(figures(false), expected);
    assert.deepEqual(figures(true), expected, "the lineage merge must not drop or alter coverage");
  });

  it("credits a leaf named only by a resolved NL @ref, in the nl tier", () => {
    // ADR-036 through this package's own plumbing: the refs have to be resolved
    // here and handed to core, because a VizModel carries no CST for core to
    // find them in. Omitting them would silently drop the tier for every viz
    // consumer while the CLI kept reporting it (sl-46wr).
    const model = vizModel(`
schema src { net DECIMAL(12,2) tax DECIMAL(12,2) }
schema tgt { gross DECIMAL(12,2) }
mapping load {
  source { src }
  target { tgt }
  -> gross { "Sum of @net and @tax" }
}`);
    const source = coverageFor(model, "load", "src", "source");
    assert.deepEqual(
      source.fields.map((f) => [f.path, f.tier]),
      [
        ["net", "nl"],
        ["tax", "nl"],
      ],
    );
    assert.equal(summarizeFieldCoverage(source.fields).coveredNl, 2);
  });
});

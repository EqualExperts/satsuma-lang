/**
 * coverage-rollup.test.js — Aggregating per-mapping coverage across a workspace.
 *
 * The distinction these tests defend: "uncovered by this mapping" and
 * "uncovered by every mapping" are different claims, and a reviewer acting on
 * the wrong one deletes a field that another mapping populates. Cases here pin
 * the union rule, the leaf-counting rule behind every percentage, and the
 * namespace/workspace rollups.
 *
 * Inputs are built from real parse trees via computeMappingCoverage so the
 * aggregation is tested against the shape it actually receives, not a
 * hand-written approximation of it.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initParser,
  getParser,
  computeMappingCoverage,
  extractSchemas,
  extractMappings,
  aggregateCoverage,
  unionFieldCoverage,
  summarizeFieldCoverage,
  countContainerStates,
  coveragePercentage,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Project extractSchemas() FieldDecls onto core's minimal coverage shape. */
function toCoverageFields(fields) {
  return fields.map((f) => ({
    name: f.name,
    line: f.startRow,
    children: f.children ? toCoverageFields(f.children) : undefined,
  }));
}

/**
 * Expected CoverageTotals. `nl` defaults to 0 because most fixtures here use
 * declared arrows only; the tier split (ADR-036) is exercised separately below.
 */
function expectTotals(covered, total, pct, nl = 0) {
  return { covered, coveredDeclared: covered - nl, coveredNl: nl, total, pct };
}

/** Namespace-qualified id, matching what the CLI's index keys use. */
function qualify(namespace, name) {
  return namespace ? `${namespace}::${name}` : name;
}

/**
 * Parse a workspace, run coverage for every named mapping in it, and aggregate.
 * This is the whole pipeline a consumer runs, so a break anywhere in it fails here.
 */
function aggregate(source) {
  const tree = getParser().parse(source);
  const byId = new Map();
  for (const s of extractSchemas(tree.rootNode)) {
    byId.set(qualify(s.namespace, s.name), s);
  }
  const resolveSchema = (schemaId) => {
    const schema = byId.get(schemaId);
    return schema ? { uri: "file:///test.stm", fields: toCoverageFields(schema.fields) } : null;
  };
  const inputs = extractMappings(tree.rootNode)
    .filter((m) => m.name !== null)
    .map((m) => ({
      mappingId: qualify(m.namespace, m.name),
      result: computeMappingCoverage(tree, m.name, resolveSchema),
    }));
  return { inputs, aggregate: aggregateCoverage(inputs) };
}

/** The aggregate entry for one schema and role. */
function entry(result, role, schemaId) {
  const found = result.schemas.find((s) => s.role === role && s.schemaId === schemaId);
  assert.ok(
    found,
    `expected ${role} ${schemaId} in ${JSON.stringify(result.schemas.map((s) => [s.role, s.schemaId]))}`,
  );
  return found;
}

/** Whether the aggregate says `path` is covered by at least one mapping. */
function aggregateMapped(result, role, schemaId, path) {
  const field = entry(result, role, schemaId).fields.find((f) => f.path === path);
  assert.ok(field, `expected field ${path} on ${role} ${schemaId}`);
  return field.mapped;
}

// ── Counting rule ───────────────────────────────────────────────────────────

describe("summarizeFieldCoverage()", () => {
  it("counts leaves only, excluding the record that contains them", () => {
    // A record and its children would otherwise be counted at two levels,
    // letting a schema's nesting depth move the headline number on its own.
    // Here the leaves are line1, line2 and id — `address` is not counted.
    const totals = summarizeFieldCoverage([
      { path: "address", uri: "u", mapped: true },
      { path: "address.line1", uri: "u", mapped: true },
      { path: "address.line2", uri: "u", mapped: false },
      { path: "id", uri: "u", mapped: true },
    ]);
    assert.deepEqual(totals, expectTotals(2, 3, 66));
  });

  it("does not let a partly covered record vouch for its uncovered leaves", () => {
    // A record marked mapped/partial because one child is covered must not lift
    // its unmapped sibling into the count — that would turn "one of two address
    // fields is mapped" into "both are", the overstatement 3cc-iedv records.
    // Counting leaves only makes that impossible by construction.
    const totals = summarizeFieldCoverage([
      { path: "address", uri: "u", mapped: true, state: "partial" },
      { path: "address.line1", uri: "u", mapped: true, state: "covered" },
      { path: "address.line2", uri: "u", mapped: false, state: "uncovered" },
    ]);
    assert.deepEqual(totals, expectTotals(1, 2, 50));
  });

  it("reports 0% rather than dividing by zero for a schema with no fields", () => {
    assert.deepEqual(summarizeFieldCoverage([]), expectTotals(0, 0, 0));
  });

  it("reduces the percentage to a whole number in one place, not per renderer", () => {
    // The CLI table, the status bar and --fail-under all compare whole numbers,
    // so the reduction happens here and every consumer inherits the same rule.
    const totals = summarizeFieldCoverage([
      { path: "a", uri: "u", mapped: true },
      { path: "b", uri: "u", mapped: false },
      { path: "c", uri: "u", mapped: false },
    ]);
    assert.equal(totals.pct, 33);
  });
});

// ── The percentage rule (sl-8ba4) ───────────────────────────────────────────

describe("coveragePercentage()", () => {
  it("reports 100 only when every leaf is covered", () => {
    // The bug this rule exists for: rounding to nearest turned 200/201 into 100,
    // so `--fail-under 100` passed a spec with an unmapped field — a merge gate
    // failing open. 100 now means exactly complete, and nothing else does.
    assert.equal(coveragePercentage(201, 201), 100);
    assert.equal(coveragePercentage(200, 201), 99);
    assert.equal(coveragePercentage(2000, 2001), 99);
  });

  it("reports 0 only when no leaf is covered", () => {
    // The mirror-image lie flooring would introduce on its own: 1/201 floors to
    // 0 and reads as "nothing is mapped". Partial work must stay visible, so the
    // bottom is held off 0 for any non-zero numerator.
    assert.equal(coveragePercentage(0, 201), 0);
    assert.equal(coveragePercentage(1, 201), 1);
    assert.equal(coveragePercentage(1, 100000), 1);
  });

  it("floors everything between the endpoints, so a figure never overstates", () => {
    // 8/9 is 88.9%: it reports 88, and `--fail-under 89` therefore fails on it.
    // Every printed figure is a claim the counts can support.
    assert.equal(coveragePercentage(8, 9), 88);
    assert.equal(coveragePercentage(2, 3), 66);
    assert.equal(coveragePercentage(1, 2), 50);
    assert.equal(coveragePercentage(1, 3), 33);
  });

  it("reports 0 for a schema with no leaves rather than dividing by zero", () => {
    // Calling an empty schema complete would let it satisfy any threshold.
    assert.equal(coveragePercentage(0, 0), 0);
  });
});

describe("countContainerStates()", () => {
  // The counts reviewers read beside the ratio. Containers are excluded from
  // the percentage (ADR-034), so this is the only surface that reports them —
  // and it must report the tri-state, not a boolean, or "one of twelve address
  // fields is mapped" is indistinguishable from "all twelve are".
  const ENTRIES = [
    { path: "address", uri: "u", mapped: true, state: "partial" },
    { path: "address.city", uri: "u", mapped: true, state: "covered" },
    { path: "address.line1", uri: "u", mapped: false, state: "uncovered" },
    { path: "billing", uri: "u", mapped: true, state: "covered" },
    { path: "billing.city", uri: "u", mapped: true, state: "covered" },
    { path: "shipping", uri: "u", mapped: false, state: "uncovered" },
    { path: "shipping.city", uri: "u", mapped: false, state: "uncovered" },
    { path: "amount", uri: "u", mapped: true, state: "covered" },
  ];

  it("tallies containers by state and counts no leaf among them", () => {
    // `amount` and every `.city` are leaves: were any of them counted the
    // totals would exceed the three records declared.
    assert.deepEqual(countContainerStates(ENTRIES), {
      covered: 1,
      partial: 1,
      uncovered: 1,
    });
  });

  it("reports three zeroes for a schema declaring no records", () => {
    // A flat schema has no container state to report, and must not borrow its
    // leaves' states to manufacture one.
    assert.deepEqual(countContainerStates([{ path: "id", uri: "u", mapped: true }]), {
      covered: 0,
      partial: 0,
      uncovered: 0,
    });
  });
});

// ── Union rule ──────────────────────────────────────────────────────────────

describe("aggregateCoverage() — union across mappings", () => {
  // Two mappings populate different halves of one target schema. Between them
  // they cover it completely; neither does alone.
  const SRC = `
schema a { id INT }
schema b { memo STRING }
schema tgt { id INT memo STRING spare STRING }
mapping load_ids {
  source { a }
  target { tgt }
  id -> id
}
mapping load_memos {
  source { b }
  target { tgt }
  memo -> memo
}`;

  it("marks a field covered when any single mapping populates it", () => {
    // The headline aggregate semantic. `memo` is untouched by "load_ids", so a
    // naive intersection or last-writer-wins would report it uncovered.
    const { aggregate: result } = aggregate(SRC);
    assert.equal(aggregateMapped(result, "target", "tgt", "id"), true);
    assert.equal(aggregateMapped(result, "target", "tgt", "memo"), true);
  });

  it("keeps a field uncovered only when no mapping populates it", () => {
    // The strong claim, and the one worth acting on: nothing in the workspace
    // writes `spare`.
    const { aggregate: result } = aggregate(SRC);
    assert.equal(aggregateMapped(result, "target", "tgt", "spare"), false);
  });

  it("distinguishes per-mapping from aggregate for the same field", () => {
    // The confusion this module exists to prevent, asserted directly: `memo` is
    // uncovered in "load_ids"' own result and covered in the aggregate.
    const { inputs, aggregate: result } = aggregate(SRC);
    const loadIds = inputs.find((i) => i.mappingId === "load_ids");
    const perMapping = loadIds.result.schemas
      .find((s) => s.role === "target")
      .fields.find((f) => f.path === "memo");
    assert.equal(perMapping.mapped, false, "per-mapping: 'load ids' does not write memo");
    assert.equal(
      aggregateMapped(result, "target", "tgt", "memo"),
      true,
      "aggregate: some mapping writes memo",
    );
  });

  it("records every mapping that references a schema in a role", () => {
    // Output has to name the mappings behind an aggregate figure, or a reviewer
    // cannot tell where to go and fix a gap.
    const { aggregate: result } = aggregate(SRC);
    assert.deepEqual(entry(result, "target", "tgt").mappings, ["load_ids", "load_memos"]);
  });

  it("counts a schema once per role, not once per referencing mapping", () => {
    // tgt is a target of two mappings; double counting it would halve the
    // workspace percentage for no reason.
    const { aggregate: result } = aggregate(SRC);
    assert.deepEqual(entry(result, "target", "tgt").totals, expectTotals(2, 3, 66));
  });

  it("reports a record as covered when two mappings between them write every leaf", () => {
    // A container's state cannot be unioned the way a leaf's can: both mappings
    // report `addr` as `partial`, and taking the strongest of those would leave
    // the aggregate saying `partial` about a record the workspace fully
    // populates. The union has to happen on leaves, with containers derived
    // afterwards (sl-0pun).
    const SPLIT_RECORD = `
schema a { v INT }
schema b { w INT }
schema tgt { addr record { line1 STRING city STRING } }
mapping load_line1 {
  source { a }
  target { tgt }
  v -> addr.line1
}
mapping load_city {
  source { b }
  target { tgt }
  w -> addr.city
}`;
    const { inputs, aggregate: result } = aggregate(SPLIT_RECORD);
    for (const input of inputs) {
      const addr = input.result.schemas
        .find((s) => s.role === "target")
        .fields.find((f) => f.path === "addr");
      assert.equal(addr.state, "partial", `${input.mappingId} alone covers half of addr`);
    }
    const aggregated = entry(result, "target", "tgt").fields.find((f) => f.path === "addr");
    assert.equal(aggregated.state, "covered");
    assert.equal(aggregated.mapped, true);
  });

  it("reports a record as partial when the union still leaves a leaf unwritten", () => {
    // The complement of the case above, and the one that would hide a real gap:
    // a container must not round up to `covered` merely because more than one
    // mapping contributed to it.
    const PARTIAL_UNION = `
schema a { v INT }
schema tgt { addr record { line1 STRING city STRING } }
mapping load_line1 {
  source { a }
  target { tgt }
  v -> addr.line1
}`;
    const { aggregate: result } = aggregate(PARTIAL_UNION);
    const addr = entry(result, "target", "tgt").fields.find((f) => f.path === "addr");
    assert.equal(addr.state, "partial");
  });
});

describe("aggregateCoverage() — roles", () => {
  it("reports a schema used as both source and target as two entries", () => {
    // A staging schema is commonly written by one mapping and read by the next.
    // Blending the two would make "is it populated?" unanswerable.
    const src = `
schema raw { id INT }
schema stage { id INT memo STRING }
schema final { id INT }
mapping load {
  source { raw }
  target { stage }
  id -> id
}
mapping publish {
  source { stage }
  target { final }
  id -> id
}`;
    const { aggregate: result } = aggregate(src);
    assert.deepEqual(entry(result, "target", "stage").mappings, ["load"]);
    assert.deepEqual(entry(result, "source", "stage").mappings, ["publish"]);
    // `memo` is neither written by load nor read by publish — a gap in both roles.
    assert.equal(aggregateMapped(result, "target", "stage", "memo"), false);
    assert.equal(aggregateMapped(result, "source", "stage", "memo"), false);
  });

  it("keeps source and target totals separate in the workspace rollup", () => {
    // Unconsumed source fields and unpopulated target fields are different
    // findings; a single blended percentage would hide both.
    const src = `
schema src { id INT unused INT }
schema tgt { id INT memo STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
}`;
    const { aggregate: result } = aggregate(src);
    assert.deepEqual(result.workspace.source, expectTotals(1, 2, 50));
    assert.deepEqual(result.workspace.target, expectTotals(1, 2, 50));
  });
});

// ── Namespace and workspace rollups ─────────────────────────────────────────

describe("aggregateCoverage() — namespace subtotals", () => {
  const SRC = `
namespace crm {
  schema customers { id INT email STRING }
  schema contacts { id INT }
  mapping crm_load {
    source { crm::customers }
    target { crm::contacts }
    id -> id
  }
}
namespace billing {
  schema invoices { id INT total DECIMAL memo STRING }
  schema ledger { id INT total DECIMAL }
  mapping billing_load {
    source { billing::invoices }
    target { billing::ledger }
    id -> id
    total -> total
  }
}`;

  it("groups subtotals by the namespace a schema is declared in", () => {
    // Attribution follows the schema, not the referencing mapping: the question
    // is how well covered *this namespace's* schemas are.
    const { aggregate: result } = aggregate(SRC);
    const crm = result.namespaces.find((n) => n.namespace === "crm");
    const billing = result.namespaces.find((n) => n.namespace === "billing");
    assert.deepEqual(crm.source, expectTotals(1, 2, 50), "crm::customers: id read, email not");
    assert.deepEqual(billing.source, expectTotals(2, 3, 66), "billing::invoices: memo not read");
    assert.deepEqual(billing.target, expectTotals(2, 2, 100), "billing::ledger fully populated");
  });

  it("workspace totals equal the sum of the namespace subtotals", () => {
    // If these can disagree, one of the two numbers in the report is a lie.
    const { aggregate: result } = aggregate(SRC);
    const summed = (role) =>
      result.namespaces.reduce(
        (acc, ns) => ({
          covered: acc.covered + ns[role].covered,
          total: acc.total + ns[role].total,
        }),
        { covered: 0, total: 0 },
      );
    assert.deepEqual(summed("source"), {
      covered: result.workspace.source.covered,
      total: result.workspace.source.total,
    });
    assert.deepEqual(summed("target"), {
      covered: result.workspace.target.covered,
      total: result.workspace.target.total,
    });
  });

  it("groups schemas declared at file scope under a null namespace", () => {
    // A workspace with no namespaces must still produce exactly one group, so
    // renderers need no special case for the un-namespaced workspace.
    const { aggregate: result } = aggregate(`
schema src { id INT }
schema tgt { id INT }
mapping load {
  source { src }
  target { tgt }
  id -> id
}`);
    assert.deepEqual(
      result.namespaces.map((n) => n.namespace),
      [null],
    );
    assert.deepEqual(result.namespaces[0].target, result.workspace.target);
  });
});

// ── Degenerate inputs ───────────────────────────────────────────────────────

describe("aggregateCoverage() — degenerate inputs", () => {
  it("returns empty rollups for no mappings at all", () => {
    // `satsuma coverage` on a schema-only file must report nothing rather than
    // 0% of nothing, which would look like a failure.
    const result = aggregateCoverage([]);
    assert.deepEqual(result.schemas, []);
    assert.deepEqual(result.namespaces, []);
    assert.deepEqual(result.workspace.target, expectTotals(0, 0, 0));
  });

  it("skips a mapping whose coverage resolved to no schemas", () => {
    // computeMappingCoverage returns { schemas: [] } for a mapping it cannot
    // find or resolve; that must not create a phantom zero-coverage entry.
    const result = aggregateCoverage([{ mappingId: "ghost", result: { schemas: [] } }]);
    assert.deepEqual(result.schemas, []);
  });
});

// ── The union operation on its own ──────────────────────────────────────────

describe("unionFieldCoverage()", () => {
  // aggregateCoverage unions by (schema, role); the viz overview card unions a
  // schema's roles together; `fields --unmapped-by` unions the two sides of one
  // mapping. Same three rules each time, so they are pinned here once against
  // the exported operation rather than three times through its callers.

  /** One schema's entries: a leaf plus a two-leaf record. */
  const half = (city, line1, amount, tier = "declared") => [
    {
      path: "amount",
      uri: "u",
      mapped: amount,
      state: amount ? "covered" : "uncovered",
      ...(amount ? { tier } : {}),
    },
    {
      path: "address",
      uri: "u",
      mapped: city || line1,
      state: city && line1 ? "covered" : city || line1 ? "partial" : "uncovered",
      ...(city || line1 ? { tier } : {}),
    },
    {
      path: "address.city",
      uri: "u",
      mapped: city,
      state: city ? "covered" : "uncovered",
      ...(city ? { tier } : {}),
    },
    {
      path: "address.line1",
      uri: "u",
      mapped: line1,
      state: line1 ? "covered" : "uncovered",
      ...(line1 ? { tier } : {}),
    },
  ];

  it("promotes a record to covered when two inputs each cover half of it", () => {
    // The rule a plain OR of container states cannot express: both inputs call
    // `address` partial, but between them every leaf is written, so the union
    // is covered. Getting this wrong understates the union.
    const union = unionFieldCoverage([half(true, false, false), half(false, true, false)]);
    const byPath = new Map(union.map((f) => [f.path, f]));
    assert.equal(byPath.get("address").state, "covered");
    assert.equal(byPath.get("address.city").state, "covered");
    assert.equal(byPath.get("address.line1").state, "covered");
  });

  it("leaves a record partial when no input covers one of its leaves", () => {
    // The mirror case: union must not round a genuine gap up to covered.
    const union = unionFieldCoverage([half(true, false, false), half(true, false, true)]);
    const byPath = new Map(union.map((f) => [f.path, f]));
    assert.equal(byPath.get("address").state, "partial");
    assert.equal(byPath.get("address.line1").state, "uncovered");
    assert.equal(byPath.get("address.line1").tier, undefined);
  });

  it("reports a leaf covered by prose in one input and by an arrow in another as declared", () => {
    // Tier unions toward the stronger claim (ADR-036). Without it, whether a
    // declared field reads as merely inferred would depend on input order.
    const union = unionFieldCoverage([half(true, false, false, "nl"), half(true, false, false)]);
    const byPath = new Map(union.map((f) => [f.path, f]));
    assert.equal(byPath.get("address.city").tier, "declared");
    assert.equal(byPath.get("address").tier, "declared");
  });

  it("re-derives a leaf's state from the unioned flag, not from the first input", () => {
    // `mapped` and `state` are documented to always agree. Merging `mapped` but
    // keeping the first input's `state` left `mapped: true, state: "uncovered"`
    // on any leaf the first input missed — invisible while only the counts were
    // read, wrong the moment a consumer renders the tri-state.
    const union = unionFieldCoverage([half(false, false, false), half(false, false, true)]);
    const amount = union.find((f) => f.path === "amount");
    assert.equal(amount.mapped, true);
    assert.equal(amount.state, "covered");
  });

  it("keeps the NL tier when no input declares the field", () => {
    // The tier must survive the union, not be flattened to `declared` — a
    // reviewer has to see that nothing but prose names this field.
    const union = unionFieldCoverage([half(true, false, false, "nl"), half(false, false, false)]);
    assert.equal(union.find((f) => f.path === "address.city").tier, "nl");
  });

  it("does not mutate the inputs", () => {
    // Callers hold the per-mapping results and render them separately; a union
    // that wrote through would silently turn every per-mapping figure into the
    // aggregate one.
    const first = half(true, false, false);
    const second = half(false, true, false);
    unionFieldCoverage([first, second]);
    assert.equal(first.find((f) => f.path === "address.line1").mapped, false);
    assert.equal(second.find((f) => f.path === "address").state, "partial");
  });

  it("returns an empty list for no inputs", () => {
    // A schema no mapping references unions to nothing, not to a phantom entry.
    assert.deepEqual(unionFieldCoverage([]), []);
  });
});

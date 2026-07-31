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
  summarizeFieldCoverage,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => { await initParser(WASM_PATH); });

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Project extractSchemas() FieldDecls onto core's minimal coverage shape. */
function toCoverageFields(fields) {
  return fields.map((f) => ({
    name: f.name,
    line: f.startRow,
    children: f.children ? toCoverageFields(f.children) : undefined,
  }));
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
  assert.ok(found, `expected ${role} ${schemaId} in ${JSON.stringify(result.schemas.map((s) => [s.role, s.schemaId]))}`);
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
    assert.deepEqual(totals, { covered: 2, total: 3, pct: 67 });
  });

  it("does not let a covered record vouch for its uncovered leaves", () => {
    // A record's mapped flag is true whenever ANY descendant is covered, since
    // addPathAndPrefixes registers ancestor prefixes. Inheriting from it would
    // turn "one of two address fields is mapped" into "both are" — the
    // overstatement 3cc-iedv records the trade-off for.
    const totals = summarizeFieldCoverage([
      { path: "address", uri: "u", mapped: true },
      { path: "address.line1", uri: "u", mapped: true },
      { path: "address.line2", uri: "u", mapped: false },
    ]);
    assert.deepEqual(totals, { covered: 1, total: 2, pct: 50 });
  });

  it("reports 0% rather than dividing by zero for a schema with no fields", () => {
    assert.deepEqual(summarizeFieldCoverage([]), { covered: 0, total: 0, pct: 0 });
  });

  it("rounds the percentage to a whole number", () => {
    // The CLI table and --fail-under both compare whole numbers, so rounding
    // has to happen once, here, not per renderer.
    const totals = summarizeFieldCoverage([
      { path: "a", uri: "u", mapped: true },
      { path: "b", uri: "u", mapped: false },
      { path: "c", uri: "u", mapped: false },
    ]);
    assert.equal(totals.pct, 33);
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
    assert.equal(aggregateMapped(result, "target", "tgt", "memo"), true, "aggregate: some mapping writes memo");
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
    assert.deepEqual(entry(result, "target", "tgt").totals, { covered: 2, total: 3, pct: 67 });
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
    assert.deepEqual(result.workspace.source, { covered: 1, total: 2, pct: 50 });
    assert.deepEqual(result.workspace.target, { covered: 1, total: 2, pct: 50 });
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
    assert.deepEqual(crm.source, { covered: 1, total: 2, pct: 50 }, "crm::customers: id read, email not");
    assert.deepEqual(billing.source, { covered: 2, total: 3, pct: 67 }, "billing::invoices: memo not read");
    assert.deepEqual(billing.target, { covered: 2, total: 2, pct: 100 }, "billing::ledger fully populated");
  });

  it("workspace totals equal the sum of the namespace subtotals", () => {
    // If these can disagree, one of the two numbers in the report is a lie.
    const { aggregate: result } = aggregate(SRC);
    const summed = (role) => result.namespaces.reduce(
      (acc, ns) => ({ covered: acc.covered + ns[role].covered, total: acc.total + ns[role].total }),
      { covered: 0, total: 0 },
    );
    assert.deepEqual(summed("source"), { covered: result.workspace.source.covered, total: result.workspace.source.total });
    assert.deepEqual(summed("target"), { covered: result.workspace.target.covered, total: result.workspace.target.total });
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
    assert.deepEqual(result.namespaces.map((n) => n.namespace), [null]);
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
    assert.deepEqual(result.workspace.target, { covered: 0, total: 0, pct: 0 });
  });

  it("skips a mapping whose coverage resolved to no schemas", () => {
    // computeMappingCoverage returns { schemas: [] } for a mapping it cannot
    // find or resolve; that must not create a phantom zero-coverage entry.
    const result = aggregateCoverage([{ mappingId: "ghost", result: { schemas: [] } }]);
    assert.deepEqual(result.schemas, []);
  });
});

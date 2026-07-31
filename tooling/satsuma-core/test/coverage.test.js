/**
 * coverage.test.js — Authoritative tests for computeMappingCoverage().
 *
 * These cases moved here from satsuma-lsp when the computation was relocated
 * into core (sl-gsxu). They are the single home for coverage *semantics*:
 * which arrows cover which declared fields, how nested paths and each/flatten
 * blocks contribute, and how declaration positions propagate. The LSP keeps
 * only adapter-wiring tests, and the CLI tests only its own rendering.
 *
 * The resolver used here is built from core's own extractSchemas(), which is
 * also the shape the CLI adapts to — so a break in the resolver contract
 * shows up in this suite rather than in a consumer.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser, getParser, computeMappingCoverage, extractSchemas } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

const TEST_URI = "file:///test.stm";

before(async () => { await initParser(WASM_PATH); });

// ── Test resolver ───────────────────────────────────────────────────────────

/** Project extractSchemas() FieldDecls onto core's minimal coverage shape. */
function toCoverageFields(fields) {
  return fields.map((f) => ({
    name: f.name,
    line: f.startRow,
    children: f.children ? toCoverageFields(f.children) : undefined,
  }));
}

/**
 * Run computeMappingCoverage over single-file source text, resolving schemas
 * from that same file.
 */
function coverage(source, mappingName) {
  const tree = getParser().parse(source);
  const byId = new Map();
  for (const s of extractSchemas(tree.rootNode)) {
    byId.set(s.namespace ? `${s.namespace}::${s.name}` : s.name, s);
  }
  return computeMappingCoverage(tree, mappingName, (schemaId) => {
    const schema = byId.get(schemaId);
    return schema ? { uri: TEST_URI, fields: toCoverageFields(schema.fields) } : null;
  });
}

/** Coverage entries for the single schema playing `role` in the result. */
function forRole(result, role) {
  const schema = result.schemas.find((s) => s.role === role);
  assert.ok(schema, `expected a ${role} schema in ${JSON.stringify(result.schemas.map((s) => s.role))}`);
  return schema;
}

/** Assert `path` appears exactly once and carries the expected mapped flag. */
function assertMapped(schema, path, expected) {
  const matches = schema.fields.filter((f) => f.path === path);
  assert.equal(matches.length, 1, `expected exactly one "${path}" entry in ${schema.fields.map((f) => f.path)}`);
  assert.equal(matches[0].mapped, expected, `"${path}" should be mapped=${expected}`);
}

// ── Result structure ────────────────────────────────────────────────────────

describe("computeMappingCoverage — result structure", () => {
  const SRC = `
schema src { id INT name STRING }
schema tgt { id INT label STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
}`;

  it("reports one entry per schema, tagged with the side it appears on", () => {
    // Role is how consumers label output ("used as source" vs "mapped"), so a
    // schema landing on the wrong side is a user-visible defect.
    const result = coverage(SRC, "load");
    assert.equal(result.schemas.length, 2);
    assert.equal(forRole(result, "source").schemaId, "src");
    assert.equal(forRole(result, "target").schemaId, "tgt");
  });

  it("returns no schemas when the named mapping is absent from the tree", () => {
    // Callers scoping by --mapping must be able to distinguish "mapping not
    // here" from "nothing covered"; an empty schema list is that signal.
    assert.deepEqual(coverage(SRC, "nonexistent").schemas, []);
  });

  it("skips schemas the resolver cannot resolve rather than failing", () => {
    // Coverage is not a validation pass — `validate` owns missing-ref
    // reporting. An unresolvable target must not abort the source report.
    const src = `
schema src { id INT }
mapping load {
  source { src }
  target { never_declared }
  id -> id
}`;
    const result = coverage(src, "load");
    assert.deepEqual(result.schemas.map((s) => s.schemaId), ["src"]);
  });

  it("finds a mapping declared inside a namespace block", () => {
    // Namespaced workspaces are the norm for platform files; a mapping nested
    // in `namespace { }` must be reachable by its bare label.
    const src = `
namespace crm {
  schema src { id INT }
  schema tgt { id INT memo STRING }
  mapping load {
    source { crm::src }
    target { crm::tgt }
    id -> id
  }
}`;
    const result = coverage(src, "load");
    assert.equal(forRole(result, "target").schemaId, "crm::tgt");
  });
});

// ── Target coverage ─────────────────────────────────────────────────────────

describe("computeMappingCoverage — target fields", () => {
  const SRC = `
schema src { id INT name STRING extra INT }
schema tgt { id INT label STRING memo STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
  name -> label
}`;

  it("marks a target field written by an arrow as mapped", () => {
    const tgt = forRole(coverage(SRC, "load"), "target");
    assertMapped(tgt, "id", true);
    assertMapped(tgt, "label", true);
  });

  it("marks a declared target field no arrow writes as unmapped", () => {
    // This is the review question the whole feature exists to answer.
    assertMapped(forRole(coverage(SRC, "load"), "target"), "memo", false);
  });

  it("counts a computed arrow with no source as covering its target", () => {
    // `-> stamp { now_utc() }` populates stamp; treating "no source path" as
    // "not covered" would report generated columns as spec gaps.
    const src = `
schema src { id INT }
schema tgt { id INT stamp STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
  -> stamp { now_utc() }
}`;
    assertMapped(forRole(coverage(src, "load"), "target"), "stamp", true);
  });
});

// ── Source coverage ─────────────────────────────────────────────────────────

describe("computeMappingCoverage — source fields", () => {
  const SRC = `
schema src { id INT name STRING unused INT }
schema tgt { id INT label STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
  name -> label
}`;

  it("marks a source field read by an arrow as consumed", () => {
    const src = forRole(coverage(SRC, "load"), "source");
    assertMapped(src, "id", true);
    assertMapped(src, "name", true);
  });

  it("marks a source field no arrow reads as unconsumed", () => {
    // Unconsumed source fields are the "did we forget to map this?" signal.
    assertMapped(forRole(coverage(SRC, "load"), "source"), "unused", false);
  });

  it("reports one entry per schema when a mapping reads several sources", () => {
    // Multi-source mappings must not collapse into a single blended report;
    // per-schema totals are what the CLI table renders.
    const src = `
schema a { id INT }
schema b { rate DECIMAL }
schema tgt { id INT rate DECIMAL }
mapping load {
  source { a b }
  target { tgt }
  id -> id
  rate -> rate
}`;
    const sources = coverage(src, "load").schemas.filter((s) => s.role === "source");
    assert.deepEqual(sources.map((s) => s.schemaId).sort(), ["a", "b"]);
  });
});

// ── Nested record fields ────────────────────────────────────────────────────

describe("computeMappingCoverage — nested record fields", () => {
  const SRC = `
schema src { address record { line1 STRING line2 STRING } name STRING }
schema tgt { addr STRING name STRING }
mapping load {
  source { src }
  target { tgt }
  address.line1 -> addr
  name -> name
}`;

  it("emits an entry for the record itself and for every descendant", () => {
    // Consumers render a field tree; omitting either level would leave holes
    // in the gutter overlay and in per-schema totals.
    const paths = forRole(coverage(SRC, "load"), "source").fields.map((f) => f.path);
    assert.deepEqual(paths, ["address", "address.line1", "address.line2", "name"]);
  });

  it("covering a nested path covers its parent but not its siblings", () => {
    // The PRD's headline nested case: `address.line1 -> addr` must not silently
    // mark the whole `address` record's contents as done.
    const src = forRole(coverage(SRC, "load"), "source");
    assertMapped(src, "address", true);
    assertMapped(src, "address.line1", true);
    assertMapped(src, "address.line2", false);
  });
});

// ── each / flatten blocks ───────────────────────────────────────────────────

describe("computeMappingCoverage — each blocks", () => {
  const SRC = `
schema src { items list_of record { id INT val STRING } name STRING }
schema tgt { lines list_of record { item_id INT } name STRING }
mapping load {
  source { src }
  target { tgt }
  name -> name
  each items -> lines {
    id -> item_id
  }
}`;

  it("counts the iterated list as consumed on the source schema", () => {
    assertMapped(forRole(coverage(SRC, "load"), "source"), "items", true);
  });

  it("qualifies arrows inside the block against the iteration base", () => {
    // `id -> item_id` inside `each items -> lines` means items.id, not a
    // top-level `id`. Losing the base would mark the nested field uncovered
    // and the sibling `val` covered by leaf-name collision.
    const src = forRole(coverage(SRC, "load"), "source");
    assertMapped(src, "items.id", true);
    assertMapped(src, "items.val", false);
  });

  it("counts the each target list and its nested target field as mapped", () => {
    const tgt = forRole(coverage(SRC, "load"), "target");
    assertMapped(tgt, "lines", true);
    assertMapped(tgt, "lines.item_id", true);
  });

  it("qualifies a nested each block against its enclosing base", () => {
    // Two-level iteration is rare but real; the inner block's paths are
    // relative to the outer block's, not to the schema root.
    const src = `
schema src { orders list_of record { lines list_of record { sku STRING qty INT } } }
schema tgt { rows list_of record { items list_of record { code STRING } } }
mapping load {
  source { src }
  target { tgt }
  each orders -> rows {
    each lines -> items {
      sku -> code
    }
  }
}`;
    const source = forRole(coverage(src, "load"), "source");
    assertMapped(source, "orders.lines.sku", true);
    assertMapped(source, "orders.lines.qty", false);
  });
});

describe("computeMappingCoverage — flatten blocks", () => {
  // Written the way the spec does (§4.6): the flatten target is the target
  // *schema*, and element fields are referenced with a leading dot.
  const SRC = `
schema src { contacts list_of record { email STRING phone STRING } id INT }
schema tgt { primary_email STRING id INT spare STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
  flatten contacts -> tgt {
    .email -> primary_email
  }
}`;

  it("counts the unnested list and the arrow's qualified source path", () => {
    const src = forRole(coverage(SRC, "load"), "source");
    assertMapped(src, "contacts", true);
    assertMapped(src, "contacts.email", true);
    assertMapped(src, "contacts.phone", false);
  });

  it("treats target paths inside flatten as schema-root relative", () => {
    // Unlike each, flatten has no target base: its `-> tgt` names the target
    // schema, and the block unnests into flat fields, so `primary_email` must
    // resolve at the schema root rather than under a `tgt.` prefix.
    const tgt = forRole(coverage(SRC, "load"), "target");
    assertMapped(tgt, "primary_email", true);
    assertMapped(tgt, "spare", false);
  });
});

// ── Element-relative paths (sc-xnxp) ────────────────────────────────────────

describe("computeMappingCoverage — element-relative paths", () => {
  it("resolves .-prefixed source and target paths inside an each block", () => {
    // Regression lock for sc-xnxp: the leading dot of a relative_field_path
    // must be stripped before qualifying, or `.id` becomes "items..id" and the
    // declared field "items.id" never matches — reporting an explicitly mapped
    // field as a spec gap. This is the spec's canonical syntax, not an edge case.
    const src = `
schema src { items list_of record { id INT val STRING } }
schema tgt { lines list_of record { item_id INT spare INT } }
mapping load {
  source { src }
  target { tgt }
  each items -> lines {
    .id -> .item_id
  }
}`;
    const result = coverage(src, "load");
    const source = forRole(result, "source");
    assertMapped(source, "items.id", true);
    assertMapped(source, "items.val", false);
    const target = forRole(result, "target");
    assertMapped(target, "lines.item_id", true);
    assertMapped(target, "lines.spare", false);
  });

  it("resolves .-prefixed source paths inside a flatten block", () => {
    // Same defect, flatten arm: `.SKU` under `flatten Order.LineItems`.
    const src = `
schema commerce_order { Order record { OrderId INT LineItems list_of record { SKU STRING Qty INT } } }
schema flat { order_id INT sku STRING }
mapping load {
  source { commerce_order }
  target { flat }
  flatten Order.LineItems -> flat {
    .SKU -> sku
  }
  Order.OrderId -> order_id
}`;
    const source = forRole(coverage(src, "load"), "source");
    assertMapped(source, "Order.LineItems.SKU", true);
    assertMapped(source, "Order.LineItems.Qty", false);
  });
});

// ── Declaration positions ───────────────────────────────────────────────────

describe("computeMappingCoverage — declaration positions", () => {
  it("propagates the resolver's declaration row onto each entry", () => {
    // Downstream UIs turn (uri, line) into an editor-jump link, so the row
    // must survive the walk — including through nesting.
    const src = `schema src {
  address record {
    line1 STRING
  }
}
schema tgt { addr STRING }
mapping load {
  source { src }
  target { tgt }
  address.line1 -> addr
}`;
    const fields = forRole(coverage(src, "load"), "source").fields;
    // 0-indexed rows: `address` is on line 2 of the file, `line1` on line 3.
    assert.equal(fields.find((f) => f.path === "address").line, 1);
    assert.equal(fields.find((f) => f.path === "address.line1").line, 2);
  });

  it("omits line entirely when the resolver supplies no position", () => {
    // A missing position must never surface as 0 — that reads as "line 1" and
    // sends a jump link to the wrong place (sl-5sjp).
    const tree = getParser().parse(`
schema src { id INT }
schema tgt { id INT memo STRING }
mapping load {
  source { src }
  target { tgt }
  id -> id
}`);
    const result = computeMappingCoverage(tree, "load", (schemaId) =>
      schemaId === "tgt" ? { uri: TEST_URI, fields: [{ name: "id" }, { name: "memo" }] } : null,
    );
    for (const entry of forRole(result, "target").fields) {
      assert.ok(!("line" in entry), `expected no line key on ${entry.path}, got ${entry.line}`);
    }
  });
});

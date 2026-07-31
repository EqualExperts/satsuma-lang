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
import {
  initParser,
  getParser,
  computeMappingCoverage,
  extractSchemas,
  extractMappings,
  extractNLRefData,
  resolveAllNLRefs,
} from "@satsuma/core";

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
 * Run computeMappingCoverage over single-file source text, resolving schemas —
 * and NL `@refs` — from that same file.
 *
 * Resolving refs here rather than stubbing them means these tests exercise the
 * real `resolveRef` output shape (`{ kind: "field", name: "::schema.path" }`),
 * which is the contract coverage now depends on (ADR-036). A stub would let the
 * two drift.
 */
function coverage(source, mappingName) {
  const tree = getParser().parse(source);
  const byId = new Map();
  for (const s of extractSchemas(tree.rootNode)) {
    byId.set(s.namespace ? `${s.namespace}::${s.name}` : s.name, s);
  }
  return computeMappingCoverage(
    tree,
    mappingName,
    (schemaId) => {
      const schema = byId.get(schemaId);
      return schema ? { uri: TEST_URI, fields: toCoverageFields(schema.fields) } : null;
    },
    resolveRefsIn(tree, byId),
  );
}

/** Resolve every NL `@ref` in the tree against the schemas and mappings it declares. */
function resolveRefsIn(tree, schemasById) {
  const mappingsById = new Map();
  for (const m of extractMappings(tree.rootNode)) {
    const key = m.namespace ? `${m.namespace}::${m.name}` : m.name;
    mappingsById.set(key, { sources: m.sources, targets: m.targets });
  }
  const lookup = {
    hasSchema: (k) => schemasById.has(k),
    getSchema: (k) => {
      const s = schemasById.get(k);
      return s ? { fields: s.fields, hasSpreads: Boolean(s.spreads?.length), namespace: s.namespace } : null;
    },
    hasFragment: () => false,
    getFragment: () => null,
    hasTransform: () => false,
    getMapping: (k) => mappingsById.get(k) ?? null,
    iterateSchemas: () =>
      [...schemasById.entries()].map(([k, s]) => [k, { fields: s.fields, hasSpreads: false }]),
  };
  const items = extractNLRefData(tree.rootNode).map((item) => ({ ...item, file: TEST_URI }));
  return resolveAllNLRefs(items, lookup);
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

/** Assert `path` is covered and reported under `tier` ("declared" | "nl"). */
function assertTier(schema, path, tier) {
  const match = schema.fields.find((f) => f.path === path);
  assert.ok(match, `expected a "${path}" entry in ${schema.fields.map((f) => f.path)}`);
  assert.equal(match.mapped, true, `"${path}" should be covered`);
  assert.equal(match.tier, tier, `"${path}" should be covered in the ${tier} tier`);
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

// ── Nested containers (sl-qzy3) ─────────────────────────────────────────────

describe("computeMappingCoverage — nested containers", () => {
  // The walk must recurse over every container the grammar permits, in any
  // combination. It previously enumerated the children each parent accepted,
  // which silently dropped `flatten` inside `each` and `nested_arrow`
  // everywhere: explicitly mapped fields were reported as spec gaps, and
  // `--fail-under` would fail a complete spec.

  it("qualifies arrows inside a braced src -> tgt arrow against both sides", () => {
    // nested_arrow was absent from the walk entirely, so every field on both
    // sides of `addr -> address { ... }` reported uncovered despite explicit
    // arrows. The base applies to source and target alike, as it does for each.
    const src = `
schema src { addr record { street STRING city STRING } name STRING }
schema tgt { address record { line STRING city STRING } full STRING }
mapping load {
  source { src }
  target { tgt }
  name -> full
  addr -> address {
    .street -> .line
    .city -> .city
  }
}`;
    const result = coverage(src, "load");
    const s = forRole(result, "source");
    assertMapped(s, "addr", true);
    assertMapped(s, "addr.street", true);
    assertMapped(s, "addr.city", true);
    const t = forRole(result, "target");
    assertMapped(t, "address.line", true);
    assertMapped(t, "address.city", true);
  });

  it("leaves a sibling field uncovered when a nested_arrow does not map it", () => {
    // Guards against the opposite failure: recursing into nested_arrow must not
    // mark the whole subtree covered just because the container is referenced.
    const src = `
schema src { addr record { street STRING zip STRING } }
schema tgt { address record { line STRING zip STRING } }
mapping load {
  source { src }
  target { tgt }
  addr -> address {
    .street -> .line
  }
}`;
    const result = coverage(src, "load");
    assertMapped(forRole(result, "source"), "addr.zip", false);
    assertMapped(forRole(result, "target"), "address.zip", false);
  });

  it("resolves a flatten nested inside an each against the each's bases", () => {
    // The shape of examples/nested-iteration/pipeline.stm:100. The each child
    // loop handled each_block but not flatten_block, so the entire flatten
    // subtree — source and target — reported uncovered.
    const src = `
schema src { orders list_of record {
  parcels list_of record { barcode STRING contents list_of record { sku STRING } }
} }
schema tgt { orders list_of record { packed list_of record { sku STRING } } }
mapping load {
  source { src }
  target { tgt }
  each orders -> orders {
    flatten parcels.contents -> .packed {
      .sku -> .sku
    }
  }
}`;
    const result = coverage(src, "load");
    const s = forRole(result, "source");
    assertMapped(s, "orders.parcels", true);
    assertMapped(s, "orders.parcels.contents", true);
    assertMapped(s, "orders.parcels.contents.sku", true);
    // barcode is genuinely never read — the one real gap in this fixture.
    assertMapped(s, "orders.parcels.barcode", false);
    const t = forRole(result, "target");
    assertMapped(t, "orders.packed", true);
    assertMapped(t, "orders.packed.sku", true);
  });

  it("resolves an each nested inside a flatten", () => {
    // The mirror of the case above. collectFlattenPaths handled no nested
    // blocks at all, so an each inside a flatten contributed nothing.
    const src = `
schema src { rows list_of record { lines list_of record { sku STRING } } }
schema tgt { out list_of record { sku STRING } spare STRING }
mapping load {
  source { src }
  target { tgt }
  flatten rows -> tgt {
    each .lines -> out {
      .sku -> .sku
    }
  }
}`;
    const result = coverage(src, "load");
    const s = forRole(result, "source");
    assertMapped(s, "rows.lines", true);
    assertMapped(s, "rows.lines.sku", true);
    const t = forRole(result, "target");
    assertMapped(t, "out.sku", true);
    assertMapped(t, "spare", false);
  });

  it("keeps a top-level flatten's targets at the schema root while a relative one bases", () => {
    // Both flatten forms in one mapping. `-> tgt` names the target schema, so
    // `email` resolves at the root; `-> .packed` inside an each names a list
    // field on the current element, so `.sku` resolves under it. The authored
    // relative_field_path is what separates the two.
    const src = `
schema src {
  contacts list_of record { email STRING }
  orders list_of record { items list_of record { sku STRING } }
}
schema tgt {
  email STRING
  orders list_of record { packed list_of record { sku STRING } }
}
mapping load {
  source { src }
  target { tgt }
  flatten contacts -> tgt {
    .email -> email
  }
  each orders -> orders {
    flatten items -> .packed {
      .sku -> .sku
    }
  }
}`;
    const result = coverage(src, "load");
    const t = forRole(result, "target");
    assertMapped(t, "email", true);
    assertMapped(t, "orders.packed.sku", true);
  });
});

// ── Resolved NL @refs count, as a distinct tier (ADR-036, sl-qxyl) ───────────

describe("computeMappingCoverage — resolved NL @ref tier", () => {
  // ADR-013 settled that a resolved @ref carries the same lineage weight as a
  // declared source field, and arrows/graph/lineage/field-lineage/lint all honour
  // it. Coverage alone did not, so a mapping whose sources appear only in prose
  // reported every source field uncovered — and the aggregate "covered by no
  // mapping" list, which the docs call the claim worth acting on, named live
  // fields. ADR-036 reverses that and defines these tiers.

  it("counts a source field named only by a resolved @ref", () => {
    // The headline case from ADR-036: no arrow reads net_amount, but the prose
    // references it explicitly with the @ sigil and it resolves to a real field.
    const src = `
schema src { net_amount DECIMAL tax_amount DECIMAL unused DECIMAL }
schema tgt { gross_total DECIMAL }
mapping load {
  source { src }
  target { tgt }
  -> gross_total { "Add @net_amount and @tax_amount" }
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertTier(s, "net_amount", "nl");
    assertTier(s, "tax_amount", "nl");
    // Prose that names nothing covers nothing — the gap must survive.
    assertMapped(s, "unused", false);
  });

  it("reports a field covered both ways in the declared tier only", () => {
    // Declared coverage is the stronger claim, so it wins and the field is
    // counted once. Reporting the weaker tier would make a field an arrow
    // genuinely writes read as merely inferred from prose.
    const src = `
schema src { amount DECIMAL }
schema tgt { total DECIMAL }
mapping load {
  source { src }
  target { tgt }
  amount -> total { "rounded @amount" }
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertTier(s, "amount", "declared");
  });

  it("does not count an @ref that resolves to nothing", () => {
    // Letting an unresolved ref count would make coverage RISE when a spec
    // breaks. Reporting it is lint's unresolved-nl-ref, not coverage's job.
    const src = `
schema src { amount DECIMAL }
schema tgt { total DECIMAL }
mapping load {
  source { src }
  target { tgt }
  -> total { "derived from @no_such_field" }
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "amount", false);
  });

  it("does not let an @ref naming a schema or transform cover a field", () => {
    // Only kind:"field" resolutions are field references. A ref to the schema
    // itself resolves, but names no field, so it must contribute nothing.
    const src = `
schema src { amount DECIMAL }
schema tgt { total DECIMAL }
mapping load {
  source { src }
  target { tgt }
  -> total { "sum over @src" }
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "amount", false);
  });

  it("counts a source_block @ref toward source coverage", () => {
    // A join condition demonstrably reads the fields it joins on, so they are
    // consumed even though no arrow lists them.
    const src = `
schema a { id UUID }
schema b { id UUID note_only STRING }
schema tgt { out UUID }
mapping load {
  source {
    a,
    b,
    "Left join on @a.id = @b.id."
  }
  target { tgt }
  a.id -> out
}`;
    const b = coverage(src, "load").schemas.find((s) => s.schemaId === "b");
    assertTier(b, "id", "nl");
    assertMapped(b, "note_only", false);
  });

  it("never lets a source_block @ref cover a target field", () => {
    // A filter or join condition names no target field, so it cannot populate
    // one. Counting it would credit the target for work the mapping never does.
    const src = `
schema src { id UUID }
schema tgt { id UUID out STRING }
mapping load {
  source {
    src,
    "Filter where @tgt.out is not null."
  }
  target { tgt }
  src.id -> id
}`;
    const t = forRole(coverage(src, "load"), "target");
    assertTier(t, "id", "declared");
    assertMapped(t, "out", false);
  });

  it("resolves an @ref to a nested field path, not a bare leaf name", () => {
    // Interacts with sl-joeq: coverage matches whole paths, and a resolved ref
    // yields a canonical absolute path, so the nested field must be credited and
    // the same-named top-level field must not.
    const src = `
schema src { city STRING address record { city STRING } }
schema tgt { out STRING }
mapping load {
  source { src }
  target { tgt }
  -> out { "take @address.city" }
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertTier(s, "address.city", "nl");
    assertMapped(s, "city", false);
  });

  it("credits an @ref inside an each block against the real field path", () => {
    // Coverage depends on ref resolution now, so a resolution defect becomes a
    // coverage defect (ADR-036's recorded cost). sl-hrql and sl-ez36 fixed refs
    // inside each/flatten/nested_arrow resolving to fabricated paths; this pins
    // that coverage credits the real path and not the phantom.
    const src = `
schema src { lines list_of record { sku STRING qty INT } }
schema tgt { rows list_of record { code STRING note STRING } }
mapping load {
  source { src }
  target { rows }
  each lines -> rows {
    .sku -> .code
    -> .note { "describe @lines.qty" }
  }
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertTier(s, "lines.sku", "declared");
    assertTier(s, "lines.qty", "nl");
  });
});

// ── Container targets that are themselves nested paths (sl-vu22) ─────────────

describe("computeMappingCoverage — dotted container targets", () => {
  // Coverage no longer walks the CST for arrows; it reads extract.ts's records
  // (PRD 38 R4, ADR-037). These two shapes are where a derivation could plausibly
  // differ from the walk it replaced, and both appear in the shipped corpus.

  it("qualifies an each's arrows under a multi-segment container target", () => {
    // examples/cobol-to-avro/pipeline.stm:148 — `each PHONE_NUMBERS ->
    // contact_info.phones`. The container target is itself a nested path, so its
    // children must resolve to contact_info.phones.type, not phones.type or
    // type. A base that kept only the last segment would report the whole block
    // uncovered while marking a same-named top-level field mapped.
    const src = `
schema src { PHONE_NUMBERS list_of record { PHONE_TYPE STRING PHONE_NUM STRING } }
schema tgt {
  type STRING
  contact_info record { phones list_of record { type STRING number STRING } }
}
mapping load {
  source { src }
  target { tgt }
  each PHONE_NUMBERS -> contact_info.phones {
    .PHONE_TYPE -> .type
    .PHONE_NUM -> .number
  }
}`;
    const t = forRole(coverage(src, "load"), "target");
    assertMapped(t, "contact_info", true);
    assertMapped(t, "contact_info.phones", true);
    assertMapped(t, "contact_info.phones.type", true);
    assertMapped(t, "contact_info.phones.number", true);
    // The top-level `type` shares a name with the nested leaf and no arrow
    // writes it — the sl-joeq invariant, restated against a dotted base.
    assertMapped(t, "type", false);
  });

  it("unions two each blocks writing the same target list without double counting", () => {
    // examples/edi-to-json/pipeline.stm:137-171 — three `each` blocks write into
    // ShipmentHeader.asnDetails and its nested items. Each block contributes its
    // own leaves and the result is their union: a leaf written by either block is
    // covered, and one written by neither is not.
    const src = `
schema src {
  POReferences list_of record { poNumber STRING }
  LineItems list_of record { sku STRING }
  Quantities list_of record { qty INT }
}
schema tgt {
  ShipmentHeader record {
    asnDetails list_of record {
      poNumber STRING
      items list_of record { sku STRING qty INT uom STRING }
    }
  }
}
mapping load {
  source { src }
  target { tgt }
  each POReferences -> ShipmentHeader.asnDetails {
    .poNumber -> .poNumber
  }
  each LineItems -> ShipmentHeader.asnDetails.items {
    .sku -> .sku
  }
  each Quantities -> ShipmentHeader.asnDetails.items {
    .qty -> .qty
  }
}`;
    const t = forRole(coverage(src, "load"), "target");
    assertMapped(t, "ShipmentHeader.asnDetails.poNumber", true);
    assertMapped(t, "ShipmentHeader.asnDetails.items.sku", true);
    assertMapped(t, "ShipmentHeader.asnDetails.items.qty", true);
    // Written by none of the three blocks — the union must not swallow the gap.
    assertMapped(t, "ShipmentHeader.asnDetails.items.uom", false);
  });
});

// ── Coverage is by path, never by local field name (sl-joeq) ─────────────────

describe("computeMappingCoverage — path identity, not name identity", () => {
  // The covered set used to register each segment of a covered path as a
  // standalone bare name, so any field whose own path equalled a segment of some
  // other covered path read as mapped. Leaf-name reuse across depths (id, sku,
  // code, city, BIC) is normal in nested schemas, so the collision rate rose
  // with exactly the specs coverage analysis exists to check — and it failed
  // toward reporting an incomplete spec as complete.

  it("leaves a top-level field uncovered when only a nested field shares its name", () => {
    // The bare-segment leak's most direct form: a top-level field's path IS its
    // name, so it collided with the leaf of every nested path.
    const src = `
schema src { city STRING home_address record { city STRING } }
schema tgt { out STRING }
mapping load {
  source { src }
  target { tgt }
  home_address.city -> out
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "home_address.city", true);
    assertMapped(s, "city", false);
  });

  it("leaves intermediate segments of a deep path uncovered as top-level fields", () => {
    // Middle segments leaked too, not just leaves: with only a.b.c.d covered,
    // top-level fields named b, c and d all read as mapped.
    const src = `
schema src { b STRING c STRING d STRING a record { b record { c record { d STRING } } } }
schema tgt { out STRING }
mapping load {
  source { src }
  target { tgt }
  a.b.c.d -> out
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "a", true);
    assertMapped(s, "a.b.c.d", true);
    for (const path of ["b", "c", "d"]) assertMapped(s, path, false);
  });

  it("judges sibling records sharing a leaf name independently", () => {
    // The fragment-spread shape: one fragment spread into two sibling records
    // (examples/lib/sfdc_fragments.stm puts the same leaves under both
    // BillingAddress and ShippingAddress) means every leaf name exists twice.
    const src = `
schema src {
  BillingAddress record { Street STRING }
  ShippingAddress record { Street STRING }
}
schema tgt { out STRING }
mapping load {
  source { src }
  target { tgt }
  BillingAddress.Street -> out
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "BillingAddress.Street", true);
    assertMapped(s, "ShippingAddress.Street", false);
  });

  it("judges sibling list containers sharing leaf names independently", () => {
    // An untouched sibling list read as half-mapped purely because the list next
    // to it declares the same element field names.
    const src = `
schema src { orders record {
  lines list_of record { sku STRING qty INT }
  packed list_of record { sku STRING units INT }
} }
schema tgt { lines list_of record { sku STRING qty INT } }
mapping load {
  source { src }
  target { lines }
  each orders.lines -> lines {
    .sku -> .sku
    .qty -> .qty
  }
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "orders.lines.sku", true);
    assertMapped(s, "orders.packed.sku", false);
    assertMapped(s, "orders.packed.units", false);
  });

  it("distinguishes repeated leaf names at equal depth under different parents", () => {
    // The ISO-20022 case from tooling/satsuma-cli/test/fixtures/deep-nested-bugs.stm:
    // four agent records each declare BIC and only three are mapped. Confusing
    // the instructing with the instructed agent is precisely the error coverage
    // exists to surface in payment messaging.
    const src = `
schema pacs008 { GrpHdr record {
  InstgAgt record { BIC STRING }
  InstdAgt record { BIC STRING }
} }
schema iso_target { instructing_bic STRING }
mapping load {
  source { pacs008 }
  target { iso_target }
  GrpHdr.InstgAgt.BIC -> instructing_bic
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "GrpHdr.InstgAgt.BIC", true);
    assertMapped(s, "GrpHdr.InstdAgt.BIC", false);
  });
});

// ── Schema-qualified arrow references ───────────────────────────────────────

describe("computeMappingCoverage — schema-qualified arrow paths", () => {
  // Multi-source mappings qualify their arrows by schema
  // (`crm_customers.email -> email`). Coverage matches against paths declared
  // *within* a schema, so the prefix has to be resolved away first. Before
  // sl-joeq that only worked by accident — via bare-segment registration, which
  // matched the trailing leaf name and therefore also matched every same-named
  // field in every other source schema.

  const SRC = `
schema orders { amount DECIMAL tax DECIMAL }
schema billing { amount DECIMAL contact_email STRING }
schema summary { net_total DECIMAL }
mapping load {
  source { orders, billing }
  target { summary }
  orders.amount, orders.tax -> net_total
}`;

  it("strips the schema prefix so the qualified path matches the declared field", () => {
    const orders = coverage(SRC, "load").schemas.find((s) => s.schemaId === "orders");
    assertMapped(orders, "amount", true);
    assertMapped(orders, "tax", true);
  });

  it("does not credit a sibling source schema that declares the same field name", () => {
    // `billing` is joined but never read: its identically-named `amount` must
    // stay uncovered, and its own fields must not inherit orders' coverage.
    const billing = coverage(SRC, "load").schemas.find((s) => s.schemaId === "billing");
    assertMapped(billing, "amount", false);
    assertMapped(billing, "contact_email", false);
  });

  it("resolves a qualified path onto a nested field of the named schema", () => {
    // The governance.stm shape: `crm_customers.consent.email_marketing` must
    // resolve to the declared path `consent.email_marketing`. This case was
    // silently *under*-counted before — the qualified form matched only the bare
    // leaf, never the nested declared path.
    const src = `
schema crm { consent record { email_marketing BOOLEAN sms_marketing BOOLEAN } }
schema tgt { consent_email BOOLEAN }
mapping load {
  source { crm }
  target { tgt }
  crm.consent.email_marketing -> consent_email
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "consent", true);
    assertMapped(s, "consent.email_marketing", true);
    assertMapped(s, "consent.sms_marketing", false);
  });

  it("prefers a declared field over a schema prefix when the two share a name", () => {
    // A schema and one of its own top-level fields can collide. The declared
    // field is concrete evidence, so `orders.amount` reads as the nested path
    // rather than as a prefix that merely looks like one.
    const src = `
schema orders { orders record { amount DECIMAL } amount DECIMAL }
schema tgt { out DECIMAL }
mapping load {
  source { orders }
  target { tgt }
  orders.amount -> out
}`;
    const s = forRole(coverage(src, "load"), "source");
    assertMapped(s, "orders.amount", true);
    assertMapped(s, "amount", false);
  });
});

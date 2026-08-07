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
  uncoveredFieldCoverage,
  extractMappings,
  extractNLRefData,
  leafFieldEntries,
  resolveAllNLRefs,
  summarizeFieldCoverage,
  countContainerStates,
  createCanonicalEntityRef,
  declaresRecordBody,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

const TEST_URI = "file:///test.stm";

before(async () => {
  await initParser(WASM_PATH);
});

// ── Test resolver ───────────────────────────────────────────────────────────

/**
 * Project extractSchemas() FieldDecls onto core's minimal coverage shape.
 *
 * Mirrors the three real adapters, `container` included: it is taken from the
 * declared type because an empty `record {}` has no children to give it away
 * (ccc-3vaw). A test adapter that omitted it would model an adapter that does not
 * exist and hide that case from every test here.
 */
function toCoverageFields(fields) {
  return fields.map((f) => ({
    name: f.name,
    line: f.startRow,
    ...(declaresRecordBody(f.type) ? { container: true } : {}),
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
      return schema
        ? {
            canonicalRef: createCanonicalEntityRef(
              schemaId.includes("::") ? schemaId : `::${schemaId}`,
            ),
            uri: TEST_URI,
            fields: toCoverageFields(schema.fields),
          }
        : null;
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
      return s
        ? { fields: s.fields, hasSpreads: Boolean(s.spreads?.length), namespace: s.namespace }
        : null;
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
  assert.ok(
    schema,
    `expected a ${role} schema in ${JSON.stringify(result.schemas.map((s) => s.role))}`,
  );
  return schema;
}

/** Assert `path` appears exactly once and carries the expected mapped flag. */
function assertMapped(schema, path, expected) {
  const matches = schema.fields.filter((f) => f.path === path);
  assert.equal(
    matches.length,
    1,
    `expected exactly one "${path}" entry in ${schema.fields.map((f) => f.path)}`,
  );
  assert.equal(matches[0].mapped, expected, `"${path}" should be mapped=${expected}`);
}

/**
 * Assert `path` reports the expected tri-state, and that `mapped` agrees with it.
 *
 * The `mapped === (state !== "uncovered")` check rides along on every state
 * assertion deliberately: that equivalence is the contract keeping the VS Code
 * gutter byte-identical across the tri-state change (sl-0pun), and a single
 * place that broke it would otherwise go unnoticed.
 */
function assertState(schema, path, expected) {
  const match = schema.fields.find((f) => f.path === path);
  assert.ok(match, `expected a "${path}" entry in ${schema.fields.map((f) => f.path)}`);
  assert.equal(match.state, expected, `"${path}" should be ${expected}`);
  assert.equal(
    match.mapped,
    expected !== "uncovered",
    `"${path}" is ${expected}, so mapped should be ${expected !== "uncovered"}`,
  );
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
    assert.deepEqual(
      result.schemas.map((s) => s.schemaId),
      ["src"],
    );
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

  it("a whole-record arrow covers the record and every leaf beneath it", () => {
    // The case 3cc-iedv was raised for: `address -> address` between two records
    // asserts the structure maps across, so reporting its leaves as gaps reports
    // a gap the author explicitly closed. This test previously pinned the
    // opposite (sl-r6b0's boundary) — the flip is the acceptance signal.
    const WHOLE_RECORD = `
schema src { address record { line1 STRING line2 STRING } }
schema tgt { address record { line1 STRING line2 STRING } }
mapping copy {
  source { src }
  target { tgt }
  address -> address
}`;
    const tgt = forRole(coverage(WHOLE_RECORD, "copy"), "target");
    assertState(tgt, "address", "covered");
    assertState(tgt, "address.line1", "covered");
    assertState(tgt, "address.line2", "covered");
  });
});

// ── Whole-subtree arrows (PRD 38 R5, sl-r6b0, closes 3cc-iedv) ──────────────

describe("computeMappingCoverage — whole-subtree arrows", () => {
  it("counts every leaf of a wholesale-copied record toward the total", () => {
    // The headline R5 number: three leaves in, three leaves covered, 3/3.
    // Counting the record's leaves as gaps was the under-count 3cc-iedv records.
    const THREE_LEAVES = `
schema src { address record { line1 STRING line2 STRING city STRING } }
schema tgt { address record { line1 STRING line2 STRING city STRING } }
mapping copy {
  source { src }
  target { tgt }
  address -> address
}`;
    const tgt = forRole(coverage(THREE_LEAVES, "copy"), "target");
    const covered = tgt.fields.filter((f) => f.path.startsWith("address.") && f.mapped);
    assert.equal(covered.length, 3, "all three leaves are covered");
    assertState(tgt, "address", "covered");
  });

  it("does not let a record that is merely an ancestor confer coverage downward", () => {
    // The distinction R1's direct/derived split exists for, and the exact fix
    // 3cc-iedv says a naive "inherit from any covered ancestor" would break:
    // `address` is covered wholesale, `billing` only via one leaf. If ancestry
    // conferred coverage, `billing.line1` would read covered — turning "one of
    // twelve address fields is mapped" into "all twelve are".
    const MIXED = `
schema src {
  a record { line1 STRING city STRING }
  b STRING
}
schema tgt {
  address record { line1 STRING city STRING }
  billing record { line1 STRING city STRING }
}
mapping copy {
  source { src }
  target { tgt }
  a -> address
  b -> billing.city
}`;
    const tgt = forRole(coverage(MIXED, "copy"), "target");
    assertState(tgt, "address", "covered");
    assertState(tgt, "address.line1", "covered");
    assertState(tgt, "billing", "partial");
    assertState(tgt, "billing.city", "covered");
    assertState(tgt, "billing.line1", "uncovered");
  });

  it("expands a whole-subtree arrow onto a list_of record the same way", () => {
    // A list of records is a container like any other — the arrow asserts the
    // element structure maps across. Treating list_of differently would make the
    // rule depend on cardinality, which coverage has no view on.
    const LIST = `
schema src { lines list_of record { sku STRING qty INT } }
schema tgt { lines list_of record { sku STRING qty INT } }
mapping copy {
  source { src }
  target { tgt }
  lines -> lines
}`;
    const tgt = forRole(coverage(LIST, "copy"), "target");
    assertState(tgt, "lines", "covered");
    assertState(tgt, "lines.sku", "covered");
    assertState(tgt, "lines.qty", "covered");
  });

  it("expands nested records to their full depth, not one level", () => {
    // A subtree is a subtree. Stopping at direct children would leave the deepest
    // leaves — the ones hardest to notice missing — reported as gaps.
    const DEEP = `
schema src { v record { b record { x STRING y STRING } z STRING } }
schema tgt { a record { b record { x STRING y STRING } z STRING } }
mapping copy {
  source { src }
  target { tgt }
  v -> a
}`;
    const tgt = forRole(coverage(DEEP, "copy"), "target");
    assertState(tgt, "a", "covered");
    assertState(tgt, "a.b", "covered");
    assertState(tgt, "a.b.x", "covered");
    assertState(tgt, "a.z", "covered");
  });

  it("does not double count when a whole-subtree arrow overlaps a sibling arrow", () => {
    // Two arrows can name the same leaf — one wholesale, one specifically. The
    // covered set is a set, so the leaf is counted once and the percentage
    // cannot exceed 100%.
    const OVERLAP = `
schema src { a record { line1 STRING city STRING } b STRING }
schema tgt { address record { line1 STRING city STRING } }
mapping copy {
  source { src }
  target { tgt }
  a -> address
  b -> address.city
}`;
    const tgt = forRole(coverage(OVERLAP, "copy"), "target");
    const totals = summarizeFieldCoverage(tgt.fields);
    assert.deepEqual(
      { covered: totals.covered, total: totals.total, pct: totals.pct },
      { covered: 2, total: 2, pct: 100 },
    );
  });

  it("does not confer subtree coverage from an each block's iteration subject", () => {
    // The constraint that made this ticket depend on kind-awareness. `items` is
    // registered as a direct path because iterating a list consumes it — but the
    // block's body says only `id` maps, so `val` must stay a gap. Inheriting here
    // would manufacture coverage for every leaf under every `each` header.
    const EACH = `
schema src { items list_of record { id INT val STRING } }
schema tgt { lines list_of record { item_id INT } }
mapping load {
  source { src }
  target { tgt }
  each items -> lines {
    id -> item_id
  }
}`;
    const src = forRole(coverage(EACH, "load"), "source");
    assertState(src, "items", "partial");
    assertState(src, "items.id", "covered");
    assertState(src, "items.val", "uncovered");
  });

  it("confers subtree coverage from a nested arrow whose body enumerates nothing", () => {
    // ADR-037's second condition. `customer -> cust { }` is a record-to-record
    // correspondence that lists no child, so it narrows nothing and reads as
    // wholesale — the same claim as `customer -> cust` written without braces.
    // The paired case below is what happens once the body does list a child.
    const EMPTY_BODY = `
schema src { customer record { name STRING email STRING } }
schema tgt { cust record { name STRING } }
mapping load {
  source { src }
  target { tgt }
  customer -> cust {
  }
}`;
    const src = forRole(coverage(EMPTY_BODY, "load"), "source");
    assertState(src, "customer", "covered");
    assertState(src, "customer.email", "covered");
  });

  it("stops conferring once a nested arrow's body enumerates a child", () => {
    // The narrowing rule, and the invariant sl-qzy3 established: a header that
    // says which fields map is claiming those and no others, so `email` — named
    // nowhere — stays a gap. Without this, adding one child arrow to a wholesale
    // copy would be the only way to *lose* coverage, which is backwards.
    const ENUMERATED = `
schema src { customer record { name STRING email STRING } }
schema tgt { cust record { name STRING } }
mapping load {
  source { src }
  target { tgt }
  customer -> cust {
    .name -> .name
  }
}`;
    const src = forRole(coverage(ENUMERATED, "load"), "source");
    assertState(src, "customer", "partial");
    assertState(src, "customer.name", "covered");
    assertState(src, "customer.email", "uncovered");
  });

  it("expands a whole-subtree arrow written with a schema prefix", () => {
    // In a multi-source mapping arrows name their schema. Expansion runs after
    // the prefix is resolved away, so `crm.address -> address` must reach the
    // leaves of `crm`'s address — and contribute nothing to the other source.
    const QUALIFIED = `
schema crm { address record { line1 STRING city STRING } }
schema ops { address record { line1 STRING city STRING } }
schema tgt { out STRING }
mapping load {
  source { crm, ops }
  target { tgt }
  crm.address -> out
}`;
    const result = coverage(QUALIFIED, "load");
    const crm = result.schemas.find((s) => s.schemaId === "crm");
    const ops = result.schemas.find((s) => s.schemaId === "ops");
    assertState(crm, "address", "covered");
    assertState(crm, "address.city", "covered");
    assertState(ops, "address", "uncovered");
  });

  it("does not confer subtree coverage from a flatten header, even with an empty body", () => {
    // `flatten` is the second iteration kind, and it reaches its
    // ArrowDeclarationKind through its own switch arm — so nothing in the `each`
    // test above would notice if `flatten_block` were mapped to a conferring
    // kind. The body is empty deliberately: with no child arrows to narrow the
    // claim, the ONLY thing standing between this header and a fully covered
    // subtree is the kind check, so a regression there fails here and nowhere
    // else.
    const EMPTY_FLATTEN = `
schema src { parcels list_of record { sku STRING qty INT } }
schema tgt { rows list_of record { sku STRING } }
mapping load {
  source { src }
  target { tgt }
  flatten parcels -> rows {
  }
}`;
    const src = forRole(coverage(EMPTY_FLATTEN, "load"), "source");
    assertState(src, "parcels", "uncovered");
    assertState(src, "parcels.sku", "uncovered");
    assertState(src, "parcels.qty", "uncovered");
  });

  it("still confers when the body is a pipe-chain transform rather than child arrows", () => {
    // ADR-037's second condition turns on *enumeration*, not on the presence of
    // braces. Spec §4.4 makes a pipe-chain body a transform pipeline rather than
    // a nesting scope, so it narrows nothing and the whole record is still read.
    // Were `enumeratesChildren` ever loosened to "has a braced body", this is the
    // case that would silently start reporting `addr`'s leaves as gaps.
    const PIPE_BODY = `
schema src { addr record { line1 STRING city STRING } }
schema tgt { out STRING }
mapping load {
  source { src }
  target { tgt }
  addr -> out { "join the parts" | "uppercase" }
}`;
    const src = forRole(coverage(PIPE_BODY, "load"), "source");
    assertState(src, "addr", "covered");
    assertState(src, "addr.line1", "covered");
    assertState(src, "addr.city", "covered");
  });

  it("expands every source of a multi-source arrow, not just the first", () => {
    // A multi-source arrow asserts the same correspondence once per source, and
    // `sources` is a list precisely because more than one may be named. Expanding
    // only the first would leave the later records reporting as unconsumed while
    // the mapping demonstrably reads them.
    const MULTI_SOURCE = `
schema src { home record { city STRING } work record { city STRING } }
schema tgt { summary STRING }
mapping load {
  source { src }
  target { tgt }
  home, work -> summary
}`;
    const src = forRole(coverage(MULTI_SOURCE, "load"), "source");
    assertState(src, "home.city", "covered");
    assertState(src, "work.city", "covered");
  });

  it("does not confer onto a record target when the source is a scalar", () => {
    // ADR-038, and the flip this test was written for: it previously asserted
    // `covered` here, pinning the generous reading ADR-037 shipped, with a
    // comment saying it would flip if 3ct-cs4y tightened the target side. It did.
    //
    // One scalar cannot populate two leaves, and the declaration says nothing
    // about which leaf it would fill — so crediting both is an overstatement in
    // the direction ADR-034 refused to risk, on the very number `--fail-under`
    // gates. `address` still reports uncovered rather than partial: nothing
    // beneath it is written at all.
    //
    // The arrow is not wrong, merely under-specified, and saying so is the
    // CLI's `unenumerated-record-target` lint rule — not coverage's job.
    const SCALAR_INTO_RECORD = `
schema src { full_name STRING }
schema tgt { address record { line1 STRING city STRING } }
mapping load {
  source { src }
  target { tgt }
  full_name -> address
}`;
    const tgt = forRole(coverage(SCALAR_INTO_RECORD, "load"), "target");
    assertState(tgt, "address", "uncovered");
    assertState(tgt, "address.line1", "uncovered");
    assertState(tgt, "address.city", "uncovered");
  });

  it("still confers onto a record target when the source is a record", () => {
    // The complement, and the case ADR-038 must not break: 3cc-iedv's original
    // defect. A record arriving at a record is exactly the correspondence
    // whole-structure expansion exists for, so tightening the scalar case must
    // leave this one crediting every leaf.
    const RECORD_INTO_RECORD = `
schema src { addr record { line1 STRING city STRING } }
schema tgt { address record { line1 STRING city STRING } }
mapping load {
  source { src }
  target { tgt }
  addr -> address
}`;
    const tgt = forRole(coverage(RECORD_INTO_RECORD, "load"), "target");
    assertState(tgt, "address", "covered");
    assertState(tgt, "address.line1", "covered");
  });

  it("keeps crediting a record source consumed by a scalar target", () => {
    // ADR-038 tightens the TARGET side only. `addr -> out` reads the whole of
    // `addr` whatever receives it, so source coverage must be unaffected —
    // requiring records on both sides would turn every record-to-scalar arrow
    // into a false "unconsumed source field" in the review queue.
    const RECORD_INTO_SCALAR = `
schema src { addr record { line1 STRING city STRING } }
schema tgt { out STRING }
mapping load {
  source { src }
  target { tgt }
  addr -> out
}`;
    const src = forRole(coverage(RECORD_INTO_SCALAR, "load"), "source");
    assertState(src, "addr", "covered");
    assertState(src, "addr.line1", "covered");
    assertState(src, "addr.city", "covered");
  });

  it("confers when any one source of a multi-source arrow is a record", () => {
    // ADR-038's any-one rule. A multi-source arrow asserts a single
    // correspondence assembled from several inputs; a record among them makes
    // the whole-structure reading plausible, and requiring every source to be
    // one would turn a mixed arrow into a gap.
    const MIXED_SOURCES = `
schema src { addr record { line1 STRING city STRING } tag STRING }
schema tgt { address record { line1 STRING city STRING } }
mapping load {
  source { src }
  target { tgt }
  addr, tag -> address
}`;
    const tgt = forRole(coverage(MIXED_SOURCES, "load"), "target");
    assertState(tgt, "address", "covered");
    assertState(tgt, "address.city", "covered");
  });

  it("does not confer when the source path names nothing the schema declares", () => {
    // Fails closed (ADR-038). A typo'd or unresolvable source is not evidence of
    // a record, and under-counting is the safe direction — the alternative is a
    // gate passing because a source name was misspelled. `validate` reports the
    // bad reference itself, via field-not-in-schema.
    const UNKNOWN_SOURCE = `
schema src { addr record { line1 STRING } }
schema tgt { address record { line1 STRING city STRING } }
mapping load {
  source { src }
  target { tgt }
  nonexistent -> address
}`;
    const tgt = forRole(coverage(UNKNOWN_SOURCE, "load"), "target");
    assertState(tgt, "address", "uncovered");
  });
});

// ── Container tri-state (PRD 38 R2, sl-0pun) ────────────────────────────────

describe("computeMappingCoverage — container tri-state", () => {
  /** Three sibling leaves under one record, with `mapped` naming which are covered. */
  const threeLeafRecord = (arrows) => `
schema src { a INT b INT c INT }
schema tgt { addr record { line1 STRING line2 STRING city STRING } }
mapping load {
  source { src }
  target { tgt }
${arrows}
}`;

  it("reports a record with some but not all leaves covered as partial", () => {
    // The signal feature 36 R2 needs and no boolean could carry: one of three
    // leaves mapped is neither "done" nor "untouched".
    const tgt = forRole(coverage(threeLeafRecord("  a -> addr.line1"), "load"), "target");
    assertState(tgt, "addr", "partial");
    assertState(tgt, "addr.line1", "covered");
    assertState(tgt, "addr.line2", "uncovered");
  });

  it("reports a record as covered only when every leaf is covered", () => {
    const arrows = "  a -> addr.line1\n  b -> addr.line2\n  c -> addr.city";
    const tgt = forRole(coverage(threeLeafRecord(arrows), "load"), "target");
    assertState(tgt, "addr", "covered");
  });

  it("reports a record with no covered leaf as uncovered", () => {
    const tgt = forRole(coverage(threeLeafRecord("  a -> a"), "load"), "target");
    assertState(tgt, "addr", "uncovered");
    assertState(tgt, "addr.line1", "uncovered");
  });

  it("never reports a leaf as partial", () => {
    // Leaves are binary by definition — there is nothing beneath them to be
    // partly done. A consumer branching on `state` must be able to rely on that
    // rather than defensively handling a third case at every leaf.
    //
    // Leafness comes from `leafFieldEntries` — the same definition the counting
    // rule uses — rather than from a hand-written list of this fixture's paths,
    // so the invariant is asserted over whatever the walk emits and a fixture
    // that grew a nested container would not turn this into a false failure.
    // The assertion is positive (state is one of the two legal values) so that
    // dropping `state` altogether fails here rather than passing on undefined.
    const src = forRole(coverage(threeLeafRecord("  a -> addr.line1"), "load"), "source");
    const tgt = forRole(coverage(threeLeafRecord("  a -> addr.line1"), "load"), "target");
    const leaves = [...leafFieldEntries(src.fields), ...leafFieldEntries(tgt.fields)];
    assert.ok(leaves.length > 0, "fixture must produce leaves for this to assert anything");
    for (const entry of leaves) {
      assert.ok(
        entry.state === "covered" || entry.state === "uncovered",
        `leaf "${entry.path}" reported ${JSON.stringify(entry.state)}; leaves are binary`,
      );
    }
    // …and the fixture does contain a container that IS partial, so the check
    // above is discriminating rather than vacuously true of every entry.
    assertState(tgt, "addr", "partial");
  });

  it("marks an empty record as a container and judges it on its own path (ccc-3vaw)", () => {
    // `record {}` is legal Satsuma with no children, so nothing about the entry
    // list says it is structure — and it was reported as a leaf, entering the
    // denominator and missing from the container tally. Two properties here: the
    // entry carries `container`, and its state comes from its own path, since
    // there is no subtree to roll up. `blob -> hollow` covers it; `spare` does not.
    const EMPTY = `
schema src { blob record {} spare INT }
schema tgt { hollow record {} untouched record {} amount INT }
mapping load {
  source { src }
  target { tgt }
  blob -> hollow
  spare -> amount
}`;
    const tgt = forRole(coverage(EMPTY, "load"), "target");
    const byPath = new Map(tgt.fields.map((f) => [f.path, f]));
    assert.equal(byPath.get("hollow").container, true);
    assertState(tgt, "hollow", "covered");
    assertState(tgt, "untouched", "uncovered");
    // A leaf beside them keeps no flag at all, so the two are distinguishable.
    assert.equal(byPath.get("amount").container, undefined);
    // And the counting rule follows from the flag: one leaf, not three.
    assert.deepEqual(summarizeFieldCoverage(tgt.fields).total, 1);
    assert.deepEqual(countContainerStates(tgt.fields), {
      covered: 1,
      partial: 0,
      uncovered: 1,
    });
  });

  it("rolls a record of nothing but empty records up to partial", () => {
    // The rollup unit is "has nothing declared beneath it", which is not the same
    // set as the leaves: an empty record is a unit *and* a container. Were it
    // dropped from the units, `outer` here would have none and could not be
    // partial — it would read `covered` off one covered child.
    const NESTED_EMPTY = `
schema src { a record {} b record {} }
schema tgt { outer record { first record {} second record {} } }
mapping load {
  source { src }
  target { tgt }
  a -> outer.first
}`;
    const tgt = forRole(coverage(NESTED_EMPTY, "load"), "target");
    assertState(tgt, "outer", "partial");
    assertState(tgt, "outer.first", "covered");
    assertState(tgt, "outer.second", "uncovered");
  });

  it("propagates partial upward through every enclosing record, but not covered", () => {
    // PRD 38 R2 case 15. With only `a.b.x` mapped, `a.b` is partial (y is not)
    // and so is `a` — a grandparent must not read as done because one
    // grandchild is. Covered stops where it stops.
    const NESTED = `
schema src { v INT }
schema tgt { a record { b record { x STRING y STRING } } }
mapping load {
  source { src }
  target { tgt }
  v -> a.b.x
}`;
    const tgt = forRole(coverage(NESTED, "load"), "target");
    assertState(tgt, "a", "partial");
    assertState(tgt, "a.b", "partial");
    assertState(tgt, "a.b.x", "covered");
    assertState(tgt, "a.b.y", "uncovered");
  });

  it("leaves a container uncovered when an each block references it with an empty body", () => {
    // PRD 38 R2 case 16, and the invariant the whole tri-state rests on: a
    // container *reference* must not manufacture leaf coverage. `each parcels ->
    // .packed { }` says an iteration exists, not that anything inside it maps —
    // and before sl-0pun `packed` read as mapped on exactly that evidence.
    const EMPTY_EACH = `
schema src { parcels list_of record { sku STRING } }
schema tgt { packed list_of record { sku STRING units INT } }
mapping load {
  source { src }
  target { tgt }
  each parcels -> packed {
  }
}`;
    const tgt = forRole(coverage(EMPTY_EACH, "load"), "target");
    assertState(tgt, "packed", "uncovered");
    assertState(tgt, "packed.sku", "uncovered");
  });

  it("leaves a container uncovered when only a computed arrow targets it", () => {
    // PRD 38 R2 case 17, from `examples/edi-to-json`: a computed arrow whose body
    // is prose describing a known data gap (`//! DATA GAP: containers required
    // but no source data`). Nothing populates the leaves, and the author says so,
    // so coverage must keep reporting the gap rather than close it on the
    // strength of a target path being named.
    const COMPUTED_INTO_RECORD = `
schema src { v INT }
schema tgt { containers list_of record { id STRING seal STRING } }
mapping load {
  source { src }
  target { tgt }
  -> containers {
    "Required by the target schema but no source data is available."
  }
}`;
    const tgt = forRole(coverage(COMPUTED_INTO_RECORD, "load"), "target");
    assertState(tgt, "containers", "uncovered");
    assertState(tgt, "containers.id", "uncovered");
  });

  it("reports the strongest tier among a container's covered leaves", () => {
    // A record holding one arrow-written leaf and one only named in prose is a
    // `declared` claim, not an inferred one (ADR-036). Reporting `nl` because it
    // happened to be seen last would understate what the mapping declares.
    const MIXED_TIERS = `
schema src { addr record { line1 STRING city STRING } }
schema tgt { out STRING }
mapping load {
  source { src }
  target { tgt }
  addr.line1 -> out { "Append @src.addr.city to it." }
}`;
    const src = forRole(coverage(MIXED_TIERS, "load"), "source");
    assertTier(src, "addr.line1", "declared");
    assertTier(src, "addr.city", "nl");
    assertTier(src, "addr", "declared");
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

  it("reads a top-level dotted each target as the undotted one, not as a stray path", () => {
    // tced-ewd4. `each items -> .lines` at mapping-body level has no enclosing
    // block, so the dot's frame is the target schema root and it means `lines`.
    // Coverage used to keep the dot: the path reached properPrefixesOf as
    // ".lines", whose empty first segment cannot be branded a SchemaLocalPath,
    // and the whole command died with "Schema-local path must not be empty".
    // Asserting against the undotted spelling rather than a literal expectation
    // pins the property that actually matters — the two are one spec (§4.6),
    // so no future change may make them diverge in either direction.
    const dotted = SRC.replace("each items -> lines", "each items -> .lines");
    assert.notEqual(dotted, SRC, "the dotted variant must differ from SRC");

    assert.deepEqual(coverage(dotted, "load"), coverage(SRC, "load"));
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
      schemaId === "tgt"
        ? {
            canonicalRef: createCanonicalEntityRef("::tgt"),
            uri: TEST_URI,
            fields: [{ name: "id" }, { name: "memo" }],
          }
        : null,
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

// ── Parse-error recovery ─────────────────────────────────────────────────────
//
// Coverage runs on files with parse errors (the CLI warns and proceeds), so
// whatever tree-sitter's error recovery surfaces to extraction is part of the
// behaviour worth pinning.

describe("computeMappingCoverage — parse-error recovery", () => {
  it("a bracket-malformed arrow ('items[].id -> sku') confers no source coverage (sl-8o1n)", () => {
    // sl-8o1n deleted the build-side [] normalisation because v2 rejects
    // brackets at parse time. True — but error recovery still hands the
    // malformed arrow to extraction, and before the deletion the
    // normalisation quietly rewrote "items[].id" to "items.id" there, making
    // source coverage RISE on a broken file (found by differential testing
    // against pre-PR-414 main). This pins the corrected behaviour: the
    // malformed ref matches no declared path, in the same direction as
    // ADR-036's rule that a spec breaking must never raise coverage.
    const BRACKETS = `
schema src { items list_of record { id STRING } }
schema tgt { sku STRING }
mapping load {
  source { src }
  target { tgt }
  items[].id -> sku
}`;
    const s = forRole(coverage(BRACKETS, "load"), "source");
    assertMapped(s, "items.id", false);
  });
});

// ── Schemas no mapping touches (sl-hcan) ─────────────────────────────────────
//
// A consumer showing a schema that no mapping references still needs a
// denominator — the viz overview renders one card per declared schema. ADR-034
// requires one number per workspace across `satsuma coverage`, the VS Code
// status bar and the viz card, so that denominator has to be counted by the
// same rules as every other, not by the consumer counting its own field tree.

describe("uncoveredFieldCoverage()", () => {
  const NESTED = `
schema tgt {
  amount DECIMAL
  address record { city STRING line1 STRING postcode STRING }
}`;

  /** The declared field tree of `tgt`, in core's minimal coverage shape. */
  function targetFields(source = NESTED, schemaName = "tgt") {
    const tree = getParser().parse(source);
    const schema = extractSchemas(tree.rootNode).find((s) => s.name === schemaName);
    return toCoverageFields(schema.fields);
  }

  it("reports every field uncovered, records included", () => {
    // The container must read `uncovered` rather than be omitted or left
    // undefined: a card renders the tri-state per row, and an absent state is
    // not the same claim as "nothing under here is mapped".
    const entries = uncoveredFieldCoverage(targetFields(), TEST_URI);
    assert.deepEqual(
      entries.map((f) => [f.path, f.state, f.mapped]),
      [
        ["amount", "uncovered", false],
        ["address", "uncovered", false],
        ["address.city", "uncovered", false],
        ["address.line1", "uncovered", false],
        ["address.postcode", "uncovered", false],
      ],
    );
    assert.equal(
      entries.every((f) => f.tier === undefined),
      true,
    );
  });

  it("counts leaves only, so nesting depth alone cannot move the denominator", () => {
    // The figure sl-hcan cites, in its zero-covered form: `amount` plus a
    // three-leaf `address` is 0/4, not 0/5. Counting the record too — the viz
    // card's old rule — inflated every denominator by its nesting.
    assert.deepEqual(summarizeFieldCoverage(uncoveredFieldCoverage(targetFields(), TEST_URI)), {
      covered: 0,
      coveredDeclared: 0,
      coveredNl: 0,
      total: 4,
      pct: 0,
    });
  });

  it("gives a flat and a deeply nested schema with the same leaves the same denominator", () => {
    // Depth invariance, stated as a property rather than a figure: re-nesting a
    // schema without changing its leaves must not move the number. This is what
    // makes a coverage percentage comparable between two schemas, and what
    // counting containers destroyed.
    const FLAT = `schema tgt { a STRING b STRING c STRING d STRING }`;
    const DEEP = `schema tgt { a STRING outer record { b STRING mid record { c STRING inner record { d STRING } } } }`;

    const flat = summarizeFieldCoverage(uncoveredFieldCoverage(targetFields(FLAT), TEST_URI));
    const deep = summarizeFieldCoverage(uncoveredFieldCoverage(targetFields(DEEP), TEST_URI));
    assert.deepEqual(flat, deep);
    assert.equal(flat.total, 4);
  });

  it("agrees with computeMappingCoverage on a mapping that covers nothing", () => {
    // The two entry points must produce the same shape for the same schema, or
    // a card seeded with this list and later unioned with a real result would
    // disagree with itself.
    const EMPTY = `
schema src { unused STRING }
schema tgt {
  amount DECIMAL
  address record { city STRING line1 STRING postcode STRING }
}
mapping load {
  source { src }
  target { tgt }
}`;
    const viaCst = forRole(coverage(EMPTY, "load"), "target");
    assert.deepEqual(uncoveredFieldCoverage(targetFields(EMPTY), TEST_URI), viaCst.fields);
  });
});

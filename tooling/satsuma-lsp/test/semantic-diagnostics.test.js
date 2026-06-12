const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  createWorkspaceIndex,
  indexFile,
  createScopedIndex,
  getImportReachableUris,
} = require("../dist/workspace-index");
const {
  computeMissingImportDiagnostics,
  computeCoreSemanticDiagnostics,
  computeScopedSemanticDiagnostics,
} = require("../dist/semantic-diagnostics");

before(async () => { await initTestParser(); });

/** Build an index from a map of { uri: source }. */
function buildIndex(files) {
  const idx = createWorkspaceIndex();
  for (const [uri, source] of Object.entries(files)) {
    indexFile(idx, uri, parse(source));
  }
  return idx;
}

describe("computeMissingImportDiagnostics", () => {
  it("emits no diagnostics when all source/target refs are defined in the same file", () => {
    const src = `schema customers { id UUID }
mapping m {
  source { customers }
  target { customers }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeMissingImportDiagnostics(parse(src), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("emits no diagnostics when the referenced schema is imported", () => {
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `schema orders { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("emits a missing-import diagnostic when a source ref exists in workspace but is not imported", () => {
    const aSrc = `mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `schema orders { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.ok(diags.length > 0, "expected at least one missing-import diagnostic");
    const diag = diags[0];
    assert.equal(diag.code, "missing-import");
    assert.equal(diag.source, "satsuma");
    assert.ok(diag.message.includes("orders"), "message should mention the symbol name");
    assert.ok(diag.message.includes("import"), "message should suggest an import");
  });

  it("ignores quoted join descriptions when checking missing imports", () => {
    const aSrc = `schema a { id INT }
schema b { id INT }
schema t { id INT }
mapping m {
  source {
    a
    b
    "Join on a.id = b.id WHERE @a.status = complete"
  }
  target { t }
  a.id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": aSrc });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("includes the suggested import statement in the diagnostic message", () => {
    const aSrc = `mapping m {
  source { customers }
  target { customers }
  id -> id
}`;
    const bSrc = `schema customers { id UUID }`;
    const idx = buildIndex({
      "file:///project/a.stm": aSrc,
      "file:///project/b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///project/a.stm", idx);
    assert.ok(diags.length > 0);
    const msg = diags[0].message;
    // Suggestion should include the schema name and a path
    assert.ok(msg.includes("customers"));
    assert.ok(msg.includes("b.stm"), `expected b.stm in suggestion, got: ${msg}`);
  });

  it("does not flag symbols that are not defined anywhere (leaves those to validate)", () => {
    // 'ghost_schema' does not appear in any indexed file
    const aSrc = `mapping m {
  source { ghost_schema }
  target { ghost_schema }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": aSrc });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("does not emit missing-import for import context references", () => {
    // The import declaration itself references 'orders' — that should not be flagged
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `schema orders { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    // orders IS imported, so no missing-import diagnostics
    assert.equal(diags.length, 0);
  });

  it("allows directly imported symbols even when the imported file has its own imports", () => {
    // a imports { orders } from b. b imports { customers } from c.
    // a references only orders (directly imported) — no diagnostic needed.
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `import { customers } from "c.stm"\nschema orders { id UUID }`;
    const cSrc = `schema customers { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
      "file:///c.stm": cSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    // orders is imported — no diagnostic
    assert.equal(diags.length, 0);
  });

  it("flags symbols from transitively reachable files that are not dependencies of imported symbols (sl-cf9t)", () => {
    // a imports { orders } from b. b imports { customers } from c.
    // a tries to use customers — but customers is NOT a dependency of orders,
    // so it is not reachable from a's imports (ADR-022 symbol-level scoping).
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { customers }
  target { orders }
  id -> id
}`;
    const bSrc = `import { customers } from "c.stm"\nschema orders { id UUID }`;
    const cSrc = `schema customers { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
      "file:///c.stm": cSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    const importDiag = diags.find((d) => d.code === "missing-import");
    assert.ok(importDiag, "expected a missing-import diagnostic for customers");
    assert.ok(importDiag.message.includes("customers"), "diagnostic should name the symbol");
  });
});

describe("computeCoreSemanticDiagnostics", () => {
  // sl-ei1e: the index-to-semantic adapter gathered source/target refs for a
  // mapping from EVERY reference in the same file, so each mapping inherited
  // every other mapping's refs — an undefined source in one mapping produced
  // one diagnostic per mapping in the file, most of them misattributed.

  it("attributes an undefined mapping source only to the mapping that references it (sl-ei1e)", () => {
    const src = `schema s { id INT }
schema t { id INT }
mapping good {
  source { s }
  target { t }
  id -> id
}
mapping bad {
  source { does_not_exist }
  target { t }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", idx);
    const undef = diags.filter(
      (d) => d.code === "undefined-ref" && d.message.includes("does_not_exist"),
    );
    assert.equal(undef.length, 1, "exactly one diagnostic for the single bad ref");
    // The diagnostic must sit on mapping `bad` (line 7), not on `good`.
    assert.equal(undef[0].range.start.line, 7);
    assert.ok(undef[0].message.includes("bad"), "message should name the offending mapping");
  });

  it("attributes an undefined metric source only to the metric that references it (sl-ei1e)", () => {
    // Metrics share the same per-file ref-gathering shape as mappings, so the
    // same union bug applied to metric_source refs.
    const src = `schema fact_orders { amount DECIMAL }
schema good_metric (metric, source fact_orders) {
  value DECIMAL (measure additive)
}
schema bad_metric (metric, source missing_fact) {
  value DECIMAL (measure additive)
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", idx);
    const undef = diags.filter(
      (d) => d.code === "undefined-ref" && d.message.includes("missing_fact"),
    );
    assert.equal(undef.length, 1, "exactly one diagnostic for the single bad metric source");
    assert.equal(undef[0].range.start.line, 4);
  });

  // Regression for lnd-qqo7: a v2 metric is a schema_block decorated with
  // the (metric) tag, so a mapping may target it like any other schema —
  // the CLI index-builder records it in both the schemas and metrics maps.
  // The LSP adapter routed metric entries only into the metrics map, so
  // core's target resolution (schemas + fragments) missed them and reported
  // a false undefined-ref for e.g. examples/namespaces/namespaces.stm.
  it("does not report undefined-ref for a mapping targeting a metric in the same namespace", () => {
    const src = `namespace analytics (note "Business metrics layer") {
  schema staging_sales { order_date DATE }
  schema daily_sales (metric, grain daily) {
    sale_date DATE
  }
  mapping pipeline {
    source { staging_sales }
    target { analytics::daily_sales }
    order_date -> sale_date
  }
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", idx);
    assert.equal(
      diags.filter((d) => d.code === "undefined-ref").length,
      0,
      "a qualified metric target in the same namespace must resolve",
    );
  });

  it("does not report quoted join descriptions as undefined mapping sources", () => {
    const src = `schema a { id INT }
schema b { id INT }
schema t { id INT }
mapping m {
  source {
    a
    b
    "Join on a.id = b.id WHERE @a.status = complete"
  }
  target { t }
  a.id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("does not report duplicate definitions from files outside the active import graph", () => {
    const aSrc = `schema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", scoped);
    assert.equal(diags.length, 0);
  });

  it("reports duplicate definitions when both files are in the active import graph", () => {
    const aSrc = `import { orders } from "b.stm"\nschema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///b.stm", scoped);
    const dupDiag = diags.find((d) => d.code === "duplicate-definition");
    assert.ok(dupDiag, "expected a duplicate-definition diagnostic");
  });

  // Regression for sl-akz6 / gh-274: on Windows the startup scan indexes a
  // file under pathToFileURL's spelling (file:///C:/...) while didOpen indexes
  // it under the client's spelling (file:///c%3A/...). Without canonical index
  // keys the file exists twice and every definition in it is reported as a
  // duplicate.
  it("does not report duplicates when the same file is indexed under two Windows URI spellings", () => {
    const src = `schema orders { id UUID }`;
    const idx = createWorkspaceIndex();
    indexFile(idx, "file:///C:/ws/a.stm", parse(src)); // workspace-scan spelling
    indexFile(idx, "file:///c%3A/ws/a.stm", parse(src)); // didOpen spelling
    const diags = computeCoreSemanticDiagnostics("file:///c%3A/ws/a.stm", idx);
    const dup = diags.find((d) => d.code === "duplicate-definition");
    assert.equal(dup, undefined, "same file under two spellings must not self-duplicate");
  });

  // Companion to the spelling test: diagnostics must still be FOUND when the
  // query uses a different spelling than the index — canonicalization must not
  // trade false positives for false negatives.
  it("matches a file's diagnostics across URI spellings of the same path", () => {
    const aSrc = `import { orders } from "b.stm"\nschema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = createWorkspaceIndex();
    indexFile(idx, "file:///C:/ws/a.stm", parse(aSrc));
    indexFile(idx, "file:///C:/ws/b.stm", parse(bSrc));
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///c%3A/ws/a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///c%3A/ws/b.stm", scoped);
    const dupDiag = diags.find((d) => d.code === "duplicate-definition");
    assert.ok(dupDiag, "expected the genuine duplicate to be reported under the alternate spelling");
  });

  it("returns no diagnostics for a valid single-file workspace", () => {
    const src = `schema customers { id UUID }
mapping m {
  source { customers }
  target { customers }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("returns diagnostics with 0-indexed positions (LSP convention)", () => {
    const aSrc = `import { orders } from "b.stm"\nschema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///b.stm", scoped);
    if (diags.length > 0) {
      // LSP lines are 0-indexed
      assert.ok(diags[0].range.start.line >= 0, "line should be 0-indexed");
    }
  });
});

// computeScopedSemanticDiagnostics is the entry point the LSP server publishes
// from. These tests pin the ADR-022 scoping contract at that boundary: core
// rules see only the open file's import closure, while the missing-import rule
// keeps the folder-wide view it needs to suggest imports (sl-rw3e).
describe("computeScopedSemanticDiagnostics", () => {
  // Regression for sl-rw3e: two independent entry-point files in the same
  // VS Code folder that define the same schema name are NOT duplicates —
  // neither is in the other's import closure, so opening one must not
  // surface the other's definitions.
  it("does not report a duplicate when an unrelated workspace file defines the same schema name", () => {
    const idx = buildIndex({
      "file:///pipeline.stm": `schema fact_orders { id UUID }`,
      "file:///metric_sources.stm": `schema fact_orders { id UUID }`,
    });
    const diags = computeScopedSemanticDiagnostics("file:///pipeline.stm", idx);
    assert.equal(
      diags.find((d) => d.code === "duplicate-definition"),
      undefined,
      "independent entry points must not collide on schema names",
    );
  });

  // Duplicates WITHIN the closure are real errors and must survive the
  // scoping change: the open file defines a schema and imports a file that
  // defines the same name, so both definitions are genuinely in scope at
  // once. The open file's definition was indexed FIRST here, which is the
  // direction the one-way duplicate record missed — it attributed the
  // conflict only to the imported file, so the open file showed nothing.
  it("reports a duplicate on the open file when a file it imports redefines its schema", () => {
    const idx = buildIndex({
      "file:///entry.stm": `import { dim_customer } from "lib.stm"
schema fact_orders { id UUID }`,
      "file:///lib.stm": `schema dim_customer { id UUID }
schema fact_orders { name STRING }`,
    });
    const diags = computeScopedSemanticDiagnostics("file:///entry.stm", idx);
    const dup = diags.find((d) => d.code === "duplicate-definition");
    assert.ok(dup, "duplicates inside one import closure are genuine conflicts");
    assert.ok(
      dup.message.includes("lib.stm"),
      "diagnostic should point at the conflicting definition site",
    );
  });

  // The mirrored conflict record must not leak across closure boundaries:
  // the importing file's closure contains the conflict, but the imported
  // file alone is self-consistent — opening IT must stay clean.
  it("does not report a duplicate on the imported file when only the importer redefines the name", () => {
    const idx = buildIndex({
      "file:///entry.stm": `import { fact_orders } from "lib.stm"
schema fact_orders { id UUID }`,
      "file:///lib.stm": `schema fact_orders { name STRING }`,
    });
    const diags = computeScopedSemanticDiagnostics("file:///lib.stm", idx);
    assert.equal(
      diags.find((d) => d.code === "duplicate-definition"),
      undefined,
      "lib.stm does not import entry.stm, so entry's definition is out of its scope",
    );
  });

  // Regression for sl-padl: duplicate namespace blocks are NOT an error —
  // they are the mechanism for spreading a namespace across files (Feature
  // 15). Here the open file imports from a file that reopens the same
  // namespace, so both blocks are genuinely in scope at once, and the
  // duplicate-definition rule must still stay silent about the namespace.
  it("does not report a duplicate when an imported file reopens the open file's namespace", () => {
    const idx = buildIndex({
      "file:///entry.stm": `import { analytics::pipeline_value } from "lib.stm"
namespace analytics (note "Business metrics layer") {
  schema fact_revenue { id UUID }
}`,
      "file:///lib.stm": `namespace analytics (note "Business metrics layer") {
  schema pipeline_value { id UUID }
}`,
    });
    const diags = computeScopedSemanticDiagnostics("file:///entry.stm", idx);
    assert.equal(
      diags.find((d) => d.code === "duplicate-definition"),
      undefined,
      "reopening a namespace across files merges it — it is not a duplicate",
    );
  });

  // Same invariant within a single file: a namespace block may be reopened
  // to group related definitions, and each block adds to the shared
  // namespace rather than colliding with the earlier one (sl-padl).
  it("does not report a duplicate when one file reopens its own namespace", () => {
    const idx = buildIndex({
      "file:///a.stm": `namespace crm (note "CRM layer") {
  schema customers { id UUID }
}
namespace crm (note "CRM layer") {
  schema orders { id UUID }
}`,
    });
    const diags = computeScopedSemanticDiagnostics("file:///a.stm", idx);
    assert.equal(
      diags.find((d) => d.code === "duplicate-definition"),
      undefined,
      "reopening a namespace in the same file is legal merging, not a duplicate",
    );
  });

  // Reopened namespace blocks merge, but the names INSIDE the merged
  // namespace still share one scope: two schemas with the same qualified
  // name across the reopened blocks remain a genuine conflict (sl-padl).
  it("still reports a duplicate for the same schema name defined in two blocks of one namespace", () => {
    const idx = buildIndex({
      "file:///entry.stm": `import { analytics::pipeline_value } from "lib.stm"
namespace analytics (note "Business metrics layer") {
  schema pipeline_value { id UUID }
}`,
      "file:///lib.stm": `namespace analytics (note "Business metrics layer") {
  schema pipeline_value { id UUID }
}`,
    });
    const diags = computeScopedSemanticDiagnostics("file:///entry.stm", idx);
    const dup = diags.find((d) => d.code === "duplicate-definition");
    assert.ok(dup, "same qualified schema name in one merged namespace is a real conflict");
    assert.ok(
      dup.message.includes("pipeline_value"),
      "diagnostic should name the conflicting schema, not the namespace",
    );
  });

  // The missing-import rule must keep its folder-wide view: a symbol defined
  // only OUTSIDE the closure should still produce the actionable "Add:
  // import ..." suggestion, not silently disappear with the scoping change.
  it("still suggests an import for a symbol defined only outside the import closure", () => {
    const idx = buildIndex({
      "file:///a.stm": `mapping m {
  source { orders }
  target { orders }
  id -> id
}`,
      "file:///b.stm": `schema orders { id UUID }`,
    });
    const diags = computeScopedSemanticDiagnostics("file:///a.stm", idx);
    const missing = diags.find((d) => d.code === "missing-import");
    assert.ok(missing, "expected a missing-import diagnostic");
    assert.ok(
      missing.message.includes("import { orders }"),
      "suggestion must name the symbol to import",
    );
  });
});

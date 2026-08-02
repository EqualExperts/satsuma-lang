/**
 * validate-bugs.test.js — Tests for validator false-positive bug fixes
 *
 * Covers:
 * - Bug 1: Nested record/list field path resolution
 * - Bug 2: Schema-qualified references in multi-source mappings
 * - Bug 3: Metric source extraction (keyword vs value, block form)
 * - Bug 4: Suppress field-not-in-schema for schemas with unresolved spreads
 * - Bug 5: Duplicate warning elimination
 * - Bug 6: Duplicate named definitions across files
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectSemanticWarnings } from "#src/semantic-warnings.js";
import { extractSchemas, extractMetrics } from "@satsuma/core";

// ── Mock helpers ─────────────────────────────────────────────────────────────

function n(
  type: any,
  namedChildren: any[] = [],
  text = "",
  row = 0,
  anonymousChildren: any[] = [],
) {
  const children: any[] = [];
  children.push(
    ...anonymousChildren.map((t: any) => ({
      type: t,
      text: t,
      isNamed: false,
      namedChildren: [],
      children: [],
    })),
  );
  children.push(...namedChildren.map((c: any) => ({ ...c, isNamed: true })));
  return {
    type,
    text,
    startPosition: { row, column: 0 },
    namedChildren,
    children,
    isNamed: true,
  } as any;
}

function ident(text: any, row = 0) {
  return n("identifier", [], text, row);
}

function blockLabel(name: any) {
  return n("block_label", [ident(name)]);
}

function typeExpr(text: any) {
  return n("type_expr", [], text);
}

function fieldName(name: any) {
  return n("field_name", [ident(name)]);
}

function fieldDecl(name: any, type: any, row = 0) {
  return n("field_decl", [fieldName(name), typeExpr(type)], "", row);
}

function kvPair(key: any, valNode: any) {
  const valText = n(
    "value_text",
    valNode.type === "value_text" ? valNode.namedChildren : [valNode],
    valNode.text,
  );
  return n("tag_with_value", [ident(key), valText]);
}

/** Build a minimal ExtractedWorkspace for testing semantic warnings. */
function makeIndex({
  schemas = [],
  mappings = [],
  metrics = [],
  fragments = [],
  fieldArrows = [],
}: {
  schemas?: any[];
  mappings?: any[];
  metrics?: any[];
  fragments?: any[];
  fieldArrows?: any[];
}): any {
  const schemaMap = new Map();
  for (const s of schemas) {
    schemaMap.set(s.name, { ...s, file: s.file ?? "test.stm", row: s.row ?? 0 });
  }
  const mappingMap = new Map();
  for (const m of mappings) {
    mappingMap.set(m.name, { ...m, file: m.file ?? "test.stm", row: m.row ?? 0 });
  }
  const metricMap = new Map();
  for (const m of metrics) {
    metricMap.set(m.name, { ...m, file: m.file ?? "test.stm", row: m.row ?? 0 });
  }
  const fragMap = new Map();
  for (const f of fragments) {
    fragMap.set(f.name, { ...f, file: f.file ?? "test.stm", row: f.row ?? 0 });
  }
  const arrowMap = new Map();
  for (const a of fieldArrows) {
    for (const source of a.sources ?? (a.source ? [a.source] : [])) {
      if (!arrowMap.has(source)) arrowMap.set(source, []);
      arrowMap.get(source).push(a);
    }
    if (a.target) {
      if (!arrowMap.has(a.target)) arrowMap.set(a.target, []);
      arrowMap.get(a.target).push(a);
    }
  }
  return {
    schemas: schemaMap,
    mappings: mappingMap,
    metrics: metricMap,
    fragments: fragMap,
    transforms: new Map(),
    warnings: [],
    questions: [],
    fieldArrows: arrowMap,
    referenceGraph: {
      usedByMappings: new Map(),
      fragmentsUsedIn: new Map(),
      metricsReferences: new Map(),
    },
    totalErrors: 0,
  };
}

// ── Bug 1: Nested record/list field paths ─────────────────────────────────────

describe("Bug 1: nested field path resolution", () => {
  it("extracts nested record fields into a field tree", () => {
    const innerBody = n("schema_body", [
      fieldDecl("DOCNUM", "CHAR(35)"),
      fieldDecl("MESSGFUN", "CHAR(3)"),
    ]);
    // Unified syntax: field_decl with "record" keyword as anonymous child
    const recordField = n("field_decl", [fieldName("BeginningOfMessage"), innerBody], "", 0, [
      "record",
    ]);
    const outerBody = n("schema_body", [recordField, fieldDecl("top_field", "INT")]);
    const block = n("schema_block", [blockLabel("my_schema"), outerBody]);
    const root = n("source_file", [block]);

    const schemas = extractSchemas(root);
    assert.equal(schemas.length, 1);
    assert.equal(schemas[0].fields.length, 2); // record + top_field
    assert.equal(schemas[0].fields[0].name, "BeginningOfMessage");
    assert.equal(schemas[0].fields[0].children!.length, 2);
    assert.equal(schemas[0].fields[0].children![0].name, "DOCNUM");
    assert.equal(schemas[0].fields[1].name, "top_field");
  });

  it("extracts nested list fields with isList flag", () => {
    const innerBody = n("schema_body", [fieldDecl("unit_price", "DECIMAL")]);
    // Unified syntax: field_decl with "list_of" and "record" keywords
    const listField = n("field_decl", [fieldName("CartLines"), innerBody], "", 0, [
      "list_of",
      "record",
    ]);
    const outerBody = n("schema_body", [listField]);
    const block = n("schema_block", [blockLabel("my_schema"), outerBody]);
    const root = n("source_file", [block]);

    const schemas = extractSchemas(root);
    assert.equal(schemas[0].fields[0].isList, true);
    assert.equal(schemas[0].fields[0].children![0].name, "unit_price");
  });

  it("validates dotted paths against nested field tree", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "src_schema",
          fields: [
            {
              name: "Order",
              type: "record",
              children: [
                { name: "OrderId", type: "INT" },
                { name: "Customer", type: "record", children: [{ name: "Email", type: "STRING" }] },
              ],
            },
          ],
        },
        {
          name: "tgt_schema",
          fields: [
            { name: "order_id", type: "INT" },
            { name: "email", type: "STRING" },
          ],
        },
      ],
      mappings: [{ name: "m1", sources: ["src_schema"], targets: ["tgt_schema"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["Order.OrderId"],
          target: "order_id",
          file: "test.stm",
          line: 10,
        },
        {
          mapping: "m1",
          sources: ["Order.Customer.Email"],
          target: "email",
          file: "test.stm",
          line: 11,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 0, "Nested dotted paths should resolve without warnings");
  });

  it("validates list dotted paths against nested field tree", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "src_schema",
          fields: [
            {
              name: "CartLines",
              type: "record",
              isList: true,
              children: [{ name: "unit_price", type: "DECIMAL" }],
            },
          ],
        },
        {
          name: "tgt_schema",
          fields: [{ name: "price", type: "DECIMAL" }],
        },
      ],
      mappings: [{ name: "m1", sources: ["src_schema"], targets: ["tgt_schema"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["CartLines.unit_price"],
          target: "price",
          file: "test.stm",
          line: 10,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 0, "List dotted paths should resolve without warnings");
  });

  it("accepts relative paths (.REFNUM) without warning", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "src_schema",
          fields: [{ name: "top_field", type: "INT" }],
        },
        {
          name: "tgt_schema",
          fields: [{ name: "out", type: "INT" }],
        },
      ],
      mappings: [{ name: "m1", sources: ["src_schema"], targets: ["tgt_schema"] }],
      fieldArrows: [
        { mapping: "m1", sources: [".REFNUM"], target: ".orderNo", file: "test.stm", line: 10 },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 0, "Relative paths should be accepted");
  });
});

// ── Bug 2: Schema-qualified references ────────────────────────────────────────

describe("Bug 2: schema-qualified references in multi-source mappings", () => {
  it("resolves schema.field paths in multi-source mappings", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "crm_customers",
          fields: [
            { name: "customer_id", type: "INT" },
            { name: "email", type: "STRING" },
          ],
        },
        { name: "orders", fields: [{ name: "order_id", type: "INT" }] },
        {
          name: "target",
          fields: [
            { name: "id", type: "INT" },
            { name: "email", type: "STRING" },
          ],
        },
      ],
      mappings: [{ name: "m1", sources: ["crm_customers", "orders"], targets: ["target"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["crm_customers.customer_id"],
          target: "id",
          file: "test.stm",
          line: 10,
        },
        {
          mapping: "m1",
          sources: ["crm_customers.email"],
          target: "email",
          file: "test.stm",
          line: 11,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(
      fieldWarnings.length,
      0,
      "Schema-qualified paths should resolve in multi-source mappings",
    );
  });

  it("still warns for unknown schema qualifiers in multi-source mappings", () => {
    const index = makeIndex({
      schemas: [
        { name: "crm_customers", fields: [{ name: "email", type: "STRING" }] },
        { name: "orders", fields: [{ name: "order_id", type: "INT" }] },
        { name: "target", fields: [{ name: "email", type: "STRING" }] },
      ],
      mappings: [{ name: "m1", sources: ["crm_customers", "orders"], targets: ["target"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["unknown_schema.email"],
          target: "email",
          file: "test.stm",
          line: 10,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 1, "Unknown schema qualifier should still warn");
  });

  it("does not cross-wire arrows between same-named mappings in different namespaces", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "alpha::customer",
          namespace: "alpha",
          fields: [{ name: "alpha_flag", type: "STRING" }],
        },
        {
          name: "alpha::customer_out",
          namespace: "alpha",
          fields: [{ name: "alpha_flag", type: "STRING" }],
        },
        {
          name: "beta::customer",
          namespace: "beta",
          fields: [{ name: "beta_score", type: "NUMBER" }],
        },
        {
          name: "beta::customer_out",
          namespace: "beta",
          fields: [{ name: "beta_score", type: "NUMBER" }],
        },
      ],
      mappings: [
        {
          name: "alpha::load_customer",
          namespace: "alpha",
          sources: ["alpha::customer"],
          targets: ["alpha::customer_out"],
        },
        {
          name: "beta::load_customer",
          namespace: "beta",
          sources: ["beta::customer"],
          targets: ["beta::customer_out"],
        },
      ],
      fieldArrows: [
        {
          mapping: "load_customer",
          namespace: "alpha",
          sources: ["alpha_flag"],
          target: "alpha_flag",
          file: "test.stm",
          line: 10,
        },
        {
          mapping: "load_customer",
          namespace: "beta",
          sources: ["beta_score"],
          target: "beta_score",
          file: "test.stm",
          line: 20,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(
      fieldWarnings.length,
      0,
      "same-named mappings in different namespaces should validate independently",
    );
  });
});

// ── Bug 3: Metric source extraction ──────────────────────────────────────────
// Metrics are schema_block nodes decorated with a `metric` tag_token in their
// metadata_block. The extractMetrics() function filters by that criterion.

function metricTag() {
  return n("tag_token", [ident("metric")], "metric");
}

describe("Bug 3: metric source extraction", () => {
  it("extracts single-value metric source from schema_block decorated with metric tag", () => {
    // Validates that `source` metadata is extracted from a metric schema_block.
    const meta = n("metadata_block", [
      metricTag(),
      kvPair("source", ident("fact_subscriptions")),
      kvPair("grain", ident("monthly")),
    ]);
    const body = n("schema_body", [fieldDecl("value", "DECIMAL")]);
    const block = n("schema_block", [blockLabel("mrr"), meta, body]);
    const root = n("source_file", [block]);

    const metrics = extractMetrics(root);
    assert.deepEqual(metrics[0].sources, ["fact_subscriptions"]);
  });

  it("extracts block-form metric sources from schema_block decorated with metric tag", () => {
    // Validates that multi-identifier `source` values are all extracted.
    const valText = n(
      "value_text",
      [ident("fact_subscriptions"), ident("dim_customer")],
      "{fact_subscriptions, dim_customer}",
    );
    const meta = n("metadata_block", [
      metricTag(),
      n("tag_with_value", [ident("source"), valText]),
    ]);
    const body = n("schema_body", []);
    const block = n("schema_block", [blockLabel("churn_rate"), meta, body]);
    const root = n("source_file", [block]);

    const metrics = extractMetrics(root);
    assert.deepEqual(metrics[0].sources, ["fact_subscriptions", "dim_customer"]);
  });

  it("warns when metric source references nonexistent schema (sl-313n)", () => {
    const index = makeIndex({
      schemas: [{ name: "some_schema", fields: [] }],
      metrics: [{ name: "mrr", sources: ["external_table"], fields: [] }],
    });

    const warnings = collectSemanticWarnings(index);
    const metricWarnings = warnings.filter(
      (w: any) => w.rule === "undefined-ref" && w.message.includes("Metric"),
    );
    assert.equal(metricWarnings.length, 1, "Should warn for undefined metric source");
    assert.match(metricWarnings[0].message, /external_table/);
  });
});

// ── Bug 4: Suppress for schemas with unresolved spreads ──────────────────────

function spreadLabel(name: string) {
  // spread_label children: backtick_name for 'quoted', identifier for bare
  if (name.startsWith("'") || name.startsWith('"')) {
    return n("spread_label", [n("backtick_name", [], name)]);
  }
  const ids = name.split(" ").map((w: any) => ident(w));
  return n("spread_label", ids);
}

function fragmentSpread(name: string) {
  return n("fragment_spread", [spreadLabel(name)], `...${name}`);
}

describe("Bug 4: suppress field-not-in-schema for schemas with spreads", () => {
  it("detects fragment_spread in schema body and extracts spread names", () => {
    const spread = fragmentSpread("audit_fields");
    const body = n("schema_body", [fieldDecl("id", "INT"), spread]);
    const block = n("schema_block", [blockLabel("my_schema"), body]);
    const root = n("source_file", [block]);

    const schemas = extractSchemas(root);
    assert.equal(schemas[0].hasSpreads, true);
    assert.deepEqual(schemas[0].spreads, ["audit_fields"]);
  });

  it("extracts quoted spread names", () => {
    const spread = fragmentSpread("'audit fields'");
    const body = n("schema_body", [fieldDecl("id", "INT"), spread]);
    const block = n("schema_block", [blockLabel("my_schema"), body]);
    const root = n("source_file", [block]);

    const schemas = extractSchemas(root);
    assert.deepEqual(schemas[0].spreads, ["audit fields"]);
  });

  it("suppresses field-not-in-schema for target with unresolved spreads", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "created_at", type: "TIMESTAMP" }] },
        { name: "tgt", fields: [{ name: "id", type: "INT" }], hasSpreads: true },
      ],
      mappings: [{ name: "m1", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["created_at"],
          target: "created_at",
          file: "test.stm",
          line: 10,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(
      fieldWarnings.length,
      0,
      "Should not warn for target schema with unresolved spreads",
    );
  });

  it("expands fragment fields and validates arrow targets", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "created_at", type: "TIMESTAMP" }] },
        {
          name: "tgt",
          fields: [{ name: "id", type: "INT" }],
          hasSpreads: true,
          spreads: ["audit_fields"],
        },
      ],
      fragments: [
        {
          name: "audit_fields",
          fields: [
            { name: "created_at", type: "TIMESTAMP" },
            { name: "updated_at", type: "TIMESTAMP" },
          ],
        },
      ],
      mappings: [{ name: "m1", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["created_at"],
          target: "created_at",
          file: "test.stm",
          line: 10,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 0, "Fragment-contributed field should pass validation");
  });

  it("warns for fields not in schema or expanded fragments", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "bogus_field", type: "VARCHAR" }] },
        {
          name: "tgt",
          fields: [{ name: "id", type: "INT" }],
          hasSpreads: true,
          spreads: ["audit_fields"],
        },
      ],
      fragments: [{ name: "audit_fields", fields: [{ name: "created_at", type: "TIMESTAMP" }] }],
      mappings: [{ name: "m1", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["bogus_field"],
          target: "nonexistent_field",
          file: "test.stm",
          line: 10,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 1, "Should warn for field not in schema or fragment");
    assert.ok(fieldWarnings[0].message.includes("nonexistent_field"));
  });

  it("expands fragment fields for source schemas", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "src",
          fields: [{ name: "id", type: "INT" }],
          hasSpreads: true,
          spreads: ["audit_fields"],
        },
        {
          name: "tgt",
          fields: [
            { name: "id", type: "INT" },
            { name: "created_at", type: "TIMESTAMP" },
          ],
        },
      ],
      fragments: [{ name: "audit_fields", fields: [{ name: "created_at", type: "TIMESTAMP" }] }],
      mappings: [{ name: "m1", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["created_at"],
          target: "created_at",
          file: "test.stm",
          line: 10,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(
      fieldWarnings.length,
      0,
      "Fragment-contributed source field should pass validation",
    );
  });
});

// ── Bug 4b: Fragment spread cycles and nested expansion ──────────────────────

describe("Bug 4b: fragment spread cycles and nested expansion", () => {
  it("expands fragment that spreads another fragment (transitive)", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "created_at", type: "TIMESTAMP" }] },
        {
          name: "tgt",
          fields: [{ name: "id", type: "INT" }],
          hasSpreads: true,
          spreads: ["base_fields"],
        },
      ],
      fragments: [
        {
          name: "base_fields",
          fields: [{ name: "name", type: "VARCHAR" }],
          hasSpreads: true,
          spreads: ["audit_fields"],
        },
        {
          name: "audit_fields",
          fields: [
            { name: "created_at", type: "TIMESTAMP" },
            { name: "updated_at", type: "TIMESTAMP" },
          ],
        },
      ],
      mappings: [{ name: "m1", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [
        {
          mapping: "m1",
          sources: ["created_at"],
          target: "created_at",
          file: "test.stm",
          line: 10,
        },
      ],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(
      fieldWarnings.length,
      0,
      "Transitively spread fragment field should pass validation",
    );
  });

  it("detects self-referential fragment spread", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id", type: "INT" }] },
        { name: "tgt", fields: [{ name: "id", type: "INT" }], hasSpreads: true, spreads: ["loop"] },
      ],
      fragments: [
        { name: "loop", fields: [{ name: "x", type: "INT" }], hasSpreads: true, spreads: ["loop"] },
      ],
      mappings: [{ name: "m1", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [{ mapping: "m1", sources: ["id"], target: "id", file: "test.stm", line: 1 }],
    });

    const warnings = collectSemanticWarnings(index);
    const cycleWarnings = warnings.filter((w: any) => w.rule === "circular-spread");
    assert.equal(cycleWarnings.length, 1, "Should detect self-referential spread");
    assert.ok(cycleWarnings[0].message.includes("loop"), "Should mention the cyclic fragment name");
  });

  it("detects mutual cycle between two fragments", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "tgt",
          fields: [{ name: "id", type: "INT" }],
          hasSpreads: true,
          spreads: ["frag_a"],
        },
      ],
      fragments: [
        {
          name: "frag_a",
          fields: [{ name: "a", type: "INT" }],
          hasSpreads: true,
          spreads: ["frag_b"],
        },
        {
          name: "frag_b",
          fields: [{ name: "b", type: "INT" }],
          hasSpreads: true,
          spreads: ["frag_a"],
        },
      ],
      mappings: [{ name: "m1", sources: ["tgt"], targets: ["tgt"] }],
      fieldArrows: [{ mapping: "m1", sources: ["id"], target: "id", file: "test.stm", line: 1 }],
    });

    const warnings = collectSemanticWarnings(index);
    const cycleWarnings = warnings.filter((w: any) => w.rule === "circular-spread");
    assert.ok(cycleWarnings.length >= 1, "Should detect cycle between frag_a and frag_b");
    assert.ok(cycleWarnings[0].message.includes("Circular fragment spread"));
  });

  it("does not false-positive on diamond-shaped spreads", () => {
    // base is spread by both frag_a and frag_b; schema spreads both.
    // No cycle — just shared dependency.
    const index = makeIndex({
      schemas: [
        {
          name: "tgt",
          fields: [{ name: "id", type: "INT" }],
          hasSpreads: true,
          spreads: ["frag_a", "frag_b"],
        },
      ],
      fragments: [
        {
          name: "frag_a",
          fields: [{ name: "a", type: "INT" }],
          hasSpreads: true,
          spreads: ["base"],
        },
        {
          name: "frag_b",
          fields: [{ name: "b", type: "INT" }],
          hasSpreads: true,
          spreads: ["base"],
        },
        { name: "base", fields: [{ name: "created_at", type: "TIMESTAMP" }] },
      ],
      mappings: [{ name: "m1", sources: ["tgt"], targets: ["tgt"] }],
      fieldArrows: [{ mapping: "m1", sources: ["id"], target: "id", file: "test.stm", line: 1 }],
    });

    const warnings = collectSemanticWarnings(index);
    const cycleWarnings = warnings.filter((w: any) => w.rule === "circular-spread");
    assert.equal(cycleWarnings.length, 0, "Diamond shape is not a cycle");
  });
});

// ── Bug 6: Duplicate named definitions ───────────────────────────────────────

describe("Bug 6: duplicate named definitions", () => {
  it("emits error when the same schema name is defined twice", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "pos_oracle",
          fields: [{ name: "STORE_ID", type: "VARCHAR(20)" }],
          file: "hub-store.stm",
          row: 20,
        },
      ],
    });
    index.duplicates = [
      {
        kind: "schema",
        previousKind: "schema",
        name: "pos_oracle",
        file: "link-sale.stm",
        row: 26,
        previousFile: "hub-store.stm",
        previousRow: 20,
      },
    ];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 1, "Should emit one duplicate-definition error");
    assert.equal(dupErrors[0].severity, "error");
    assert.ok(dupErrors[0].message.includes("pos_oracle"));
    assert.ok(dupErrors[0].message.includes("Schema"));
    assert.ok(dupErrors[0].message.includes("hub-store.stm"));
    assert.equal(dupErrors[0].file, "link-sale.stm");
    assert.equal(dupErrors[0].line, 27); // row 26 + 1
  });

  it("emits multiple errors for a schema defined in three files", () => {
    const index = makeIndex({
      schemas: [{ name: "pos_oracle", fields: [], file: "link-sale.stm", row: 26 }],
    });
    index.duplicates = [
      {
        kind: "schema",
        previousKind: "schema",
        name: "pos_oracle",
        file: "hub-store.stm",
        row: 20,
        previousFile: "hub-customer.stm",
        previousRow: 49,
      },
      {
        kind: "schema",
        previousKind: "schema",
        name: "pos_oracle",
        file: "link-sale.stm",
        row: 26,
        previousFile: "hub-store.stm",
        previousRow: 20,
      },
    ];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 2, "Should emit two errors for three definitions");
  });

  it("emits error for duplicate metrics", () => {
    const index = makeIndex({
      metrics: [{ name: "mrr", sources: [], fields: [], file: "b.stm", row: 10 }],
    });
    index.duplicates = [
      {
        kind: "metric",
        previousKind: "metric",
        name: "mrr",
        file: "b.stm",
        row: 10,
        previousFile: "a.stm",
        previousRow: 5,
      },
    ];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 1);
    assert.ok(dupErrors[0].message.includes("Metric"));
    assert.ok(dupErrors[0].message.includes("mrr"));
  });

  it("emits error for duplicate named mappings", () => {
    const index = makeIndex({
      mappings: [
        { name: "load customers", sources: ["s"], targets: ["t"], file: "b.stm", row: 15 },
      ],
    });
    index.duplicates = [
      {
        kind: "mapping",
        previousKind: "mapping",
        name: "load customers",
        file: "b.stm",
        row: 15,
        previousFile: "a.stm",
        previousRow: 8,
      },
    ];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 1);
    assert.ok(dupErrors[0].message.includes("Mapping"));
    assert.ok(dupErrors[0].message.includes("load customers"));
  });

  it("emits error for duplicate fragments", () => {
    const index = makeIndex({
      fragments: [{ name: "audit_fields", fields: [], file: "b.stm", row: 3 }],
    });
    index.duplicates = [
      {
        kind: "fragment",
        previousKind: "fragment",
        name: "audit_fields",
        file: "b.stm",
        row: 3,
        previousFile: "a.stm",
        previousRow: 1,
      },
    ];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 1);
    assert.ok(dupErrors[0].message.includes("Fragment"));
  });

  it("emits error for duplicate transforms", () => {
    const index = makeIndex({});
    index.duplicates = [
      {
        kind: "transform",
        previousKind: "transform",
        name: "dv_hash",
        file: "b.stm",
        row: 7,
        previousFile: "a.stm",
        previousRow: 2,
      },
    ];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 1);
    assert.ok(dupErrors[0].message.includes("Transform"));
    assert.ok(dupErrors[0].message.includes("dv_hash"));
  });

  it("emits error when a schema and metric share the same name", () => {
    const index = makeIndex({
      schemas: [{ name: "customer", fields: [], file: "a.stm", row: 5 }],
      metrics: [{ name: "customer", sources: [], fields: [], file: "b.stm", row: 10 }],
    });
    index.duplicates = [
      {
        kind: "metric",
        previousKind: "schema",
        name: "customer",
        file: "b.stm",
        row: 10,
        previousFile: "a.stm",
        previousRow: 5,
      },
    ];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 1);
    assert.ok(dupErrors[0].message.includes("Metric"));
    assert.ok(dupErrors[0].message.includes("conflicts with schema"));
    assert.ok(dupErrors[0].message.includes("customer"));
  });

  it("does not emit error when all names are unique", () => {
    const index = makeIndex({
      schemas: [
        { name: "schema_a", fields: [] },
        { name: "schema_b", fields: [] },
      ],
    });
    index.duplicates = [];

    const warnings = collectSemanticWarnings(index);
    const dupErrors = warnings.filter((w: any) => w.rule === "duplicate-definition");
    assert.equal(dupErrors.length, 0, "Should not emit errors for unique names");
  });
});

// ── Bug 5: Duplicate warning elimination ─────────────────────────────────────

describe("Bug 5: duplicate warning elimination", () => {
  it("emits at most one warning per arrow", () => {
    const arrow = {
      mapping: "m1",
      sources: ["unknown_field"],
      target: "also_unknown",
      file: "test.stm",
      line: 10,
    };
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id", type: "INT" }] },
        { name: "tgt", fields: [{ name: "id", type: "INT" }] },
      ],
      mappings: [{ name: "m1", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [arrow],
    });

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    // Should get exactly 2 warnings: one for source, one for target (not 4)
    assert.equal(fieldWarnings.length, 2);

    // Verify no duplicate messages
    const messages = fieldWarnings.map((w: any) => w.message);
    const uniqueMessages = [...new Set(messages)];
    assert.equal(messages.length, uniqueMessages.length, "No duplicate warning messages");
  });
});

// ── Bug fix sl-akdg: field-not-in-schema for anonymous mapping arrows ─────────

describe("sl-akdg: field-not-in-schema fires for anonymous mapping arrows", () => {
  it("reports field-not-in-schema when anonymous mapping arrow source is not in schema", () => {
    // Anonymous mappings (name=null) are stored with synthetic key "<anon>@file:row".
    // The check was previously broken because arrow.mapping ("<anon>@...") never equalled
    // mapping.name (null). The fix compares against the index key for anonymous mappings.
    const schemaMap = new Map<string, any>([
      ["src", { name: "src", fields: [{ name: "id" }], file: "test.stm", row: 0 }],
      ["tgt", { name: "tgt", fields: [{ name: "id" }], file: "test.stm", row: 0 }],
    ]);
    const anonKey = "<anon>@test.stm:4";
    const mappingMap = new Map<string, any>([
      [anonKey, { name: null, sources: ["src"], targets: ["tgt"], file: "test.stm", row: 4 }],
    ]);
    const arrow = {
      mapping: anonKey,
      namespace: null,
      sources: ["nonexistent_field"],
      target: "id",
      file: "test.stm",
      line: 5,
    };
    const arrowMap = new Map<string, any>([
      ["nonexistent_field", [arrow]],
      ["id", [arrow]],
    ]);
    const index = {
      schemas: schemaMap,
      mappings: mappingMap,
      metrics: new Map(),
      fragments: new Map(),
      transforms: new Map(),
      fieldArrows: arrowMap,
      totalErrors: 0,
    } as any;

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(
      fieldWarnings.length,
      1,
      "should report field-not-in-schema for anonymous mapping arrow",
    );
    assert.ok(fieldWarnings[0].message.includes("nonexistent_field"));
  });

  it("does not report field-not-in-schema when anonymous mapping arrow source IS in schema", () => {
    // Sanity check: the fix should not introduce false positives for valid anonymous mapping arrows.
    const schemaMap = new Map<string, any>([
      ["src", { name: "src", fields: [{ name: "id" }], file: "test.stm", row: 0 }],
      ["tgt", { name: "tgt", fields: [{ name: "id" }], file: "test.stm", row: 0 }],
    ]);
    const anonKey = "<anon>@test.stm:4";
    const mappingMap = new Map<string, any>([
      [anonKey, { name: null, sources: ["src"], targets: ["tgt"], file: "test.stm", row: 4 }],
    ]);
    const arrow = {
      mapping: anonKey,
      namespace: null,
      sources: ["id"],
      target: "id",
      file: "test.stm",
      line: 5,
    };
    const arrowMap = new Map<string, any>([["id", [arrow]]]);
    const index = {
      schemas: schemaMap,
      mappings: mappingMap,
      metrics: new Map(),
      fragments: new Map(),
      transforms: new Map(),
      fieldArrows: arrowMap,
      totalErrors: 0,
    } as any;

    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 0, "valid anonymous mapping arrows should not warn");
  });
});

/**
 * validate.test.js — Unit tests for @satsuma/core semantic validation.
 *
 * Each describe block covers one diagnostic category. Tests are written directly
 * against collectSemanticDiagnostics() — no CLI or LSP types involved.
 *
 * Test inputs are minimal SemanticIndex objects; the makeIndex() helper builds
 * them from plain objects so tests stay readable.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectSemanticDiagnostics, validateSemanticWorkspace } from "@satsuma/core";

// ---------- Test helper ----------

/**
 * Mirror extraction's `hasSpreads`: set when the entity spreads a fragment at
 * the top level *or* any record field in its tree does (extract.ts). Nested
 * spreads live on the field (`field.spreads`), not in the entity's `spreads`.
 */
function declaresSpread(entity) {
  const nested = (fields) => fields.some((f) => f.spreads?.length || nested(f.children ?? []));
  return (entity.spreads ?? []).length > 0 || nested(entity.fields ?? []);
}

/**
 * Build a minimal SemanticIndex from shorthand inputs.
 * Unspecified fields default to empty collections so callers only specify what's relevant.
 */
function makeIndex({
  schemas = [],
  fragments = [],
  mappings = [],
  metrics = [],
  transforms = [],
  fieldArrows = [],
  nlRefData = [],
  duplicates = [],
} = {}) {
  const schemaMap = new Map();
  for (const s of schemas) {
    schemaMap.set(s.qualifiedName ?? s.name, {
      name: s.name,
      namespace: s.namespace,
      file: s.file ?? "test.stm",
      row: s.row ?? 0,
      fields: s.fields ?? [],
      spreads: s.spreads ?? [],
      hasSpreads: declaresSpread(s),
      blockMetadata: s.blockMetadata ?? [],
    });
  }
  const fragMap = new Map();
  for (const f of fragments) {
    fragMap.set(f.qualifiedName ?? f.name, {
      name: f.name,
      namespace: f.namespace,
      file: f.file ?? "test.stm",
      row: f.row ?? 0,
      fields: f.fields ?? [],
      spreads: f.spreads ?? [],
      hasSpreads: declaresSpread(f),
    });
  }
  const mappingMap = new Map();
  for (const m of mappings) {
    mappingMap.set(m.qualifiedName ?? m.name, {
      name: m.name,
      namespace: m.namespace,
      file: m.file ?? "test.stm",
      row: m.row ?? 0,
      sources: m.sources ?? [],
      targets: m.targets ?? [],
    });
  }
  const metricMap = new Map();
  for (const m of metrics) {
    metricMap.set(m.qualifiedName ?? m.name, {
      name: m.name,
      namespace: m.namespace,
      file: m.file ?? "test.stm",
      row: m.row ?? 0,
      sources: m.sources ?? [],
    });
  }
  const transformMap = new Map();
  for (const t of transforms) {
    transformMap.set(t.qualifiedName ?? t.name, t);
  }
  const arrowMap = new Map();
  for (const a of fieldArrows) {
    const keys = new Set([...(a.sources ?? []), ...(a.target ? [a.target] : [])]);
    for (const key of keys) {
      if (!arrowMap.has(key)) arrowMap.set(key, []);
      arrowMap.get(key).push(a);
    }
  }
  return {
    schemas: schemaMap,
    fragments: fragMap,
    mappings: mappingMap,
    metrics: metricMap,
    transforms: transformMap,
    fieldArrows: arrowMap,
    nlRefData,
    duplicates,
  };
}

// ---------- Section 1: Duplicate definitions ----------

describe("duplicate-definition diagnostics", () => {
  it("reports an error when the same schema name appears twice in the duplicates log", () => {
    // Ensures that a workspace index entry recording a duplicate schema name
    // is surfaced as an "error" (not warning) with rule=duplicate-definition.
    const index = makeIndex({
      duplicates: [
        {
          kind: "schema",
          previousKind: "schema",
          name: "customers",
          file: "b.stm",
          row: 5,
          previousFile: "a.stm",
          previousRow: 0,
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "duplicate-definition");
    assert.equal(diags[0].severity, "error");
    assert.ok(diags[0].message.includes("customers"));
    assert.ok(diags[0].message.includes("a.stm:1"), "message should cite previous location");
  });

  it("reports a cross-kind conflict with both kinds in the message", () => {
    // When a schema name collides with a mapping name (different kinds), the
    // message must mention both kinds so the user knows which two entities conflict.
    const index = makeIndex({
      duplicates: [
        {
          kind: "mapping",
          previousKind: "schema",
          name: "orders",
          file: "b.stm",
          row: 2,
          previousFile: "a.stm",
          previousRow: 0,
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    assert.equal(diags[0].rule, "duplicate-definition");
    // capitalize() uppercases the first letter; test with lower-case after the first character.
    assert.ok(
      diags[0].message.toLowerCase().includes("mapping"),
      "message must name the current kind",
    );
    assert.ok(
      diags[0].message.toLowerCase().includes("schema"),
      "message must name the prior kind",
    );
  });

  it("reports namespace-metadata-conflict when two files disagree on namespace metadata", () => {
    // Namespace @note or @label values must agree across files. The index records
    // these as kind='namespace-metadata'; the validator maps them to a distinct rule.
    const index = makeIndex({
      duplicates: [
        {
          kind: "namespace-metadata",
          previousKind: "namespace-metadata",
          name: "pos",
          tag: "note",
          value: "Oracle",
          previousValue: "SAP",
          file: "b.stm",
          row: 3,
          previousFile: "a.stm",
          previousRow: 0,
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    assert.equal(diags[0].rule, "namespace-metadata-conflict");
    assert.equal(diags[0].severity, "error");
    assert.ok(diags[0].message.includes("pos"));
    assert.ok(diags[0].message.includes("note"));
  });

  it("emits no diagnostics when duplicates list is absent", () => {
    // WorkspaceIndex implementations that omit the duplicates field must be safe.
    const index = makeIndex({ duplicates: undefined });
    const diags = collectSemanticDiagnostics(index);
    const dupDiags = diags.filter((d) => d.rule === "duplicate-definition");
    assert.equal(dupDiags.length, 0);
  });
});

// ---------- Section 2: Fragment spread references ----------

describe("undefined fragment spread diagnostics", () => {
  it("warns when a schema spreads a fragment that does not exist in the index", () => {
    // A spread to a nonexistent fragment is a silent data loss risk — the field
    // group intended to be merged is absent. Must be warned even if the schema
    // itself has valid declared fields.
    const index = makeIndex({
      schemas: [{ name: "hub_customer", spreads: ["audit_fields"], fields: [] }],
    });
    const diags = collectSemanticDiagnostics(index);
    const spreadDiag = diags.find(
      (d) => d.rule === "undefined-ref" && d.message.includes("audit_fields"),
    );
    assert.ok(spreadDiag, "should warn about missing fragment spread");
  });

  it("warns when a record field inside a schema spreads a fragment that does not exist (bsw-xivc)", () => {
    // `schema t { a record { ...nope } }` validated clean while the same spread
    // at the top level warned. The nested form loses data just the same.
    const index = makeIndex({
      schemas: [
        {
          name: "t",
          fields: [
            { name: "a", type: "record", children: [], spreads: ["nope"], hasSpreads: true },
          ],
        },
      ],
    });
    const spreadDiags = collectSemanticDiagnostics(index).filter((d) => d.rule === "undefined-ref");
    assert.deepEqual(
      spreadDiags.map((d) => d.message),
      ["Schema 't' spreads undefined fragment 'nope' in record 'a'"],
    );
  });

  it("does not warn when the fragment exists in the index", () => {
    // Regression guard: a valid spread must not generate a false positive.
    const index = makeIndex({
      schemas: [{ name: "hub_customer", spreads: ["audit_fields"], fields: [] }],
      fragments: [{ name: "audit_fields", fields: [] }],
    });
    const diags = collectSemanticDiagnostics(index);
    const spreadDiags = diags.filter(
      (d) => d.rule === "undefined-ref" && d.message.includes("audit_fields"),
    );
    assert.equal(spreadDiags.length, 0);
  });
});

// ---------- Section 3: Mapping source/target references ----------

describe("mapping source/target reference diagnostics", () => {
  it("warns when a mapping's source schema does not exist", () => {
    // A mapping referencing a nonexistent source will always have zero arrows
    // validated — silent data loss. The check fires even if the target exists.
    const index = makeIndex({
      mappings: [{ name: "load", sources: ["ghost_schema"], targets: ["hub_customer"] }],
      schemas: [{ name: "hub_customer", fields: [] }],
    });
    const diags = collectSemanticDiagnostics(index);
    const srcDiag = diags.find(
      (d) => d.rule === "undefined-ref" && d.message.includes("ghost_schema"),
    );
    assert.ok(srcDiag, "should warn about missing source schema");
  });

  it("warns when a mapping's target schema does not exist", () => {
    const index = makeIndex({
      mappings: [{ name: "load", sources: ["orders"], targets: ["nonexistent_target"] }],
      schemas: [{ name: "orders", fields: [] }],
    });
    const diags = collectSemanticDiagnostics(index);
    const tgtDiag = diags.find(
      (d) => d.rule === "undefined-ref" && d.message.includes("nonexistent_target"),
    );
    assert.ok(tgtDiag, "should warn about missing target schema");
  });

  it("appends a namespace hint when the name exists in a different namespace", () => {
    // When a bare name 'customers' is used but 'crm::customers' exists, the hint
    // guides the user toward the fully-qualified form rather than leaving them guessing.
    const index = makeIndex({
      mappings: [{ name: "load", sources: ["customers"], targets: ["hub"] }],
      schemas: [
        { name: "customers", namespace: "crm", qualifiedName: "crm::customers", fields: [] },
        { name: "hub", fields: [] },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const srcDiag = diags.find(
      (d) => d.message.includes("customers") && d.message.includes("hint"),
    );
    assert.ok(srcDiag, "should include namespace hint in message");
  });

  it("does not warn when both source and target exist", () => {
    const index = makeIndex({
      mappings: [{ name: "load", sources: ["orders"], targets: ["hub_orders"] }],
      schemas: [
        { name: "orders", fields: [{ name: "id", type: "INT" }] },
        { name: "hub_orders", fields: [{ name: "order_hk", type: "CHAR(32)" }] },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const refDiags = diags.filter((d) => d.rule === "undefined-ref");
    assert.equal(refDiags.length, 0);
  });
});

// ---------- Section 4: Metric source references ----------

describe("metric source reference diagnostics", () => {
  it("warns when a metric's source schema does not exist", () => {
    // Metrics referencing ghost schemas will produce no data but won't fail
    // at query time — early detection prevents silent empty results.
    const index = makeIndex({
      metrics: [{ name: "mrr", sources: ["ghost_schema"] }],
    });
    const diags = collectSemanticDiagnostics(index);
    const metricDiag = diags.find((d) => d.rule === "undefined-ref" && d.message.includes("mrr"));
    assert.ok(metricDiag, "should warn about missing metric source");
  });

  it("does not warn when the metric source exists", () => {
    const index = makeIndex({
      metrics: [{ name: "mrr", sources: ["orders"] }],
      schemas: [{ name: "orders", fields: [] }],
    });
    const diags = collectSemanticDiagnostics(index);
    const metricDiags = diags.filter(
      (d) => d.rule === "undefined-ref" && d.message.includes("mrr"),
    );
    assert.equal(metricDiags.length, 0);
  });
});

// ---------- Section 6: Arrow field references ----------

describe("arrow field-not-in-schema diagnostics", () => {
  it("accepts a namespaced target schema's bare name as a flatten root", () => {
    // A flatten header targets the schema root, and authors inside that
    // namespace may use its bare name. Treating only the canonical key as the
    // root produces a false warning before any child arrow is considered.
    const index = makeIndex({
      schemas: [
        { name: "source", namespace: "survey", fields: [{ name: "items", type: "list" }] },
        { name: "fact", namespace: "mart", fields: [{ name: "value", type: "INT" }] },
      ],
      mappings: [
        {
          name: "publish",
          namespace: "mart",
          sources: ["survey::source"],
          targets: ["fact"],
        },
      ],
      fieldArrows: [
        {
          mapping: "publish",
          namespace: "mart",
          sources: ["items"],
          target: "fact",
          steps: [],
          line: 5,
          file: "test.stm",
        },
      ],
    });

    const fieldDiags = collectSemanticDiagnostics(index).filter(
      (diagnostic) => diagnostic.rule === "field-not-in-schema",
    );
    assert.deepEqual(fieldDiags, []);
  });

  it("warns when an arrow source field is not declared in the source schema", () => {
    // Arrow paths that don't match any declared field are almost always typos.
    // The check fires only when the source schema is known and has no unresolved spreads.
    const index = makeIndex({
      schemas: [
        { name: "orders", fields: [{ name: "id", type: "INT" }] },
        { name: "hub_orders", fields: [{ name: "order_hk", type: "CHAR(32)" }] },
      ],
      mappings: [{ name: "load orders", sources: ["orders"], targets: ["hub_orders"] }],
      fieldArrows: [
        {
          mapping: "load orders",
          namespace: null,
          sources: ["nonexistent_field"],
          target: "order_hk",
          steps: [],
          line: 5,
          file: "test.stm",
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const fieldDiag = diags.find(
      (d) => d.rule === "field-not-in-schema" && d.message.includes("nonexistent_field"),
    );
    assert.ok(fieldDiag, "should warn about undeclared arrow source field");
  });

  it("does not warn when the arrow source field exists in the schema", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "orders",
          fields: [
            { name: "id", type: "INT" },
            { name: "amount", type: "DECIMAL" },
          ],
        },
        { name: "hub_orders", fields: [{ name: "order_hk", type: "CHAR(32)" }] },
      ],
      mappings: [{ name: "load orders", sources: ["orders"], targets: ["hub_orders"] }],
      fieldArrows: [
        {
          mapping: "load orders",
          namespace: null,
          sources: ["id"],
          target: "order_hk",
          steps: [],
          line: 5,
          file: "test.stm",
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const fieldDiags = diags.filter((d) => d.rule === "field-not-in-schema");
    assert.equal(fieldDiags.length, 0);
  });

  /**
   * An index for one mapping from `shop` to `rows`, with the given arrows.
   * `shop` nests a list of line items inside an order record, the #525 shape.
   */
  function shopIndex(fieldArrows) {
    return makeIndex({
      schemas: [
        {
          name: "shop",
          fields: [
            {
              name: "Order",
              type: "record",
              children: [
                { name: "OrderId", type: "STRING" },
                {
                  name: "LineItems",
                  type: "list",
                  children: [
                    { name: "SKU", type: "STRING" },
                    { name: "Notes", type: "list", children: [{ name: "Text", type: "STRING" }] },
                  ],
                },
              ],
            },
          ],
        },
        {
          name: "rows",
          fields: [
            { name: "order_id", type: "STRING" },
            { name: "lines", type: "list", children: [{ name: "sku", type: "STRING" }] },
          ],
        },
      ],
      mappings: [{ name: "lines", sources: ["shop"], targets: ["rows"] }],
      fieldArrows: fieldArrows.map((a) => ({
        mapping: "lines",
        namespace: null,
        steps: [],
        line: 5,
        file: "test.stm",
        ...a,
      })),
    });
  }

  /** The field-not-in-schema messages for an index. */
  function fieldMessages(index) {
    return collectSemanticDiagnostics(index)
      .filter((d) => d.rule === "field-not-in-schema")
      .map((d) => d.message);
  }

  it("explains the #525 failure: names the flatten block and the ^. / $. spelling", () => {
    // GitHub #525: `Order.OrderId` inside `flatten Order.LineItems` is resolved
    // under the line item, as spec §4.4 requires. The bare finding read like a
    // tooling bug, so the message must say why and how to reach the order.
    const index = shopIndex([
      {
        sources: ["Order.LineItems.Order.OrderId"],
        target: "rows.order_id",
        nesting: {
          containerKind: "flatten",
          sourceContainer: "Order.LineItems",
          targetContainer: "rows",
          authoredSources: ["Order.OrderId"],
          authoredTarget: "order_id",
        },
      },
    ]);
    assert.deepEqual(fieldMessages(index), [
      "Arrow source 'Order.LineItems.Order.OrderId' not declared in schema 'shop'" +
        " — paths inside 'flatten Order.LineItems' are relative to it;" +
        " 'Order.OrderId' exists at an enclosing level, so write '^.OrderId' or '$.Order.OrderId' (spec §4.4)",
    ]);
  });

  it("gives no hint for a path that exists at no level", () => {
    // A plain typo must keep the plain finding; a hint here would send the
    // author looking for a field that is not there.
    const index = shopIndex([
      {
        sources: ["Order.LineItems.Nope"],
        target: null,
        nesting: {
          containerKind: "flatten",
          sourceContainer: "Order.LineItems",
          targetContainer: "rows",
          authoredSources: [".Nope"],
          authoredTarget: null,
        },
      },
    ]);
    assert.deepEqual(fieldMessages(index), [
      "Arrow source 'Order.LineItems.Nope' not declared in schema 'shop'",
    ]);
  });

  it("hints for each-inside-each naming a field of the outer element", () => {
    // Inside `each Notes` within `each LineItems`, `SKU` belongs to the line
    // item one level up; the nested-each case had no workaround before ADR-053.
    const index = shopIndex([
      {
        sources: ["Order.LineItems.Notes.SKU"],
        target: null,
        nesting: {
          containerKind: "each",
          sourceContainer: "Order.LineItems.Notes",
          targetContainer: null,
          authoredSources: ["SKU"],
          authoredTarget: null,
        },
      },
    ]);
    const [message] = fieldMessages(index);
    assert.match(message, /paths inside 'each Order\.LineItems\.Notes' are relative to it/);
    assert.match(message, /write '\^\.SKU' or '\$\.Order\.LineItems\.SKU'/);
  });

  it("hints for a target path too", () => {
    // Target paths are prefixed by the target container the same way (§4.4):
    // `order_id` inside `-> lines` means `lines.order_id`, but the target
    // declares it at the root.
    const index = shopIndex([
      {
        sources: [],
        target: "lines.order_id",
        nesting: {
          containerKind: "each",
          sourceContainer: "Order.LineItems",
          targetContainer: "lines",
          authoredSources: [],
          authoredTarget: "order_id",
        },
      },
    ]);
    assert.deepEqual(fieldMessages(index), [
      "Arrow target 'lines.order_id' not declared in schema 'rows'" +
        " — paths inside 'each lines' are relative to it;" +
        " 'order_id' exists at an enclosing level, so write '$.order_id' (spec §4.4)",
    ]);
  });

  it("counts a dotted backtick container as one level in the hint (bsw-2yzd)", () => {
    // `` `line.items` `` is one field. Split on ".", the container looked three
    // deep and the hint told the author to write '^.^.sid', which pops past the
    // order. Extraction records the container's segments; the hint must use them.
    const index = makeIndex({
      schemas: [
        {
          name: "src",
          fields: [
            {
              name: "order",
              type: "record",
              children: [
                { name: "sid", type: "STRING" },
                { name: "line.items", type: "list", children: [{ name: "v", type: "STRING" }] },
              ],
            },
          ],
        },
        { name: "tgt", fields: [{ name: "y", type: "STRING" }] },
      ],
      mappings: [{ name: "m", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [
        {
          mapping: "m",
          namespace: null,
          steps: [],
          line: 5,
          file: "test.stm",
          sources: ["order.line.items.sid"],
          target: null,
          nesting: {
            containerKind: "each",
            sourceContainer: "order.line.items",
            sourceContainerSegments: ["order", "line.items"],
            targetContainer: null,
            targetContainerSegments: null,
            authoredSources: ["sid"],
            authoredTarget: null,
          },
        },
      ],
    });
    const [message] = fieldMessages(index);
    assert.match(message, /write '\^\.sid' or '\$\.order\.sid'/);
  });

  it("gives no hint when the container itself is undeclared", () => {
    // The container's own arrow carries the real finding; steering its children
    // to $. would hide a misnamed list (the docs' `-> order_lines` in #525).
    const index = shopIndex([
      {
        sources: [],
        target: "order_lines.order_id",
        nesting: {
          containerKind: "flatten",
          sourceContainer: "Order.LineItems",
          targetContainer: "order_lines",
          authoredSources: [],
          authoredTarget: "order_id",
        },
      },
    ]);
    assert.deepEqual(fieldMessages(index), [
      "Arrow target 'order_lines.order_id' not declared in schema 'rows'",
    ]);
  });

  it("suppresses field-not-in-schema for schemas with unresolved spreads", () => {
    // When a schema spreads a fragment that cannot be resolved, the full field set
    // is unknown. Emitting a field-not-in-schema warning in that case would be a
    // false positive — the field may come from the unresolved spread.
    const index = makeIndex({
      schemas: [
        {
          name: "orders",
          fields: [{ name: "id", type: "INT" }],
          spreads: ["base_fields"], // unresolvable: base_fields not in fragments
          hasSpreads: true,
        },
        { name: "hub_orders", fields: [{ name: "order_hk", type: "CHAR(32)" }] },
      ],
      mappings: [{ name: "load orders", sources: ["orders"], targets: ["hub_orders"] }],
      fieldArrows: [
        {
          mapping: "load orders",
          namespace: null,
          sources: ["spread_sourced_field"],
          target: "order_hk",
          steps: [],
          line: 5,
          file: "test.stm",
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const fieldDiags = diags.filter(
      (d) => d.rule === "field-not-in-schema" && d.message.includes("spread_sourced_field"),
    );
    assert.equal(fieldDiags.length, 0, "must not warn when source has unresolved spreads");
  });

  // bsw-xivc: a schema whose only spreads sit inside a record body was read as
  // "has unresolved spreads", which switches off every field check for it.

  /** Schemas for the nested-spread cases: `nested.r` takes its fields from `f`. */
  const nestedSpreadSchemas = () => [
    { name: "flat", fields: [{ name: "x", type: "INT" }] },
    {
      name: "nested",
      fields: [
        { name: "y", type: "INT" },
        { name: "r", type: "record", children: [], spreads: ["f"], hasSpreads: true },
      ],
    },
  ];
  const nestedSpreadFragments = [{ name: "f", fields: [{ name: "a", type: "INT" }] }];
  const arrow = (sources, target) => ({
    mapping: "m",
    namespace: null,
    sources,
    target,
    steps: [],
    line: 5,
    file: "test.stm",
  });

  it("still warns about an undeclared target when the target's only spread is a resolved nested one (bsw-xivc)", () => {
    const index = makeIndex({
      schemas: nestedSpreadSchemas(),
      fragments: nestedSpreadFragments,
      mappings: [{ name: "m", sources: ["flat"], targets: ["nested"] }],
      fieldArrows: [arrow(["x"], "bogus")],
    });
    assert.deepEqual(fieldMessages(index), [
      "Arrow target 'bogus' not declared in schema 'nested'",
    ]);
  });

  it("still warns about an undeclared source when the source's only spread is a resolved nested one (bsw-xivc)", () => {
    const index = makeIndex({
      schemas: nestedSpreadSchemas(),
      fragments: nestedSpreadFragments,
      mappings: [{ name: "m", sources: ["nested"], targets: ["flat"] }],
      fieldArrows: [arrow(["bogus_src"], "x")],
    });
    assert.deepEqual(fieldMessages(index), [
      "Arrow source 'bogus_src' not declared in schema 'nested'",
    ]);
  });

  it("accepts a field a resolved nested spread contributes", () => {
    // The guard on the fix: once validation runs for the schema, the fields the
    // nested spread inlines (`r.a`) must count as declared.
    const index = makeIndex({
      schemas: nestedSpreadSchemas(),
      fragments: nestedSpreadFragments,
      mappings: [{ name: "m", sources: ["flat"], targets: ["nested"] }],
      fieldArrows: [arrow(["x"], "r.a")],
    });
    assert.deepEqual(fieldMessages(index), []);
  });

  // sl-kkao: multi-source mappings let arrows qualify a source path with the
  // schema name (s2.created_at). The qualified path sets were built from
  // declared fields only — spread-inherited fields validated clean in the
  // unqualified form but warned in the qualified form.

  it("accepts a schema-qualified spread-inherited field in a multi-source mapping (sl-kkao)", () => {
    const index = makeIndex({
      fragments: [{ name: "audit", fields: [{ name: "created_at", type: "TIMESTAMP" }] }],
      schemas: [
        { name: "s1", fields: [{ name: "id", type: "INT" }] },
        { name: "s2", fields: [{ name: "code", type: "STRING" }], spreads: ["audit"] },
        { name: "z", fields: [{ name: "z_created", type: "TIMESTAMP" }] },
      ],
      mappings: [{ name: "m", sources: ["s1", "s2"], targets: ["z"] }],
      fieldArrows: [
        {
          mapping: "m",
          namespace: null,
          sources: ["s2.created_at"],
          target: "z_created",
          steps: [],
          line: 5,
          file: "test.stm",
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const fieldDiags = diags.filter((d) => d.rule === "field-not-in-schema");
    assert.deepEqual(
      fieldDiags.map((d) => d.message),
      [],
      "qualified spread-inherited field must validate clean",
    );
  });

  it("blames the schema a qualified path names, not the first source (sl-kkao)", () => {
    // s2.missing exists nowhere — the warning must point the author at s2,
    // the schema they qualified the path with, not at s1.
    const index = makeIndex({
      schemas: [
        { name: "s1", fields: [{ name: "id", type: "INT" }] },
        { name: "s2", fields: [{ name: "code", type: "STRING" }] },
        { name: "z", fields: [{ name: "z_created", type: "TIMESTAMP" }] },
      ],
      mappings: [{ name: "m", sources: ["s1", "s2"], targets: ["z"] }],
      fieldArrows: [
        {
          mapping: "m",
          namespace: null,
          sources: ["s2.missing"],
          target: "z_created",
          steps: [],
          line: 5,
          file: "test.stm",
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const diag = diags.find(
      (d) => d.rule === "field-not-in-schema" && d.message.includes("s2.missing"),
    );
    assert.ok(diag, "should still warn for a genuinely missing qualified field");
    assert.match(diag.message, /schema 's2'/);
    assert.ok(!diag.message.includes("'s1'"), "must not blame the first source schema");
  });
});

// ---------- Section 7: Transform spread references ----------

describe("transform spread diagnostics", () => {
  it("warns when an arrow spreads a transform that does not exist", () => {
    // ...transform_name in arrow steps refers to a named transform block.
    // A missing transform is silently ignored at runtime — must be caught here.
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id", type: "INT" }] },
        { name: "tgt", fields: [{ name: "id", type: "INT" }] },
      ],
      mappings: [{ name: "m", sources: ["src"], targets: ["tgt"] }],
      fieldArrows: [
        {
          mapping: "m",
          namespace: null,
          sources: ["id"],
          target: "id",
          steps: [{ type: "fragment_spread", text: "...ghost_transform" }],
          line: 3,
          file: "test.stm",
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const spreadDiag = diags.find(
      (d) => d.rule === "undefined-ref" && d.message.includes("ghost_transform"),
    );
    assert.ok(spreadDiag, "should warn about missing transform spread");
  });

  it("does not warn when the transform exists", () => {
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "id", type: "INT" }] },
        { name: "tgt", fields: [{ name: "id", type: "INT" }] },
      ],
      mappings: [{ name: "m", sources: ["src"], targets: ["tgt"] }],
      transforms: [{ name: "hash_pk" }],
      fieldArrows: [
        {
          mapping: "m",
          namespace: null,
          sources: ["id"],
          target: "id",
          steps: [{ type: "fragment_spread", text: "...hash_pk" }],
          line: 3,
          file: "test.stm",
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const spreadDiags = diags.filter(
      (d) => d.rule === "undefined-ref" && d.message.includes("hash_pk"),
    );
    assert.equal(spreadDiags.length, 0);
  });
});

// ---------- Section 8: Ref metadata targets ----------

describe("ref metadata target diagnostics", () => {
  it("warns when a field's (ref @schema) annotation points to a nonexistent schema", () => {
    // (ref @ghost_schema) on a field is a cross-schema lineage annotation.
    // An unresolvable ref silently breaks lineage tracing — must be reported.
    const index = makeIndex({
      schemas: [
        {
          name: "hub_customer",
          fields: [
            {
              name: "customer_id",
              type: "INT",
              metadata: [{ kind: "kv", key: "ref", value: "@ghost_schema.id" }],
            },
          ],
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const refDiag = diags.find(
      (d) => d.rule === "undefined-ref" && d.message.includes("ghost_schema"),
    );
    assert.ok(refDiag, "should warn about nonexistent ref metadata target");
  });

  it("does not warn when the ref target schema exists", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "hub_customer",
          fields: [
            {
              name: "customer_id",
              type: "INT",
              metadata: [{ kind: "kv", key: "ref", value: "@crm_customers.id" }],
            },
          ],
        },
        { name: "crm_customers", fields: [{ name: "id", type: "INT" }] },
      ],
    });
    const diags = collectSemanticDiagnostics(index);
    const refDiags = diags.filter(
      (d) => d.rule === "undefined-ref" && d.message.includes("crm_customers"),
    );
    assert.equal(refDiags.length, 0);
  });
});

// ---------- Shared validation entry point ----------

describe("validateSemanticWorkspace", () => {
  it("computes import reachability and applies the default import-scope rule", () => {
    // This pins the shared consumer contract: callers pass resolved imports,
    // core computes reachability, and out-of-scope symbols use the CLI rule.
    const index = makeIndex({
      schemas: [{ name: "customers", file: "/workspace/customers.stm" }],
      mappings: [
        {
          name: "load customers",
          file: "/workspace/load.stm",
          sources: ["customers"],
          targets: ["customers"],
        },
      ],
    });
    const diags = validateSemanticWorkspace(index, {
      fileImports: new Map([
        ["/workspace/load.stm", []],
        ["/workspace/customers.stm", []],
      ]),
    });

    assert.equal(diags.length, 2);
    assert.deepEqual(
      diags.map((d) => d.rule),
      ["import-scope", "import-scope"],
    );
    assert.ok(
      diags.every((d) => d.message.includes("customers") && d.severity === "error"),
      "both mapping refs should be reported as out of import scope",
    );
  });

  it("allows consumers to customize import-scope presentation without changing the rule engine", () => {
    // LSP diagnostics keep their historic public code/message while using the
    // same reachability algorithm as CLI validation.
    const index = makeIndex({
      schemas: [{ name: "orders", file: "file:///workspace/orders.stm" }],
      mappings: [
        {
          name: "load orders",
          file: "file:///workspace/load.stm",
          sources: ["orders"],
          targets: [],
        },
      ],
    });
    const diags = validateSemanticWorkspace(index, {
      fileImports: new Map([
        ["file:///workspace/load.stm", []],
        ["file:///workspace/orders.stm", []],
      ]),
      importScopeDiagnostic: {
        rule: "missing-import",
        message: (violation) => `${violation.resolved} from ${violation.definitionFile}`,
      },
    });

    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "missing-import");
    assert.equal(diags[0].message, "orders from file:///workspace/orders.stm");
  });
});

// ---------- Constraint flags inside type parentheses (sl-vryu) ----------

describe("constraint-in-type-args", () => {
  it("warns when a known constraint flag is absorbed into type arguments (UUID(pk))", () => {
    // `customer_id UUID(pk)` parses cleanly with (pk) as part of the type
    // token; without this diagnostic the pk constraint silently disappears.
    const index = makeIndex({
      schemas: [
        {
          name: "customers",
          fields: [{ name: "customer_id", type: "UUID(pk)", startRow: 3 }],
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index).filter(
      (d) => d.rule === "constraint-in-type-args",
    );
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, "warning");
    assert.equal(diags[0].line, 4); // startRow 3 → 1-indexed line 4
    assert.match(diags[0].message, /'pk'/);
    assert.match(diags[0].message, /UUID \(pk\)/); // suggests the space form
  });

  it("does not warn for legitimate type arguments (DECIMAL(12,2), VARCHAR(MAX))", () => {
    // Type vocabulary is open-ended (spec 3.2); numeric and vendor args are
    // exactly what type parentheses are for.
    const index = makeIndex({
      schemas: [
        {
          name: "orders",
          fields: [
            { name: "amount", type: "DECIMAL(12,2)" },
            { name: "notes", type: "VARCHAR(MAX)" },
          ],
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index).filter(
      (d) => d.rule === "constraint-in-type-args",
    );
    assert.deepEqual(diags, []);
  });

  it("recurses into record children and checks fragments too", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "order",
          fields: [
            {
              name: "customer",
              type: "record",
              children: [{ name: "id", type: "STRING(required)", startRow: 5 }],
            },
          ],
        },
      ],
      fragments: [
        {
          name: "audit",
          fields: [{ name: "created_by", type: "VARCHAR(100)" }],
        },
      ],
    });
    const diags = collectSemanticDiagnostics(index).filter(
      (d) => d.rule === "constraint-in-type-args",
    );
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /'required'/);
  });
});

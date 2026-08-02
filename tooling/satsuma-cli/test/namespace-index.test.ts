/**
 * namespace-index.test.js — Tests for namespace-aware index building and validation
 *
 * Covers:
 * - Namespace-qualified index keys (ns::name)
 * - Per-namespace duplicate detection
 * - Same names across different namespaces (no conflict)
 * - Namespace metadata merging and conflict detection
 * - Namespace-aware reference resolution in validator
 * - Hint suggestions for unresolved references
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "#src/index-builder.js";
import { collectSemanticWarnings } from "#src/semantic-warnings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../examples");

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Build pre-extracted file data for buildIndex.
 * Simulates what extractFileData returns for a single file.
 */
function makeFileData({
  filePath = "test.stm",
  schemas = [],
  metrics = [],
  mappings = [],
  fragments = [],
  transforms = [],
  namespaces = [],
  arrowRecords = [],
  warnings = [],
  questions = [],
  errorCount = 0,
}: {
  filePath?: string;
  schemas?: any[];
  metrics?: any[];
  mappings?: any[];
  fragments?: any[];
  transforms?: any[];
  namespaces?: any[];
  arrowRecords?: any[];
  warnings?: any[];
  questions?: any[];
  errorCount?: number;
}): any {
  return {
    filePath,
    errorCount,
    schemas,
    metrics,
    mappings,
    fragments,
    transforms,
    warnings,
    questions,
    arrowRecords,
    namespaces,
  };
}

// ── Index key generation ─────────────────────────────────────────────────────

describe("namespace-qualified index keys", () => {
  it("stores global schemas under bare name", () => {
    const data = makeFileData({
      schemas: [{ name: "orders", namespace: null, fields: [], row: 0 }],
    });
    const index = buildIndex([data]);
    assert.ok(index.schemas.has("orders"), "Global schema should use bare name key");
    assert.ok(!index.schemas.has("null::orders"));
  });

  it("stores namespaced schemas under ns::name", () => {
    const data = makeFileData({
      schemas: [{ name: "stores", namespace: "pos", fields: [], row: 0 }],
    });
    const index = buildIndex([data]);
    assert.ok(index.schemas.has("pos::stores"), "Namespaced schema should use ns::name key");
    assert.ok(!index.schemas.has("stores"), "Should not also store under bare name");
  });

  it("stores mixed global and namespaced entities", () => {
    const data = makeFileData({
      schemas: [
        { name: "dim_date", namespace: null, fields: [], row: 0 },
        { name: "stores", namespace: "pos", fields: [], row: 5 },
        { name: "orders", namespace: "ecom", fields: [], row: 10 },
      ],
    });
    const index = buildIndex([data]);
    assert.ok(index.schemas.has("dim_date"));
    assert.ok(index.schemas.has("pos::stores"));
    assert.ok(index.schemas.has("ecom::orders"));
    assert.equal(index.schemas.size, 3);
  });

  it("applies ns::name keys to all entity types", () => {
    const data = makeFileData({
      schemas: [{ name: "s", namespace: "ns", fields: [], row: 0 }],
      metrics: [{ name: "m", namespace: "ns", sources: [], fields: [], row: 1 }],
      mappings: [{ name: "map", namespace: "ns", sources: [], targets: [], arrowCount: 0, row: 2 }],
      fragments: [{ name: "f", namespace: "ns", fields: [], row: 3 }],
      transforms: [{ name: "t", namespace: "ns", row: 4 }],
    });
    const index = buildIndex([data]);
    assert.ok(index.schemas.has("ns::s"));
    assert.ok(index.metrics.has("ns::m"));
    assert.ok(index.mappings.has("ns::map"));
    assert.ok(index.fragments.has("ns::f"));
    assert.ok(index.transforms.has("ns::t"));
  });
});

// ── Per-namespace duplicate detection ────────────────────────────────────────

describe("per-namespace duplicate detection", () => {
  it("detects duplicate within the same namespace", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      schemas: [{ name: "stores", namespace: "pos", fields: [], row: 0 }],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      schemas: [{ name: "stores", namespace: "pos", fields: [], row: 5 }],
    });
    const index = buildIndex([data1, data2]);
    assert.equal(index.duplicates.length, 1);
    assert.equal(index.duplicates[0].name, "pos::stores");
  });

  it("allows same name in different namespaces", () => {
    const data = makeFileData({
      schemas: [
        { name: "customer", namespace: "crm", fields: [], row: 0 },
        { name: "customer", namespace: "billing", fields: [], row: 5 },
      ],
    });
    const index = buildIndex([data]);
    assert.equal(
      index.duplicates.length,
      0,
      "Same name in different namespaces should not conflict",
    );
    assert.ok(index.schemas.has("crm::customer"));
    assert.ok(index.schemas.has("billing::customer"));
  });

  it("allows same name in a namespace and global", () => {
    const data = makeFileData({
      schemas: [
        { name: "customer", namespace: null, fields: [], row: 0 },
        { name: "customer", namespace: "crm", fields: [], row: 5 },
      ],
    });
    const index = buildIndex([data]);
    assert.equal(
      index.duplicates.length,
      0,
      "Same name in namespace and global should not conflict",
    );
    assert.ok(index.schemas.has("customer"));
    assert.ok(index.schemas.has("crm::customer"));
  });

  it("detects cross-kind duplicates within a namespace", () => {
    const data = makeFileData({
      schemas: [{ name: "customer", namespace: "crm", fields: [], row: 0 }],
      metrics: [{ name: "customer", namespace: "crm", sources: [], fields: [], row: 5 }],
    });
    const index = buildIndex([data]);
    assert.equal(index.duplicates.length, 1);
    assert.equal(index.duplicates[0].kind, "metric");
    assert.equal(index.duplicates[0].previousKind, "schema");
    assert.equal(index.duplicates[0].name, "crm::customer");
  });

  it("detects duplicates within the global namespace", () => {
    const data = makeFileData({
      schemas: [{ name: "customer", namespace: null, fields: [], row: 0 }],
      metrics: [{ name: "customer", namespace: null, sources: [], fields: [], row: 5 }],
    });
    const index = buildIndex([data]);
    assert.equal(index.duplicates.length, 1);
    assert.equal(index.duplicates[0].name, "customer");
  });

  it("does not flag cross-kind duplicates across different namespaces", () => {
    const data = makeFileData({
      schemas: [{ name: "customer", namespace: "crm", fields: [], row: 0 }],
      metrics: [{ name: "customer", namespace: "billing", sources: [], fields: [], row: 5 }],
    });
    const index = buildIndex([data]);
    assert.equal(index.duplicates.length, 0);
  });
});

// ── Namespace metadata merging ───────────────────────────────────────────────

describe("namespace metadata merging", () => {
  it("allows same note restated across blocks", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      namespaces: [{ name: "pos", note: "Oracle Retail POS", row: 0 }],
      schemas: [{ name: "stores", namespace: "pos", fields: [], row: 1 }],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      namespaces: [{ name: "pos", note: "Oracle Retail POS", row: 0 }],
      schemas: [{ name: "txns", namespace: "pos", fields: [], row: 1 }],
    });
    const index = buildIndex([data1, data2]);
    const metaConflicts = index.duplicates.filter((d: any) => d.kind === "namespace-metadata");
    assert.equal(metaConflicts.length, 0, "Same note value should not conflict");
  });

  it("allows one block with note, another without", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      namespaces: [{ name: "pos", note: "Oracle Retail POS", row: 0 }],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      namespaces: [{ name: "pos", note: null, row: 0 }],
    });
    const index = buildIndex([data1, data2]);
    const metaConflicts = index.duplicates.filter((d: any) => d.kind === "namespace-metadata");
    assert.equal(metaConflicts.length, 0);
  });

  it("detects conflicting note values", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      namespaces: [{ name: "pos", note: "Oracle Retail POS", row: 0 }],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      namespaces: [{ name: "pos", note: "POS system", row: 5 }],
    });
    const index = buildIndex([data1, data2]);
    const metaConflicts = index.duplicates.filter((d: any) => d.kind === "namespace-metadata");
    assert.equal(metaConflicts.length, 1);
    assert.equal(metaConflicts[0].name, "pos");
    assert.equal(metaConflicts[0].tag, "note");
    assert.equal(metaConflicts[0].value, "POS system");
    assert.equal(metaConflicts[0].previousValue, "Oracle Retail POS");
  });
});

// ── Namespace names tracking ─────────────────────────────────────────────────

describe("namespaceNames set", () => {
  it("collects all namespace names", () => {
    const data = makeFileData({
      schemas: [
        { name: "s1", namespace: "pos", fields: [], row: 0 },
        { name: "s2", namespace: "ecom", fields: [], row: 5 },
        { name: "s3", namespace: null, fields: [], row: 10 },
      ],
    });
    const index = buildIndex([data]);
    assert.ok(index.namespaceNames.has("pos"));
    assert.ok(index.namespaceNames.has("ecom"));
    assert.ok(!index.namespaceNames.has("__global__"));
    assert.equal(index.namespaceNames.size, 2);
  });
});

// ── Namespace-aware validator: reference resolution ──────────────────────────

describe("namespace-aware reference resolution", () => {
  it("resolves local namespace reference", () => {
    const data = makeFileData({
      schemas: [
        { name: "pos_oracle", namespace: "pos", fields: [], row: 0 },
        { name: "hub_store", namespace: "vault", fields: [], row: 5 },
      ],
      mappings: [
        {
          name: "load",
          namespace: "vault",
          sources: ["pos::pos_oracle"],
          targets: ["hub_store"],
          arrowCount: 0,
          row: 10,
        },
      ],
    });
    const index = buildIndex([data]);
    const warnings = collectSemanticWarnings(index);
    const refWarnings = warnings.filter((w: any) => w.rule === "undefined-ref");
    assert.equal(refWarnings.length, 0, "Qualified source and local target should resolve");
  });

  it("resolves global reference from inside a namespace", () => {
    const data = makeFileData({
      schemas: [
        { name: "shared_lookup", namespace: null, fields: [], row: 0 },
        { name: "hub_store", namespace: "vault", fields: [], row: 5 },
      ],
      mappings: [
        {
          name: "load",
          namespace: "vault",
          sources: ["shared_lookup"],
          targets: ["hub_store"],
          arrowCount: 0,
          row: 10,
        },
      ],
    });
    const index = buildIndex([data]);
    const warnings = collectSemanticWarnings(index);
    const refWarnings = warnings.filter((w: any) => w.rule === "undefined-ref");
    assert.equal(refWarnings.length, 0, "Global reference should resolve from inside namespace");
  });

  it("warns for unqualified reference to another namespace", () => {
    const data = makeFileData({
      schemas: [
        { name: "pos_oracle", namespace: "pos", fields: [], row: 0 },
        { name: "hub_store", namespace: "vault", fields: [], row: 5 },
      ],
      mappings: [
        {
          name: "bad_ref",
          namespace: "vault",
          sources: ["pos_oracle"],
          targets: ["hub_store"],
          arrowCount: 0,
          row: 10,
        },
      ],
    });
    const index = buildIndex([data]);
    const warnings = collectSemanticWarnings(index);
    const refWarnings = warnings.filter((w: any) => w.rule === "undefined-ref");
    assert.equal(refWarnings.length, 1, "Unqualified cross-namespace ref should warn");
    assert.ok(refWarnings[0].message.includes("pos_oracle"));
  });

  it("provides hints for unresolved references", () => {
    const data = makeFileData({
      schemas: [
        { name: "customer", namespace: "crm", fields: [], row: 0 },
        { name: "customer", namespace: "billing", fields: [], row: 5 },
        { name: "target", namespace: null, fields: [], row: 10 },
      ],
      mappings: [
        {
          name: "load",
          namespace: null,
          sources: ["customer"],
          targets: ["target"],
          arrowCount: 0,
          row: 15,
        },
      ],
    });
    const index = buildIndex([data]);
    const warnings = collectSemanticWarnings(index);
    const refWarnings = warnings.filter((w: any) => w.rule === "undefined-ref");
    assert.equal(refWarnings.length, 1);
    assert.ok(refWarnings[0].message.includes("hint"), "Should include a hint");
    assert.ok(
      refWarnings[0].message.includes("crm::customer") ||
        refWarnings[0].message.includes("billing::customer"),
    );
  });

  it("resolves qualified reference directly", () => {
    const data = makeFileData({
      schemas: [
        { name: "pos_oracle", namespace: "pos", fields: [], row: 0 },
        { name: "target", namespace: null, fields: [], row: 5 },
      ],
      mappings: [
        {
          name: "load",
          namespace: null,
          sources: ["pos::pos_oracle"],
          targets: ["target"],
          arrowCount: 0,
          row: 10,
        },
      ],
    });
    const index = buildIndex([data]);
    const warnings = collectSemanticWarnings(index);
    const refWarnings = warnings.filter((w: any) => w.rule === "undefined-ref");
    assert.equal(refWarnings.length, 0, "Qualified reference should resolve directly");
  });

  it("warns for qualified reference to non-existent namespace", () => {
    const data = makeFileData({
      schemas: [{ name: "target", namespace: null, fields: [], row: 0 }],
      mappings: [
        {
          name: "load",
          namespace: null,
          sources: ["nonexistent::schema"],
          targets: ["target"],
          arrowCount: 0,
          row: 5,
        },
      ],
    });
    const index = buildIndex([data]);
    const warnings = collectSemanticWarnings(index);
    const refWarnings = warnings.filter((w: any) => w.rule === "undefined-ref");
    assert.equal(refWarnings.length, 1);
    assert.ok(refWarnings[0].message.includes("nonexistent::schema"));
  });
});

// ── Namespace metadata conflict validation ───────────────────────────────────

describe("namespace metadata conflict diagnostics", () => {
  it("emits namespace-metadata-conflict error", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      namespaces: [{ name: "pos", note: "Oracle Retail POS", row: 0 }],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      namespaces: [{ name: "pos", note: "Different POS note", row: 5 }],
    });
    const index = buildIndex([data1, data2]);
    const warnings = collectSemanticWarnings(index);
    const metaErrors = warnings.filter((w: any) => w.rule === "namespace-metadata-conflict");
    assert.equal(metaErrors.length, 1);
    assert.equal(metaErrors[0].severity, "error");
    assert.ok(metaErrors[0].message.includes("pos"));
    assert.ok(metaErrors[0].message.includes("note"));
  });
});

// ── Backward compatibility: existing non-namespace behavior ──────────────────

describe("backward compatibility: global-only workspaces", () => {
  it("works identically for files without namespaces", () => {
    const data = makeFileData({
      schemas: [
        { name: "orders", namespace: null, fields: [{ name: "id", type: "INT" }], row: 0 },
        { name: "customers", namespace: null, fields: [{ name: "name", type: "VARCHAR" }], row: 5 },
      ],
      mappings: [
        {
          name: "load",
          namespace: null,
          sources: ["orders"],
          targets: ["customers"],
          arrowCount: 0,
          row: 10,
        },
      ],
    });
    const index = buildIndex([data]);
    assert.ok(index.schemas.has("orders"));
    assert.ok(index.schemas.has("customers"));
    const warnings = collectSemanticWarnings(index);
    const refWarnings = warnings.filter((w: any) => w.rule === "undefined-ref");
    assert.equal(refWarnings.length, 0);
  });

  it("detects duplicates in global namespace as before", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      schemas: [{ name: "orders", namespace: null, fields: [], row: 0 }],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      schemas: [{ name: "orders", namespace: null, fields: [], row: 5 }],
    });
    const index = buildIndex([data1, data2]);
    assert.equal(index.duplicates.length, 1);
    assert.equal(index.duplicates[0].name, "orders");
  });
});

// ── Schema field merging across files ─────────────────────────────────────────

describe("schema field merging across files", () => {
  it("merges fields from duplicate schema declarations", () => {
    const data1 = makeFileData({
      filePath: "hub-customer.stm",
      schemas: [
        {
          name: "pos_oracle",
          namespace: null,
          fields: [
            { name: "CUSTOMER_ID", type: "VARCHAR(20)" },
            { name: "FIRST_NAME", type: "VARCHAR(100)" },
          ],
          row: 49,
        },
      ],
    });
    const data2 = makeFileData({
      filePath: "hub-store.stm",
      schemas: [
        {
          name: "pos_oracle",
          namespace: null,
          fields: [
            { name: "STORE_ID", type: "VARCHAR(20)" },
            { name: "STORE_NAME", type: "VARCHAR(100)" },
          ],
          row: 20,
        },
      ],
    });
    const index = buildIndex([data1, data2]);
    const schema = index.schemas.get("pos_oracle");
    assert.ok(schema, "Schema should exist in index");
    const fieldNames = schema.fields.map((f: any) => f.name);
    assert.ok(fieldNames.includes("CUSTOMER_ID"), "Should have fields from first file");
    assert.ok(fieldNames.includes("FIRST_NAME"), "Should have fields from first file");
    assert.ok(fieldNames.includes("STORE_ID"), "Should have merged fields from second file");
    assert.ok(fieldNames.includes("STORE_NAME"), "Should have merged fields from second file");
    assert.equal(schema.fields.length, 4, "Should have all unique fields");
  });

  it("does not duplicate fields present in both declarations", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      schemas: [
        {
          name: "shared",
          namespace: null,
          fields: [
            { name: "id", type: "INT" },
            { name: "name", type: "VARCHAR" },
          ],
          row: 0,
        },
      ],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      schemas: [
        {
          name: "shared",
          namespace: null,
          fields: [
            { name: "id", type: "INT" },
            { name: "email", type: "VARCHAR" },
          ],
          row: 5,
        },
      ],
    });
    const index = buildIndex([data1, data2]);
    const schema = index.schemas.get("shared")!;
    const fieldNames = schema.fields.map((f: any) => f.name);
    assert.equal(
      fieldNames.filter((n: any) => n === "id").length,
      1,
      "Should not duplicate shared field",
    );
    assert.equal(schema.fields.length, 3, "id + name + email");
  });

  it("merges hasSpreads flag across declarations", () => {
    const data1 = makeFileData({
      filePath: "a.stm",
      schemas: [
        {
          name: "src",
          namespace: null,
          fields: [{ name: "id", type: "INT" }],
          hasSpreads: false,
          row: 0,
        },
      ],
    });
    const data2 = makeFileData({
      filePath: "b.stm",
      schemas: [
        {
          name: "src",
          namespace: null,
          fields: [{ name: "name", type: "VARCHAR" }],
          hasSpreads: true,
          row: 5,
        },
      ],
    });
    const index = buildIndex([data1, data2]);
    assert.equal(
      index.schemas.get("src")!.hasSpreads,
      true,
      "hasSpreads should be true if any declaration has spreads",
    );
  });

  it("merged schema fields resolve correctly in field-not-in-schema check", () => {
    const data1 = makeFileData({
      filePath: "hub-customer.stm",
      schemas: [
        {
          name: "pos_oracle",
          namespace: null,
          fields: [{ name: "CUSTOMER_ID", type: "VARCHAR(20)" }],
          row: 49,
        },
        {
          name: "hub_customer",
          namespace: null,
          fields: [{ name: "customer_id", type: "VARCHAR(20)" }],
          row: 70,
        },
      ],
      mappings: [
        {
          name: "pos to hub_customer",
          namespace: null,
          sources: ["pos_oracle"],
          targets: ["hub_customer"],
          arrowCount: 1,
          row: 80,
        },
      ],
      arrowRecords: [
        {
          mapping: "pos to hub_customer",
          namespace: null,
          sources: ["CUSTOMER_ID"],
          target: "customer_id",
          row: 85,
        },
      ],
    });
    const data2 = makeFileData({
      filePath: "hub-store.stm",
      schemas: [
        {
          name: "pos_oracle",
          namespace: null,
          fields: [
            { name: "STORE_ID", type: "VARCHAR(20)" },
            { name: "STORE_NAME", type: "VARCHAR(100)" },
          ],
          row: 20,
        },
      ],
      mappings: [
        {
          name: "pos to hub_store",
          namespace: null,
          sources: ["pos_oracle"],
          targets: ["hub_store"],
          arrowCount: 1,
          row: 40,
        },
      ],
      arrowRecords: [
        {
          mapping: "pos to hub_store",
          namespace: null,
          sources: ["STORE_NAME"],
          target: null,
          row: 45,
        },
      ],
    });
    // Add the hub_store target schema in data2
    data2.schemas.push({
      name: "hub_store",
      namespace: null,
      fields: [{ name: "store_name", type: "VARCHAR(100)" }],
      row: 30,
    });
    const index = buildIndex([data1, data2]);
    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 0, "Merged schema fields should resolve across files");
  });

  it("merged schema recursively merges nested record children across files", () => {
    // File A declares a record field "address" with child "street"
    const data1 = makeFileData({
      filePath: "file-a.stm",
      schemas: [
        {
          name: "customer",
          namespace: null,
          fields: [
            { name: "id", type: "INT" },
            {
              name: "address",
              type: "record",
              children: [{ name: "street", type: "VARCHAR(200)" }],
            },
          ],
          row: 1,
        },
        {
          name: "hub_customer",
          namespace: null,
          fields: [
            { name: "id", type: "INT" },
            { name: "address_street", type: "VARCHAR(200)" },
            { name: "address_city", type: "VARCHAR(100)" },
          ],
          row: 20,
        },
      ],
      mappings: [
        {
          name: "customer to hub_customer",
          namespace: null,
          sources: ["customer"],
          targets: ["hub_customer"],
          arrowCount: 2,
          row: 30,
        },
      ],
      arrowRecords: [
        {
          mapping: "customer to hub_customer",
          namespace: null,
          sources: ["address.street"],
          target: "address_street",
          row: 35,
        },
      ],
    });

    // File B declares the same "customer" schema with "address" having child "city"
    const data2 = makeFileData({
      filePath: "file-b.stm",
      schemas: [
        {
          name: "customer",
          namespace: null,
          fields: [
            {
              name: "address",
              type: "record",
              children: [{ name: "city", type: "VARCHAR(100)" }],
            },
          ],
          row: 1,
        },
      ],
      mappings: [
        {
          name: "customer to hub_customer_b",
          namespace: null,
          sources: ["customer"],
          targets: ["hub_customer"],
          arrowCount: 1,
          row: 10,
        },
      ],
      arrowRecords: [
        {
          mapping: "customer to hub_customer_b",
          namespace: null,
          sources: ["address.city"],
          target: "address_city",
          row: 15,
        },
      ],
    });

    const index = buildIndex([data1, data2]);

    // Verify the merged schema has both children under "address"
    const schema = index.schemas.get("customer");
    assert.ok(schema, "Merged schema should exist");
    const addressField = schema.fields.find((f: any) => f.name === "address");
    assert.ok(addressField, "address field should exist");
    assert.ok(addressField.children, "address should have children");
    const childNames = addressField.children.map((c: any) => c.name);
    assert.ok(childNames.includes("street"), "address should have street child");
    assert.ok(childNames.includes("city"), "address should have city child from second file");

    // Verify no false field-not-in-schema warnings
    const warnings = collectSemanticWarnings(index);
    const fieldWarnings = warnings.filter((w: any) => w.rule === "field-not-in-schema");
    assert.equal(
      fieldWarnings.length,
      0,
      "Nested record children should merge without false warnings",
    );
  });
});

// ── fieldArrows index keying with real files ────────────────────────────────

describe("fieldArrows index: nested child arrow keys (sl-9gvb)", () => {
  let parseFile: (filePath: string) => any;
  let extractFileData: (parsed: any) => any;

  before(async () => {
    const parser = await import("#src/parser.js");
    parseFile = parser.parseFile;
    const ib = await import("#src/index-builder.js");
    extractFileData = ib.extractFileData;
  });

  it("indexes nested child arrows with bare name, parent-prefixed, and schema-qualified keys", () => {
    // Nested arrow relative paths (.PHONE_TYPE) should be indexed under
    // bare name (PHONE_TYPE), parent-prefixed, and schema-qualified paths.
    const parsed = parseFile(resolve(EXAMPLES, "cobol-to-avro/pipeline.stm"));
    const data = extractFileData(parsed);
    const index = buildIndex([data]);
    assert.ok(index.fieldArrows.has("PHONE_TYPE"), "should index bare PHONE_TYPE");
    assert.ok(
      index.fieldArrows.has("cobol_customer_master.PHONE_NUMBERS.PHONE_TYPE"),
      "should index fully qualified PHONE_TYPE",
    );
  });
});

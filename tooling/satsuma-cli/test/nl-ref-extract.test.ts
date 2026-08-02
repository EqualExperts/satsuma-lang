/**
 * nl-ref-extract.test.js — Tests for NL @ref extraction utility
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAtRefs,
  classifyRef,
  resolveRef,
  isSchemaInMappingSources,
  resolveAllNLRefs,
} from "#src/nl-ref-extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── extractAtRefs ────────────────────────────────────────────────────────────

describe("extractAtRefs", () => {
  it("extracts a single @ref", () => {
    const refs = extractAtRefs("Lookup @department from employees");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].ref, "department");
  });

  it("extracts multiple @refs", () => {
    const refs = extractAtRefs(
      "Lookup @department from @source::hr_employees using @posted_by -> @employee_id",
    );
    assert.equal(refs.length, 4);
    assert.deepEqual(
      refs.map((r) => r.ref),
      ["department", "source::hr_employees", "posted_by", "employee_id"],
    );
  });

  it("returns empty array for text without @refs", () => {
    const refs = extractAtRefs("No references here");
    assert.equal(refs.length, 0);
  });

  it("returns empty array for empty string", () => {
    const refs = extractAtRefs("");
    assert.equal(refs.length, 0);
  });

  it("captures correct offsets", () => {
    const refs = extractAtRefs("abc @foo xyz @bar");
    assert.equal(refs[0].offset, 4);
    assert.equal(refs[1].offset, 13);
  });
});

// ── classifyRef ─────────────────────────────────────────────────────────────

describe("classifyRef", () => {
  it("classifies namespace-qualified schema", () => {
    assert.equal(classifyRef("source::hr_employees"), "namespace-qualified-schema");
  });

  it("classifies namespace-qualified field", () => {
    assert.equal(classifyRef("source::hr_employees.department"), "namespace-qualified-field");
  });

  it("classifies dotted field", () => {
    assert.equal(classifyRef("hr_employees.department"), "dotted-field");
  });

  it("classifies bare identifier", () => {
    assert.equal(classifyRef("department"), "bare");
  });
});

// ── resolveRef ──────────────────────────────────────────────────────────────

describe("resolveRef", () => {
  const makeIndex = (schemas: any = {}, transforms: any = {}, fragments: any = {}) =>
    ({
      schemas: new Map(Object.entries(schemas)),
      transforms: new Map(Object.entries(transforms)),
      fragments: new Map(Object.entries(fragments)),
    }) as any;

  it("resolves namespace-qualified schema", () => {
    const index = makeIndex({
      "source::hr_employees": { fields: [{ name: "employee_id" }] },
    });
    const result = resolveRef("source::hr_employees", {} as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "schema");
  });

  it("returns unresolved for unknown namespace-qualified schema", () => {
    const index = makeIndex({});
    const result = resolveRef("source::nonexistent", {} as any, index);
    assert.equal(result.resolved, false);
  });

  it("resolves namespace-qualified field", () => {
    const index = makeIndex({
      "source::hr_employees": { fields: [{ name: "department" }] },
    });
    const result = resolveRef("source::hr_employees.department", {} as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
  });

  it("returns unresolved for unknown field in known schema", () => {
    const index = makeIndex({
      "source::hr_employees": { fields: [{ name: "employee_id" }] },
    });
    const result = resolveRef("source::hr_employees.nonexistent", {} as any, index);
    assert.equal(result.resolved, false);
  });

  it("resolves bare field against mapping sources", () => {
    const index = makeIndex({
      "source::finance_gl": { fields: [{ name: "posted_by" }] },
    });
    const context = { sources: ["source::finance_gl"], targets: [] };
    const result = resolveRef("posted_by", context as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
    assert.equal(result.resolvedTo!.name, "source::finance_gl.posted_by");
  });

  it("resolves bare identifier as transform name", () => {
    const index = makeIndex({}, { clean_string: {} });
    const result = resolveRef("clean_string", {} as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "transform");
  });

  it("resolves bare identifier via namespace lookup", () => {
    const index = makeIndex({ "staging::stg_employees": { fields: [] } });
    const context = { sources: [], targets: [], namespace: "staging" };
    const result = resolveRef("stg_employees", context as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "schema");
    assert.equal(result.resolvedTo!.name, "staging::stg_employees");
  });

  it("returns unresolved for completely unknown bare identifier", () => {
    const index = makeIndex({});
    const result = resolveRef("nonexistent", { sources: [], targets: [] } as any, index);
    assert.equal(result.resolved, false);
  });

  it("resolves bare field against all workspace schemas when sources/targets are empty", () => {
    const index = makeIndex({
      my_schema: { fields: [{ name: "user_id" }, { name: "email" }] },
    });
    const context = { sources: [], targets: [] };
    const result = resolveRef("user_id", context as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
    assert.equal(result.resolvedTo!.name, "::my_schema.user_id");
  });

  it("does not fall back to all schemas when sources/targets are provided", () => {
    const index = makeIndex({
      other_schema: { fields: [{ name: "secret_field" }] },
      "source::src": { fields: [{ name: "known_field" }] },
    });
    const context = { sources: ["source::src"], targets: [] };
    const result = resolveRef("secret_field", context as any, index);
    assert.equal(result.resolved, false, "should not search schemas outside mapping context");
  });

  it("resolves nested field names", () => {
    const index = makeIndex({
      "source::orders": {
        fields: [{ name: "Customer", children: [{ name: "Email" }] }],
      },
    });
    const context = { sources: ["source::orders"], targets: [] };
    const result = resolveRef("Email", context as any, index);
    assert.equal(result.resolved, true);
  });

  it("resolves 3-segment dotted-field path (schema.record.subfield)", () => {
    const index = makeIndex({
      source_data: {
        fields: [{ name: "address", children: [{ name: "street" }, { name: "city" }] }],
      },
    });
    const context = { sources: ["source_data"], targets: [] };
    const result = resolveRef("source_data.address.street", context as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
    assert.equal(result.resolvedTo!.name, "::source_data.address.street");
  });

  it("resolves 3-segment namespace-qualified-field path (ns::schema.record.subfield)", () => {
    const index = makeIndex({
      "src::patient": {
        fields: [{ name: "PID", children: [{ name: "DateOfBirth" }, { name: "Name" }] }],
      },
    });
    const result = resolveRef("src::patient.PID.DateOfBirth", {} as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
    assert.equal(result.resolvedTo!.name, "src::patient.PID.DateOfBirth");
  });

  it("returns unresolved for 3-segment path when nested field does not exist", () => {
    const index = makeIndex({
      source_data: {
        fields: [{ name: "address", children: [{ name: "street" }] }],
      },
    });
    const context = { sources: ["source_data"], targets: [] };
    const result = resolveRef("source_data.address.zipcode", context as any, index);
    assert.equal(result.resolved, false);
  });

  it("resolves deeply nested path (4+ segments)", () => {
    const index = makeIndex({
      "src::msg": {
        fields: [
          {
            name: "header",
            children: [
              {
                name: "sender",
                children: [{ name: "name" }],
              },
            ],
          },
        ],
      },
    });
    const result = resolveRef("src::msg.header.sender.name", {} as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
  });

  it("resolves 3-segment dotted path via workspace fallback", () => {
    const index = makeIndex({
      contacts: {
        fields: [{ name: "home", children: [{ name: "phone" }] }],
      },
    });
    // No sources/targets — should fall back to workspace-wide search
    const context = { sources: [], targets: [] };
    const result = resolveRef("contacts.home.phone", context as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
  });
});

// ── resolveRef with fragment spreads ─────────────────────────────────────────

describe("resolveRef — fragment spread expansion", () => {
  const makeIndex = (schemas: any = {}, transforms: any = {}, fragments: any = {}) =>
    ({
      schemas: new Map(Object.entries(schemas)),
      transforms: new Map(Object.entries(transforms)),
      fragments: new Map(Object.entries(fragments)),
    }) as any;

  it("resolves namespace-qualified field via fragment spread", () => {
    const index = makeIndex(
      {
        "ex::product_day": {
          fields: [{ name: "DAY_DATE" }],
          hasSpreads: true,
          spreads: ["common_measures"],
          namespace: "ex",
        },
      },
      {},
      {
        "ex::common_measures": {
          fields: [{ name: "SALES_VALUE" }, { name: "RETURN_VALUE" }],
          hasSpreads: false,
        },
      },
    );
    const result = resolveRef("ex::product_day.SALES_VALUE", {} as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
  });

  it("resolves dotted-field via fragment spread", () => {
    const index = makeIndex(
      {
        "ex::product_day": {
          fields: [{ name: "DAY_DATE" }],
          hasSpreads: true,
          spreads: ["common_measures"],
          namespace: "ex",
        },
      },
      {},
      {
        "ex::common_measures": {
          fields: [{ name: "SALES_VALUE" }],
          hasSpreads: false,
        },
      },
    );
    const context = { sources: ["ex::product_day"], targets: [] };
    const result = resolveRef("product_day.SALES_VALUE", context as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
  });

  it("resolves bare identifier via fragment spread", () => {
    const index = makeIndex(
      {
        "ex::product_day": {
          fields: [{ name: "DAY_DATE" }],
          hasSpreads: true,
          spreads: ["common_measures"],
          namespace: "ex",
        },
      },
      {},
      {
        "ex::common_measures": {
          fields: [{ name: "SALES_VALUE" }],
          hasSpreads: false,
        },
      },
    );
    const context = { sources: ["ex::product_day"], targets: [] };
    const result = resolveRef("SALES_VALUE", context as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
  });

  it("resolves field via transitive fragment spread", () => {
    const index = makeIndex(
      {
        "ex::product_day": {
          fields: [{ name: "DAY_DATE" }],
          hasSpreads: true,
          spreads: ["base_measures"],
          namespace: "ex",
        },
      },
      {},
      {
        "ex::base_measures": {
          fields: [{ name: "QUANTITY" }],
          hasSpreads: true,
          spreads: ["audit_fields"],
          namespace: "ex",
        },
        "ex::audit_fields": {
          fields: [{ name: "CREATED_AT" }, { name: "UPDATED_AT" }],
          hasSpreads: false,
        },
      },
    );
    const result = resolveRef("ex::product_day.CREATED_AT", {} as any, index);
    assert.equal(result.resolved, true);
    assert.equal(result.resolvedTo!.kind, "field");
  });

  it("still returns unresolved for genuine miss with spreads", () => {
    const index = makeIndex(
      {
        "ex::product_day": {
          fields: [{ name: "DAY_DATE" }],
          hasSpreads: true,
          spreads: ["common_measures"],
          namespace: "ex",
        },
      },
      {},
      {
        "ex::common_measures": {
          fields: [{ name: "SALES_VALUE" }],
          hasSpreads: false,
        },
      },
    );
    const result = resolveRef("ex::product_day.NONEXISTENT", {} as any, index);
    assert.equal(result.resolved, false);
  });
});

// ── isSchemaInMappingSources ────────────────────────────────────────────────

describe("isSchemaInMappingSources", () => {
  it("returns true when schema is in sources", () => {
    const mapping = {
      sources: ["source::hr_employees"],
      targets: ["staging::stg_employees"],
    } as any;
    assert.equal(isSchemaInMappingSources("source::hr_employees", mapping), true);
  });

  it("returns true when schema is in targets", () => {
    const mapping = { sources: [], targets: ["staging::stg_employees"] } as any;
    assert.equal(isSchemaInMappingSources("staging::stg_employees", mapping), true);
  });

  it("returns false when schema is not in sources or targets", () => {
    const mapping = { sources: ["source::finance_gl"], targets: ["staging::stg_gl"] } as any;
    assert.equal(isSchemaInMappingSources("source::hr_employees", mapping), false);
  });

  it("returns false for null mapping", () => {
    assert.equal(isSchemaInMappingSources("source::hr_employees", undefined), false);
  });
});

// ── resolveAllNLRefs ────────────────────────────────────────────────────────

describe("resolveAllNLRefs", () => {
  it("resolves refs from nlRefData in the index", () => {
    const index = {
      schemas: new Map([
        ["source::hr_employees", { fields: [{ name: "department" }, { name: "employee_id" }] }],
        ["source::finance_gl", { fields: [{ name: "posted_by" }] }],
      ]),
      mappings: new Map([
        [
          "staging::stage gl entries",
          {
            sources: ["source::finance_gl", "source::hr_employees"],
            targets: ["staging::stg_gl_entries"],
          },
        ],
      ]),
      transforms: new Map(),
      fragments: new Map(),
      nlRefData: [
        {
          text: "Lookup @department from @source::hr_employees using @posted_by -> @employee_id",
          mapping: "stage gl entries",
          namespace: "staging",
          targetField: "department",
          file: "namespaces/ns-merging.stm",
          line: 99,
          column: 6,
        },
      ],
    };

    const results = resolveAllNLRefs(index as any);
    assert.equal(results.length, 4);

    // All should resolve
    assert.ok(
      results.every((r: any) => r.resolved),
      "all refs should resolve",
    );

    // Check specific resolutions
    const deptRef = results.find((r: any) => r.ref === "department") as any;
    assert.equal(deptRef.resolvedTo.kind, "field");

    const schemaRef = results.find((r: any) => r.ref === "source::hr_employees") as any;
    assert.equal(schemaRef.resolvedTo.kind, "schema");
    assert.equal(schemaRef.classification, "namespace-qualified-schema");
  });

  it("returns empty for index with no nlRefData", () => {
    const index = {
      schemas: new Map(),
      mappings: new Map(),
      transforms: new Map(),
      fragments: new Map(),
    };
    const results = resolveAllNLRefs(index as any);
    assert.equal(results.length, 0);
  });
});

// ── Real-file extraction tests (relocated from integration.test.ts) ─────────

describe("NL ref extraction against real fixtures", () => {
  let parseFile: (filePath: string) => any;
  let extractFileData: (parsed: any) => any;
  let buildIndex: (data: any[]) => any;

  before(async () => {
    const parser = await import("#src/parser.js");
    parseFile = parser.parseFile;
    const ib = await import("#src/index-builder.js");
    extractFileData = ib.extractFileData;
    buildIndex = ib.buildIndex;
  });

  it("extracts 3 @refs from standalone transform blocks", () => {
    // Transform NL strings should yield refs attributed to the transform.
    const fixture = resolve(__dirname, "fixtures", "transform-nl-refs.stm");
    const data = extractFileData(parseFile(fixture));
    const index = buildIndex([data]);
    const resolved = resolveAllNLRefs(index);
    assert.equal(resolved.length, 3, "should find 3 @refs");
    const refNames = resolved.map((r) => r.ref).sort();
    assert.deepStrictEqual(refNames, ["first_name", "last_name", "region_code"]);
  });

  it("extracts @refs from note blocks inside mappings (sl-z57o)", () => {
    // Note blocks inside mappings should yield refs with no targetField.
    const fixture = resolve(__dirname, "fixtures", "note-nl-refs.stm");
    const data = extractFileData(parseFile(fixture));
    const index = buildIndex([data]);
    const resolved = resolveAllNLRefs(index);
    assert.equal(resolved.length, 4, "should find 4 @refs (3 from note + 1 from arrow)");
    const noteRefs = resolved.filter((r) => r.targetField === null);
    assert.equal(noteRefs.length, 3, "3 refs should come from the note block");
    const refNames = noteRefs.map((r) => r.ref).sort();
    assert.deepStrictEqual(refNames, ["balance", "src_accounts", "tgt_accounts"]);
  });

  it("reports correct 0-indexed line numbers for refs in multiline strings (sl-djeo)", () => {
    // Multiline NL strings should yield 0-indexed row numbers. The CLI
    // command adds +1 for human-readable 1-indexed output.
    const fixture = resolve(__dirname, "fixtures", "multiline-nl.stm");
    const data = extractFileData(parseFile(fixture));
    const index = buildIndex([data]);
    const resolved = resolveAllNLRefs(index);
    assert.equal(resolved.length, 4, "should find 4 @refs");
    assert.equal(resolved[0].line, 14, "first ref on row 14 (= line 15)");
    assert.equal(resolved[1].line, 14, "second ref on row 14 (= line 15)");
    assert.equal(resolved[2].line, 16, "third ref on row 16 (= line 17)");
    assert.equal(resolved[3].line, 16, "fourth ref on row 16 (= line 17)");
  });
});

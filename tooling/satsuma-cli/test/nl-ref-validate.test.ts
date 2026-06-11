/**
 * nl-ref-validate.test.js — Tests for NL @ref validation
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectSemanticWarnings } from "#src/semantic-warnings.js";

/** Build a minimal ExtractedWorkspace with nlRefData for testing. */
function makeIndex({ schemas = [], mappings = [], nlRefData = [] }: {
  schemas?: any[];
  mappings?: any[];
  nlRefData?: any[];
}) {
  const schemaMap = new Map();
  for (const s of schemas) {
    schemaMap.set(s.name, { ...s, file: s.file ?? "test.stm", row: s.row ?? 0 });
  }
  const mappingMap = new Map();
  for (const m of mappings) {
    mappingMap.set(m.name, { ...m, file: m.file ?? "test.stm", row: m.row ?? 0 });
  }
  return {
    schemas: schemaMap,
    mappings: mappingMap,
    metrics: new Map(),
    fragments: new Map(),
    transforms: new Map(),
    notes: [],
    warnings: [],
    questions: [],
    fieldArrows: new Map(),
    referenceGraph: { usedByMappings: new Map(), fragmentsUsedIn: new Map(), metricsReferences: new Map() },
    namespaceNames: new Set(),
    nlRefData,
    duplicates: [],
    totalErrors: 0,
  } as any;
}

describe("NL ref validation: unresolved-nl-ref", () => {
  it("does not warn for valid NL @refs", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "department" }, { name: "employee_id" }] },
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl_entries", fields: [{ name: "department" }] },
      ],
      mappings: [{
        name: "staging::stage gl entries",
        namespace: "staging",
        sources: ["source::finance_gl", "source::hr_employees"],
        targets: ["staging::stg_gl_entries"],
      }],
      nlRefData: [{
        text: "Lookup @department from @source::hr_employees using @posted_by -> @employee_id",
        mapping: "stage gl entries",
        namespace: "staging",
        targetField: "department",
        file: "test.stm",
        line: 99,
        column: 6,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref" || w.rule === "nl-ref-not-in-source");
    assert.equal(nlWarnings.length, 0, "Valid NL refs should produce no warnings");
  });

  it("warns for unresolvable NL @refs", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl_entries", fields: [] },
      ],
      mappings: [{
        name: "staging::my_mapping",
        namespace: "staging",
        sources: ["source::finance_gl"],
        targets: ["staging::stg_gl_entries"],
      }],
      nlRefData: [{
        text: "Lookup @nonexistent_field from @source::unknown_schema",
        mapping: "my_mapping",
        namespace: "staging",
        targetField: "foo",
        file: "test.stm",
        line: 10,
        column: 6,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const unresolvedWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref");
    assert.equal(unresolvedWarnings.length, 2, "Should warn for both unresolved refs");
    assert.ok(unresolvedWarnings[0].message.includes("nonexistent_field"));
    assert.ok(unresolvedWarnings[1].message.includes("source::unknown_schema"));
  });
});

describe("NL ref validation: nl-ref-not-in-source", () => {
  it("warns when NL schema ref is not in mapping source/target list", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "employee_id" }] },
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl_entries", fields: [] },
      ],
      mappings: [{
        name: "staging::my_mapping",
        namespace: "staging",
        sources: ["source::finance_gl"],
        targets: ["staging::stg_gl_entries"],
      }],
      nlRefData: [{
        text: "Lookup from @source::hr_employees using @posted_by",
        mapping: "my_mapping",
        namespace: "staging",
        targetField: "dept",
        file: "test.stm",
        line: 15,
        column: 6,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const notInSrcWarnings = warnings.filter((w) => w.rule === "nl-ref-not-in-source");
    assert.equal(notInSrcWarnings.length, 1);
    assert.ok(notInSrcWarnings[0].message.includes("source::hr_employees"));
    assert.ok(notInSrcWarnings[0].message.includes("not declared in its source or target list"));
  });

  it("does not warn when NL schema ref is in the source list", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "employee_id" }] },
        { name: "source::finance_gl", fields: [] },
        { name: "staging::stg_gl_entries", fields: [] },
      ],
      mappings: [{
        name: "staging::my_mapping",
        namespace: "staging",
        sources: ["source::finance_gl", "source::hr_employees"],
        targets: ["staging::stg_gl_entries"],
      }],
      nlRefData: [{
        text: "Lookup from @source::hr_employees",
        mapping: "my_mapping",
        namespace: "staging",
        targetField: "dept",
        file: "test.stm",
        line: 15,
        column: 6,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const notInSrcWarnings = warnings.filter((w) => w.rule === "nl-ref-not-in-source");
    assert.equal(notInSrcWarnings.length, 0, "Should not warn when schema is declared");
  });
});

describe("NL ref validation: fragment spread fields", () => {
  it("does not warn for NL refs targeting fields from fragment spreads", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "ex::product_day",
          fields: [{ name: "DAY_DATE" }],
          hasSpreads: true,
          spreads: ["common_measures"],
          namespace: "ex",
        },
        { name: "ex::summary_day", fields: [{ name: "TOTAL_SALES" }, { name: "TOTAL_RETURNS" }] },
      ],
      mappings: [{
        name: "ex::Product to Summary",
        namespace: "ex",
        sources: ["ex::product_day"],
        targets: ["ex::summary_day"],
      }],
      nlRefData: [
        {
          text: "SUM(@ex::product_day.SALES_VALUE)",
          mapping: "Product to Summary",
          namespace: "ex",
          targetField: "TOTAL_SALES",
          file: "test.stm",
          line: 10,
          column: 6,
        },
        {
          text: "SUM(@ex::product_day.RETURN_VALUE)",
          mapping: "Product to Summary",
          namespace: "ex",
          targetField: "TOTAL_RETURNS",
          file: "test.stm",
          line: 11,
          column: 6,
        },
      ],
    });
    // Add fragments to the index
    index.fragments.set("ex::common_measures", {
      fields: [{ name: "SALES_VALUE" }, { name: "RETURN_VALUE" }],
      hasSpreads: false,
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref");
    assert.equal(nlWarnings.length, 0, "Fields from fragment spreads should not produce unresolved-nl-ref warnings");
  });

  it("still warns for genuine misses even when schema has spreads", () => {
    const index = makeIndex({
      schemas: [
        {
          name: "ex::product_day",
          fields: [{ name: "DAY_DATE" }],
          hasSpreads: true,
          spreads: ["common_measures"],
          namespace: "ex",
        },
        { name: "ex::summary_day", fields: [{ name: "TOTAL" }] },
      ],
      mappings: [{
        name: "ex::m1",
        namespace: "ex",
        sources: ["ex::product_day"],
        targets: ["ex::summary_day"],
      }],
      nlRefData: [{
        text: "SUM(@ex::product_day.NONEXISTENT)",
        mapping: "m1",
        namespace: "ex",
        targetField: "TOTAL",
        file: "test.stm",
        line: 10,
        column: 6,
      }],
    });
    index.fragments.set("ex::common_measures", {
      fields: [{ name: "SALES_VALUE" }],
      hasSpreads: false,
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref");
    assert.equal(nlWarnings.length, 1, "Genuine miss should still warn");
    assert.ok(nlWarnings[0].message.includes("NONEXISTENT"));
  });
});

describe("NL ref validation: standalone notes (sl-xrc8)", () => {
  it("does not warn for bare schema refs in standalone notes", () => {
    // Schema refs that resolve to known schemas should not produce unresolved-nl-ref warnings.
    const index = makeIndex({
      schemas: [
        { name: "source_system", fields: [{ name: "user_id" }] },
        { name: "target_system", fields: [{ name: "id" }] },
      ],
      nlRefData: [{
        text: "Converts @source_system records into @target_system",
        mapping: "note:",
        namespace: null,
        targetField: null,
        file: "test.stm",
        line: 5,
        column: 2,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref" || w.rule === "nl-ref-not-in-source");
    assert.equal(nlWarnings.length, 0, "Schema refs in standalone notes should not warn");
  });

  it("does not warn for bare field refs in standalone notes", () => {
    // A bare @fieldName that resolves globally should not produce unresolved-nl-ref warnings.
    const index = makeIndex({
      schemas: [
        { name: "my_schema", fields: [{ name: "user_id" }, { name: "email" }] },
      ],
      nlRefData: [{
        text: "The @user_id field is the primary key",
        mapping: "note:",
        namespace: null,
        targetField: null,
        file: "test.stm",
        line: 5,
        column: 2,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref" || w.rule === "nl-ref-not-in-source");
    assert.equal(nlWarnings.length, 0, "Bare field refs in standalone notes should resolve without warnings");
  });

  it("warns for unresolvable refs in file-level notes (sl-vjvf)", () => {
    // Bug sl-vjvf: file-level note @refs that don't resolve to any known identifier
    // should produce an unresolved-nl-ref warning. Previously these were silently skipped.
    const index = makeIndex({
      schemas: [
        { name: "my_schema", fields: [{ name: "user_id" }] },
      ],
      nlRefData: [{
        text: "Needs @external_config_key to be provisioned",
        mapping: "note:",
        namespace: null,
        targetField: null,
        file: "test.stm",
        line: 5,
        column: 2,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref");
    assert.equal(nlWarnings.length, 1, "Unresolvable @ref in file-level note should warn");
    assert.ok(nlWarnings[0].message.includes("external_config_key"));
  });

  it("does not warn for dotted field refs in standalone notes", () => {
    // Dotted @schema.field refs that resolve should not warn.
    const index = makeIndex({
      schemas: [
        { name: "source_system", fields: [{ name: "email_addr" }] },
      ],
      nlRefData: [{
        text: "See @source_system.email_addr for details",
        mapping: "note:",
        namespace: null,
        targetField: null,
        file: "test.stm",
        line: 5,
        column: 2,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref" || w.rule === "nl-ref-not-in-source");
    assert.equal(nlWarnings.length, 0, "Dotted field refs in standalone notes should not warn");
  });

  it("does not warn for refs in schema-scoped notes (note:<parent>)", () => {
    // Schema-scoped notes use a note:<name> mapping key. Resolved @refs should not warn.
    const index = makeIndex({
      schemas: [
        { name: "my_schema", fields: [{ name: "user_id" }] },
      ],
      nlRefData: [{
        text: "The @user_id is sequential",
        mapping: "note:my_schema",
        namespace: null,
        targetField: null,
        file: "test.stm",
        line: 5,
        column: 2,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref" || w.rule === "nl-ref-not-in-source");
    assert.equal(nlWarnings.length, 0, "Refs in schema-scoped notes should not warn");
  });

  it("does not warn for resolvable refs in namespaced note blocks (sl-1don)", () => {
    // Bug sl-1don: the note-context check tested the namespace-qualified key
    // ("crm::note:schema:foo"), which never starts with "note:", so namespaced
    // notes were treated as mapping contexts and resolvable schema refs hit the
    // source-membership check against an undefined mapping.
    const index = makeIndex({
      schemas: [
        { name: "crm::foo", namespace: "crm", fields: [{ name: "id" }] },
        { name: "crm::other", namespace: "crm", fields: [{ name: "key" }] },
      ],
      nlRefData: [{
        text: "derived from @other",
        mapping: "note:schema:foo",
        namespace: "crm",
        targetField: null,
        file: "test.stm",
        line: 5,
        column: 2,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref" || w.rule === "nl-ref-not-in-source");
    assert.equal(nlWarnings.length, 0, "Resolvable refs in namespaced notes should not warn");
  });

  it("never leaks the internal note: scope prefix into namespaced note messages (sl-1don)", () => {
    // Unresolvable refs in namespaced notes should warn with a human-readable
    // scope ("schema 'crm::foo'"), not the internal key ("crm::note:schema:foo").
    const index = makeIndex({
      schemas: [
        { name: "crm::foo", namespace: "crm", fields: [{ name: "id" }] },
      ],
      nlRefData: [{
        text: "needs @does_not_exist provisioned",
        mapping: "note:schema:foo",
        namespace: "crm",
        targetField: null,
        file: "test.stm",
        line: 5,
        column: 2,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref");
    assert.equal(nlWarnings.length, 1, "Unresolvable ref in a namespaced note should still warn");
    assert.ok(nlWarnings[0].message.includes("schema 'crm::foo'"), `message names the schema scope: ${nlWarnings[0].message}`);
    assert.ok(!nlWarnings[0].message.includes("note:"), `internal note: prefix must not leak: ${nlWarnings[0].message}`);
  });

  it("still warns for unresolved refs inside mapping notes", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::src", fields: [{ name: "amount" }] },
        { name: "target::tgt", fields: [] },
      ],
      mappings: [{
        name: "my_mapping",
        sources: ["source::src"],
        targets: ["target::tgt"],
      }],
      nlRefData: [{
        text: "Check @nonexistent_field before proceeding",
        mapping: "my_mapping",
        namespace: null,
        targetField: null,
        file: "test.stm",
        line: 10,
        column: 6,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const unresolvedWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref");
    assert.equal(unresolvedWarnings.length, 1, "Mapping notes should still warn for unresolved refs");
  });
});

describe("NL ref validation: bare field matching", () => {
  it("does not warn for bare field that matches a source schema field", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::gl", fields: [{ name: "amount" }, { name: "department" }] },
        { name: "staging::stg", fields: [{ name: "amount" }] },
      ],
      mappings: [{
        name: "staging::m1",
        namespace: "staging",
        sources: ["source::gl"],
        targets: ["staging::stg"],
      }],
      nlRefData: [{
        text: "Sum of @amount grouped by @department",
        mapping: "m1",
        namespace: "staging",
        targetField: "total",
        file: "test.stm",
        line: 20,
        column: 6,
      }],
    });

    const warnings = collectSemanticWarnings(index);
    const nlWarnings = warnings.filter((w) => w.rule === "unresolved-nl-ref" || w.rule === "nl-ref-not-in-source");
    assert.equal(nlWarnings.length, 0, "Bare fields matching source schema should not warn");
  });
});

/**
 * extract.test.js — Unit tests for satsuma-core extract module
 *
 * These tests verify the core extraction API using lightweight mock CST nodes.
 * The full CLI test suite (satsuma-cli/test/extract.test.js and integration
 * tests) provides deeper coverage via the re-export shim.
 *
 * Assertion convention (sl-d20o):
 * The most load-bearing extraction tests in this file assert against a full
 * expected object via `assert.deepStrictEqual` rather than poking at individual
 * fields with `assert.equal`. This catches accidental drift in default values,
 * extra fields creeping into the public shape, and key-omission regressions
 * (e.g. an optional `metadata` key flipping from absent to `undefined`). New
 * tests for the canonical/happy-path shape of an extractor's output should
 * follow the same pattern. Edge-case tests that target a single property may
 * still use `assert.equal` where a full-object comparison would obscure intent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractSchemas,
  extractMappings,
  extractFragments,
  extractImports,
  extractWarnings,
  extractQuestions,
  extractFieldTree,
  extractMetrics,
  extractNamespaces,
  extractNotes,
  extractTransforms,
} from "../dist/extract.js";

// ── Mock helpers ─────────────────────────────────────────────────────────────

function n(type, namedChildren = [], text = "", row = 0, anonymousChildren = [], column = 0) {
  const allChildren = [
    ...anonymousChildren.map(t => ({ type: t, text: t, isNamed: false, namedChildren: [], children: [] })),
    ...namedChildren.map(c => ({ ...c, isNamed: true })),
  ];
  return {
    type,
    text,
    isNamed: true,
    startPosition: { row, column },
    endPosition: { row, column: column + text.length },
    namedChildren,
    children: allChildren,
    parent: null,
    child: (i) => namedChildren[i] ?? null,
  };
}

function ident(text, row = 0) {
  return n("identifier", [], text, row);
}

// Build a block_label. Names wrapped in single quotes (e.g. "'my schema'")
// produce a backtick_name child instead of an identifier — this is how the
// grammar represents quoted multi-word names.
function blockLabel(name) {
  if (name.startsWith("'") && name.endsWith("'")) {
    const inner = name.slice(1, -1);
    return n("block_label", [n("backtick_name", [], `\`${inner}\``)]);
  }
  return n("block_label", [n("identifier", [], name)]);
}

function schemaBody(fields = []) {
  return n("schema_body", fields);
}

function fieldName(name) {
  return n("field_name", [ident(name)]);
}

function fieldDecl(name, type, row = 0, column = 0) {
  return n("field_decl", [fieldName(name), n("type_expr", [], type)], `${name} ${type}`, row, [], column);
}

function nlString(literal) {
  return n("nl_string", [], `"${literal}"`);
}

// backtick_name node — the canonical CST representation of a quoted multi-word name.
function backtickName(inner) {
  return n("backtick_name", [], `\`${inner}\``);
}

function sourceRef(nameNode, extraChildren = []) {
  return n("source_ref", [nameNode, ...extraChildren]);
}

// Build a record-typed field_decl. The 'record' keyword is encoded as an
// anonymous child token; metadata and inner body are both optional.
function recordFieldDecl(name, { body = [], meta = null } = {}) {
  const named = [fieldName(name)];
  if (meta) named.push(meta);
  if (body.length > 0) named.push(n("schema_body", body));
  return n("field_decl", named, "", 0, ["record"]);
}

// Build a namespace_block: ident, optional metadata, then child nodes.
function namespaceBlock(name, { children = [], meta = null, row = 0 } = {}) {
  const kids = [ident(name), ...(meta ? [meta] : []), ...children];
  return n("namespace_block", kids, "", row);
}

// ── extractSchemas ────────────────────────────────────────────────────────────

describe("extractSchemas()", () => {
  it("extracts a basic schema with fields", () => {
    const fd = fieldDecl("id", "INT");
    const body = schemaBody([fd]);
    const schemaBlock = n("schema_block", [blockLabel("customers"), body]);
    const root = n("program", [schemaBlock]);

    assert.deepStrictEqual(extractSchemas(root), [
      {
        name: "customers",
        namespace: null,
        note: null,
        fields: [{ name: "id", type: "INT", startRow: 0, startColumn: 0 }],
        hasSpreads: false,
        spreads: [],
        row: 0,
        startColumn: 0,
      },
    ]);
  });

  it("returns empty array for empty root", () => {
    const root = n("program", []);
    assert.deepEqual(extractSchemas(root), []);
  });

  it("extracts schemas inside namespace blocks", () => {
    const body = schemaBody([fieldDecl("x", "INT")]);
    const schemaBlock = n("schema_block", [blockLabel("orders"), body]);
    const nsBlock = n("namespace_block", [ident("crm"), schemaBlock]);
    const root = n("program", [nsBlock]);

    assert.deepStrictEqual(extractSchemas(root), [
      {
        name: "orders",
        namespace: "crm",
        note: null,
        fields: [{ name: "x", type: "INT", startRow: 0, startColumn: 0 }],
        hasSpreads: false,
        spreads: [],
        row: 0,
        startColumn: 0,
      },
    ]);
  });
});

// ── extractMappings ───────────────────────────────────────────────────────────

describe("extractMappings()", () => {
  it("extracts a mapping with source and target", () => {
    const srcRef = n("source_ref", [ident("customers")], "customers");
    const srcBlock = n("source_block", [srcRef]);
    const tgtRef = n("source_ref", [ident("dim_customer")], "dim_customer");
    const tgtBlock = n("target_block", [tgtRef]);
    const body = n("mapping_body", [srcBlock, tgtBlock]);
    const mappingBlock = n("mapping_block", [blockLabel("crm_to_dw"), body]);
    const root = n("program", [mappingBlock]);

    assert.deepStrictEqual(extractMappings(root), [
      {
        name: "crm_to_dw",
        namespace: null,
        sources: ["customers"],
        targets: ["dim_customer"],
        arrowCount: 0,
        row: 0,
        startColumn: 0,
      },
    ]);
  });
});

// ── extractFragments ──────────────────────────────────────────────────────────

describe("extractFragments()", () => {
  it("extracts a fragment with fields", () => {
    const body = schemaBody([fieldDecl("created_at", "TIMESTAMP")]);
    const fragBlock = n("fragment_block", [blockLabel("audit_fields"), body]);
    const root = n("program", [fragBlock]);

    assert.deepStrictEqual(extractFragments(root), [
      {
        name: "audit_fields",
        namespace: null,
        fields: [{ name: "created_at", type: "TIMESTAMP", startRow: 0, startColumn: 0 }],
        hasSpreads: false,
        spreads: [],
        row: 0,
        startColumn: 0,
      },
    ]);
  });
});

// ── extractImports ────────────────────────────────────────────────────────────

describe("extractImports()", () => {
  it("extracts an import declaration", () => {
    const importName = n("import_name", [ident("customers")]);
    const strNode = n("nl_string", [], '"./platform.stm"');
    const pathNode = n("import_path", [strNode]);
    const importDecl = n("import_decl", [importName, pathNode]);
    const root = n("program", [importDecl]);

    assert.deepStrictEqual(extractImports(root), [
      { names: ["customers"], path: "./platform.stm", row: 0, startColumn: 0 },
    ]);
  });
});

// ── extractFieldTree ──────────────────────────────────────────────────────────

describe("extractFieldTree()", () => {
  it("extracts scalar fields", () => {
    const body = schemaBody([fieldDecl("id", "INT"), fieldDecl("name", "STRING")]);
    const result = extractFieldTree(body);
    assert.equal(result.fields.length, 2);
    assert.equal(result.fields[0].name, "id");
    assert.equal(result.fields[0].type, "INT");
    assert.equal(result.hasSpreads, false);
  });

  it("tracks fragment spreads", () => {
    const spreadLabel = n("spread_label", [ident("audit_fields")], "audit_fields");
    const fragSpread = n("fragment_spread", [spreadLabel]);
    const body = n("schema_body", [fieldDecl("id", "INT"), fragSpread]);
    const result = extractFieldTree(body);
    assert.equal(result.hasSpreads, true);
    assert.deepEqual(result.spreads, ["audit_fields"]);
  });
});

// ── Position data on FieldDecl ───────────────────────────────────────────────

describe("FieldDecl position data", () => {
  it("populates startRow and startColumn from the field_decl CST node", () => {
    const body = schemaBody([fieldDecl("id", "INT", 3, 4), fieldDecl("name", "STRING", 4, 4)]);
    const result = extractFieldTree(body);
    assert.equal(result.fields[0].startRow, 3);
    assert.equal(result.fields[0].startColumn, 4);
    assert.equal(result.fields[1].startRow, 4);
    assert.equal(result.fields[1].startColumn, 4);
  });

  it("defaults position to row 0 column 0 when mock uses defaults", () => {
    const body = schemaBody([fieldDecl("x", "INT")]);
    const result = extractFieldTree(body);
    assert.equal(result.fields[0].startRow, 0);
    assert.equal(result.fields[0].startColumn, 0);
  });
});

// ── startColumn on Extracted* types ─────────────────────────────────────────

describe("startColumn on Extracted types", () => {
  it("extractSchemas includes startColumn from the schema_block node", () => {
    const body = schemaBody([fieldDecl("id", "INT")]);
    const schemaBlock = n("schema_block", [blockLabel("orders"), body], "", 5, [], 2);
    const root = n("program", [schemaBlock]);

    const result = extractSchemas(root);
    assert.equal(result[0].row, 5);
    assert.equal(result[0].startColumn, 2);
  });

  it("extractFragments includes startColumn from the fragment_block node", () => {
    const body = schemaBody([fieldDecl("ts", "TIMESTAMP")]);
    const fragBlock = n("fragment_block", [blockLabel("audit"), body], "", 10, [], 4);
    const root = n("program", [fragBlock]);

    const result = extractFragments(root);
    assert.equal(result[0].row, 10);
    assert.equal(result[0].startColumn, 4);
  });

  it("extractMappings includes startColumn from the mapping_block node", () => {
    const srcRef = n("source_ref", [ident("src")], "src");
    const srcBlock = n("source_block", [srcRef]);
    const body = n("mapping_body", [srcBlock]);
    const mappingBlock = n("mapping_block", [blockLabel("m"), body], "", 7, [], 6);
    const root = n("program", [mappingBlock]);

    const result = extractMappings(root);
    assert.equal(result[0].row, 7);
    assert.equal(result[0].startColumn, 6);
  });

  it("extractWarnings includes startColumn from the warning_comment node", () => {
    const warning = n("warning_comment", [], "//! caution", 2, [], 8);
    warning.parent = null;
    const root = n("program", [warning]);
    const result = extractWarnings(root);
    assert.equal(result[0].row, 2);
    assert.equal(result[0].startColumn, 8);
  });

  it("extractQuestions includes startColumn from the question_comment node", () => {
    const question = n("question_comment", [], "//? why", 3, [], 4);
    question.parent = null;
    const root = n("program", [question]);
    const result = extractQuestions(root);
    assert.equal(result[0].row, 3);
    assert.equal(result[0].startColumn, 4);
  });

  it("extractImports includes startColumn from the import_decl node", () => {
    const importName = n("import_name", [ident("foo")]);
    const strNode = n("nl_string", [], '"./bar.stm"');
    const pathNode = n("import_path", [strNode]);
    const importDecl = n("import_decl", [importName, pathNode], "", 0, [], 0);
    const root = n("program", [importDecl]);

    const result = extractImports(root);
    assert.equal(result[0].startColumn, 0);
  });
});

// ── extractWarnings and extractQuestions ─────────────────────────────────────

describe("extractWarnings()", () => {
  it("extracts warning comments", () => {
    const warning = n("warning_comment", [], "//! watch out");
    warning.parent = null;
    const root = n("program", [warning]);
    const result = extractWarnings(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "watch out");
  });
});

describe("extractQuestions()", () => {
  it("extracts question comments", () => {
    const question = n("question_comment", [], "//? is this right");
    question.parent = null;
    const root = n("program", [question]);
    const result = extractQuestions(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "is this right");
  });
});

// ── extractMetrics ──────────────────────────────────────────────────────────
// Metrics are schema_block nodes decorated with a `metric` tag_token in their
// metadata_block. The extractMetrics() function filters schema_blocks by that
// criterion and extracts metric-specific metadata alongside the field tree.

function metricTag() {
  // tag_token node with a single identifier child whose text is "metric"
  return n("tag_token", [ident("metric")], "metric");
}

describe("extractMetrics()", () => {
  it("schema_block decorated with metric tag is extracted as a metric", () => {
    // Validates that only schema_blocks with the `metric` tag_token are extracted.
    const body = schemaBody([fieldDecl("revenue", "DECIMAL")]);
    const meta = n("metadata_block", [metricTag()]);
    const schemaBlock = n("schema_block", [blockLabel("total_revenue"), meta, body]);
    const root = n("program", [schemaBlock]);

    assert.deepStrictEqual(extractMetrics(root), [
      {
        name: "total_revenue",
        namespace: null,
        displayName: null,
        sources: [],
        grain: null,
        slices: [],
        fields: [{ name: "revenue", type: "DECIMAL", startRow: 0, startColumn: 0 }],
        row: 0,
        startColumn: 0,
      },
    ]);
  });

  it("extracts source from metric schema metadata", () => {
    // Validates that the `source` tag in metadata is parsed into the sources array.
    const sourceVal = n("value_text", [ident("orders")], "orders");
    const sourceKv = n("tag_with_value", [ident("source"), sourceVal]);
    const meta = n("metadata_block", [metricTag(), sourceKv]);
    const schemaBlock = n("schema_block", [blockLabel("aov"), meta]);
    const root = n("program", [schemaBlock]);

    const result = extractMetrics(root);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].sources, ["orders"]);
  });

  it("non-metric schema_block is not extracted as a metric", () => {
    // Validates that plain schema_blocks (without the metric tag) are not included.
    const schemaBlock = n("schema_block", [blockLabel("orders")]);
    const root = n("program", [schemaBlock]);

    const result = extractMetrics(root);
    assert.equal(result.length, 0);
  });

  it("extracts metric schema inside a namespace block", () => {
    // Validates namespace propagation for metric schemas.
    const meta = n("metadata_block", [metricTag()]);
    const schemaBlock = n("schema_block", [blockLabel("revenue"), meta]);
    const nsBlock = n("namespace_block", [ident("finance"), schemaBlock]);
    const root = n("program", [nsBlock]);

    const result = extractMetrics(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "revenue");
    assert.equal(result[0].namespace, "finance");
  });
});

// ── extractTransforms ───────────────────────────────────────────────────────

describe("extractTransforms()", () => {
  it("extracts a transform block with its name", () => {
    const step = n("pipe_step", [n("pipe_text", [], "lookup(dim)")], "lookup(dim)");
    const pipeChain = n("pipe_chain", [step], "lookup(dim)");
    const transformBlock = n("transform_block", [blockLabel("enrich"), pipeChain]);
    const root = n("program", [transformBlock]);

    assert.deepStrictEqual(extractTransforms(root), [
      { name: "enrich", body: "lookup(dim)", canonicalBody: "lookup(dim)", namespace: null, row: 0, startColumn: 0 },
    ]);
  });

  it("canonicalBody normalizes step layout while body preserves it (sl-dxjh)", () => {
    // A formatter is free to put each pipe step on its own line; the raw
    // body keeps that layout but canonicalBody must be identical to the
    // single-line spelling so diff sees no structural change.
    const steps = [
      n("pipe_step", [n("pipe_text", [], "trim")], "trim"),
      n("pipe_step", [n("pipe_text", [], "uppercase")], "uppercase"),
    ];
    const pipeChain = n("pipe_chain", steps, "trim\n  | uppercase");
    const transformBlock = n("transform_block", [blockLabel("tidy"), pipeChain]);
    const root = n("program", [transformBlock]);

    const [t] = extractTransforms(root);
    assert.equal(t.body, "trim\n  | uppercase");
    assert.equal(t.canonicalBody, "trim | uppercase");
  });

  it("canonicalBody rebuilds map literals as a single-line entry list with verbatim keys/values (sl-dxjh)", () => {
    // Map entries may be authored comma-separated on one line or
    // newline-separated by the formatter — both canonicalize to the same
    // text. The quoted key and the value are NL content and must pass
    // through verbatim, including casing and inner whitespace.
    const entry = (k, v) => n("map_entry", [n("map_key", [], k), n("map_value", [], v)]);
    const mapLit = n("map_literal", [entry('"A B"', "first class"), entry("_", "other")],
      'map {\n  "A B": first class\n  _: other\n}');
    const pipeChain = n("pipe_chain", [n("pipe_step", [mapLit], mapLit.text)], mapLit.text);
    const transformBlock = n("transform_block", [blockLabel("classify"), pipeChain]);
    const root = n("program", [transformBlock]);

    const [t] = extractTransforms(root);
    assert.equal(t.canonicalBody, 'map { "A B": first class, _: other }');
  });

  it("extracts transform inside namespace", () => {
    const transformBlock = n("transform_block", [blockLabel("clean")]);
    const nsBlock = n("namespace_block", [ident("etl"), transformBlock]);
    const root = n("program", [nsBlock]);

    const result = extractTransforms(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "clean");
    assert.equal(result[0].namespace, "etl");
  });
});

// ── extractNotes ────────────────────────────────────────────────────────────

describe("extractNotes()", () => {
  it("extracts a top-level note block", () => {
    const nlStr = n("nl_string", [], '"This is a note"');
    const noteBlock = n("note_block", [nlStr]);
    const root = n("program", [noteBlock]);

    assert.deepStrictEqual(extractNotes(root), [
      { text: "This is a note", row: 0, startColumn: 0, parent: null, namespace: null },
    ]);
  });

  it("associates note with parent block", () => {
    const nlStr = n("nl_string", [], '"Schema note"');
    const noteBlock = n("note_block", [nlStr]);
    const body = n("schema_body", [noteBlock]);
    const schemaBlock = n("schema_block", [blockLabel("orders"), body]);
    const root = n("program", [schemaBlock]);

    const result = extractNotes(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "Schema note");
    assert.equal(result[0].parent, "orders");
  });
});

// ── extractFieldTree — nested records ───────────────────────────────────────

describe("extractFieldTree() — nested records", () => {
  it("extracts nested record fields with children", () => {
    const innerField = fieldDecl("city", "STRING");
    const innerBody = n("schema_body", [innerField]);
    const nameNode = n("field_name", [ident("address")]);
    // record field: has schema_body child and 'record' anonymous child
    const recordField = n("field_decl", [nameNode, innerBody], "address record { city STRING }", 0, ["record"]);

    const body = n("schema_body", [recordField]);
    const result = extractFieldTree(body);
    assert.equal(result.fields.length, 1);
    assert.equal(result.fields[0].name, "address");
    assert.equal(result.fields[0].type, "record");
    assert.equal(result.fields[0].children.length, 1);
    assert.equal(result.fields[0].children[0].name, "city");
  });

  it("extracts list_of record fields", () => {
    const innerField = fieldDecl("sku", "STRING");
    const innerBody = n("schema_body", [innerField]);
    const nameNode = n("field_name", [ident("items")]);
    const listRecordField = n("field_decl", [nameNode, innerBody], "items list_of record { sku STRING }", 0, ["list_of", "record"]);

    const body = n("schema_body", [listRecordField]);
    const result = extractFieldTree(body);
    assert.equal(result.fields.length, 1);
    assert.equal(result.fields[0].name, "items");
    assert.equal(result.fields[0].type, "record");
    assert.equal(result.fields[0].isList, true);
    assert.equal(result.fields[0].children.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional cases (migrated from satsuma-cli/test/extract.test.ts, sl-cvs2)
//
// These cases were originally in the CLI package but tested @satsuma/core's
// extraction APIs directly, violating the architecture rule that consumer
// tests must not duplicate core coverage. They were moved here so each
// invariant is tested at the right level. The CLI now keeps only its
// real-file integration tests that exercise parser → extract → buildIndex.
// ─────────────────────────────────────────────────────────────────────────────

// All helpers used here (`blockLabel`, `nlString`, `backtickName`, `fieldName`,
// `sourceRef`, `recordFieldDecl`, `namespaceBlock`) are defined at the top of
// the file alongside the rest of the mock-CST helpers.

// ── extractSchemas: name forms and metadata edge cases ──────────────────────

describe("extractSchemas — name forms and edge cases (sl-cvs2)", () => {
  it("strips backticks from a quoted schema name", () => {
    // Validates that block_label wrapping a backtick_name yields the inner text
    // without the surrounding backticks — important for grammar's quoted-name path.
    const body = n("schema_body", []);
    const block = n("schema_block", [blockLabel("'my schema'"), body]);
    const root = n("source_file", [block]);
    assert.equal(extractSchemas(root)[0].name, "my schema");
  });

  it("returns note=null when the schema has no metadata block", () => {
    // Validates that the note field defaults to null rather than undefined or "".
    const body = n("schema_body", []);
    const block = n("schema_block", [blockLabel("t"), body]);
    const root = n("source_file", [block]);
    assert.equal(extractSchemas(root)[0].note, null);
  });

  it("extracts every schema_block at the program root", () => {
    // Validates that the extractor visits all top-level schema_blocks, not just the first.
    const make = (name) => n("schema_block", [blockLabel(name), n("schema_body", [])]);
    const root = n("source_file", [make("a"), make("b"), make("c")]);
    assert.equal(extractSchemas(root).length, 3);
  });
});

// ── FieldDecl metadata enrichment (sl-cdvp) ─────────────────────────────────

describe("FieldDecl metadata enrichment (sl-cvs2)", () => {
  function schemaWith(fieldDecls) {
    const body = n("schema_body", fieldDecls);
    const block = n("schema_block", [blockLabel("test"), body]);
    return n("source_file", [block]);
  }

  it("extracts a tag entry (e.g. pk) from field metadata", () => {
    // Validates the tag-only metadata kind, the most common annotation form.
    const meta = n("metadata_block", [n("tag_token", [], "pk")]);
    const fd = n("field_decl", [fieldName("id"), n("type_expr", [], "INT"), meta]);
    const result = extractSchemas(schemaWith([fd]));
    assert.deepEqual(result[0].fields[0].metadata[0], { kind: "tag", tag: "pk" });
  });

  it("extracts a key-value entry (e.g. ref) from field metadata", () => {
    // Validates that tag_with_value pairs become {kind: 'kv', key, value}.
    const kvVal = n("value_text", [n("dotted_name", [], "dim_customer.customer_id")], "dim_customer.customer_id");
    const kvPair = n("tag_with_value", [ident("ref"), kvVal]);
    const meta = n("metadata_block", [kvPair]);
    const fd = n("field_decl", [fieldName("customer_id"), n("type_expr", [], "STRING(36)"), meta]);
    const result = extractSchemas(schemaWith([fd]));
    assert.deepEqual(result[0].fields[0].metadata[0], { kind: "kv", key: "ref", value: "dim_customer.customer_id" });
  });

  it("extracts an enum entry with all values from field metadata", () => {
    // Validates that enum_body identifiers are collected into the values array in order.
    const enumBody = n("enum_body", [ident("monthly"), ident("quarterly"), ident("annual")]);
    const meta = n("metadata_block", [enumBody]);
    const fd = n("field_decl", [fieldName("period"), n("type_expr", [], "STRING(10)"), meta]);
    const result = extractSchemas(schemaWith([fd]));
    assert.deepEqual(result[0].fields[0].metadata[0], { kind: "enum", values: ["monthly", "quarterly", "annual"] });
  });

  it("leaves metadata undefined when the field has no metadata_block", () => {
    // Validates that the metadata key is omitted (not null) for fields without annotations,
    // so consumers can use truthy checks to distinguish "no metadata" from "empty metadata".
    const fd = n("field_decl", [fieldName("name"), n("type_expr", [], "VARCHAR(100)")]);
    const result = extractSchemas(schemaWith([fd]));
    assert.equal(result[0].fields[0].metadata, undefined);
  });

  it("extracts metadata from inner fields of a record field", () => {
    // Validates that record-field children are walked and their own metadata is preserved.
    const innerMeta = n("metadata_block", [n("tag_token", [], "required")]);
    const innerFd = n("field_decl", [fieldName("street"), n("type_expr", [], "VARCHAR(200)"), innerMeta]);
    const recField = recordFieldDecl("address", { body: [innerFd] });
    const result = extractSchemas(schemaWith([recField]));
    assert.deepEqual(result[0].fields[0].children[0].metadata[0], { kind: "tag", tag: "required" });
  });

  it("extracts metadata attached to the record field itself", () => {
    // Validates that metadata on the outer record_field (not its children) is captured.
    const outerMeta = n("metadata_block", [n("tag_token", [], "required")]);
    const innerFd = n("field_decl", [fieldName("id"), n("type_expr", [], "INT")]);
    const recField = recordFieldDecl("address", { body: [innerFd], meta: outerMeta });
    const result = extractSchemas(schemaWith([recField]));
    assert.deepEqual(result[0].fields[0].metadata[0], { kind: "tag", tag: "required" });
  });
});

// ── extractFragments: empty case ────────────────────────────────────────────

// ── extractTransforms: name+row ─────────────────────────────────────────────

describe("extractTransforms — name and row (sl-cvs2)", () => {
  it("captures the transform name and the source row from the block_label", () => {
    // Validates that row is preserved verbatim (0-indexed) from the CST node — needed
    // by downstream tooling that converts to 1-indexed line numbers in user output.
    const block = n("transform_block", [blockLabel("normalize_phone")], "", 10);
    const root = n("source_file", [block]);
    const result = extractTransforms(root);
    assert.equal(result[0].name, "normalize_phone");
    assert.equal(result[0].row, 10);
  });
});

// ── Empty-input contract for every extractor ────────────────────────────────

describe("every extractor returns [] for an empty source_file (sl-cvs2)", () => {
  // Each extractor must return an empty array (not null or undefined) when given
  // a program with no relevant blocks, so callers can iterate safely without guards.
  const empty = () => n("source_file", []);
  for (const [name, fn] of [
    ["extractFragments", extractFragments],
    ["extractTransforms", extractTransforms],
    ["extractQuestions", extractQuestions],
    ["extractImports", extractImports],
  ]) {
    it(`${name} returns []`, () => {
      assert.deepEqual(fn(empty()), []);
    });
  }
});

// ── extractMappings: source/target collection rules ─────────────────────────

describe("extractMappings — source/target collection rules (sl-cvs2)", () => {
  function singleSrcTgtMapping(srcChildren, tgtChildren, name = "m") {
    const body = n("mapping_body", [
      n("source_block", srcChildren),
      n("target_block", tgtChildren),
    ]);
    const block = n("mapping_block", [blockLabel(name), body]);
    return n("source_file", [block]);
  }

  it("extracts a named mapping with backtick-quoted source and target", () => {
    // Validates the canonical case: a quoted mapping name and quoted refs at both ends.
    const srcEntry = sourceRef(n("backtick_name", [], "`legacy_sqlserver`"));
    const tgtEntry = sourceRef(n("backtick_name", [], "`postgres_db`"));
    const body = n("mapping_body", [n("source_block", [srcEntry]), n("target_block", [tgtEntry])]);
    const block = n("mapping_block", [blockLabel("'customer migration'"), body], "", 20);
    const root = n("source_file", [block]);
    assert.deepStrictEqual(extractMappings(root), [
      {
        name: "customer migration",
        namespace: null,
        sources: ["legacy_sqlserver"],
        targets: ["postgres_db"],
        arrowCount: 0,
        row: 20,
        startColumn: 0,
      },
    ]);
  });

  it("uses null for the name of an anonymous mapping", () => {
    // Validates the anonymous-mapping path: missing block_label → name === null.
    const body = n("mapping_body", [
      n("source_block", [sourceRef(ident("src"))]),
      n("target_block", [sourceRef(ident("tgt"))]),
    ]);
    const block = n("mapping_block", [body]);
    const root = n("source_file", [block]);
    assert.equal(extractMappings(root)[0].name, null);
  });

  it("counts every arrow node in the mapping body", () => {
    // Validates the arrowCount tally — distinguishes mappings with vs without arrow definitions.
    const body = n("mapping_body", [
      n("source_block", [sourceRef(ident("s"))]),
      n("target_block", [sourceRef(ident("t"))]),
      n("map_arrow", []),
      n("computed_arrow", []),
    ]);
    const block = n("mapping_block", [blockLabel("m"), body]);
    const root = n("source_file", [block]);
    assert.equal(extractMappings(root)[0].arrowCount, 2);
  });

  it("strips backticks from source and target names", () => {
    // Validates that quoted names are normalised before being added to the sources/targets arrays.
    const root = singleSrcTgtMapping(
      [sourceRef(n("backtick_name", [], "`my_source`"))],
      [sourceRef(n("backtick_name", [], "`my_target`"))],
    );
    const result = extractMappings(root);
    assert.deepEqual(result[0].sources, ["my_source"]);
    assert.deepEqual(result[0].targets, ["my_target"]);
  });

  it("excludes NL join descriptions from the sources array", () => {
    // Validates the rule that nl_string entries inside source_block are documentation,
    // not schema references — they must not appear in the sources array.
    const root = singleSrcTgtMapping(
      [
        sourceRef(n("backtick_name", [], "`crm_customers`")),
        sourceRef(n("backtick_name", [], "`order_transactions`")),
        sourceRef(n("nl_string", [], '"Join crm_customers to order_transactions on customer_id"')),
      ],
      [sourceRef(n("backtick_name", [], "`target_schema`"))],
    );
    assert.deepEqual(extractMappings(root)[0].sources, ["crm_customers", "order_transactions"]);
  });

  it("ignores filter metadata attached to a source entry", () => {
    // Validates that per-source filter annotations do not pollute the sources array
    // and that the underlying schema name is still captured cleanly.
    const meta = n("metadata_block", [], '(filter "status = active")');
    const root = singleSrcTgtMapping(
      [sourceRef(n("backtick_name", [], "`my_table`"), [meta])],
      [sourceRef(ident("tgt"))],
    );
    assert.deepEqual(extractMappings(root)[0].sources, ["my_table"]);
  });

  it("does not treat comment nodes inside source/target blocks as refs (sl-bi92)", () => {
    // Tree-sitter extras (line comments, warning comments) appear as named children
    // inside source/target blocks. They must be silently skipped — not turned into
    // schema references. Regression coverage for sl-bi92.
    const root = singleSrcTgtMapping(
      [
        n("comment", [], "// this is a comment"),
        sourceRef(ident("s")),
        n("warning_comment", [], "//! warning comment"),
      ],
      [sourceRef(ident("t"))],
    );
    const result = extractMappings(root);
    assert.deepEqual(result[0].sources, ["s"]);
    assert.deepEqual(result[0].targets, ["t"]);
  });
});

// ── extractMetrics: grain extraction ────────────────────────────────────────

describe("extractMetrics — grain extraction (sl-cvs2)", () => {
  it("extracts the grain key-value alongside the metric tag", () => {
    // Validates that a metric with grain=monthly produces both the metric flag
    // (via the tag) and a populated grain field — the two come from the same metadata block.
    const tag = n("tag_token", [ident("metric")], "metric");
    const kvVal = n("value_text", [ident("monthly")], "monthly");
    const kv = n("tag_with_value", [ident("grain"), kvVal]);
    const meta = n("metadata_block", [tag, kv]);
    const body = n("schema_body", [fieldDecl("value", "DECIMAL(14,2)")]);
    const block = n("schema_block", [blockLabel("mrr"), meta, body], "", 7);
    const root = n("source_file", [block]);
    assert.deepStrictEqual(extractMetrics(root), [
      {
        name: "mrr",
        namespace: null,
        displayName: null,
        sources: [],
        grain: "monthly",
        slices: [],
        fields: [{ name: "value", type: "DECIMAL(14,2)", startRow: 0, startColumn: 0 }],
        row: 7,
        startColumn: 0,
      },
    ]);
  });
});

// ── extractWarnings: text shape, nesting, prefix ────────────────────────────

describe("extractWarnings — text shape and nesting (sl-cvs2)", () => {
  it("captures warning_comment text and row from a top-level node", () => {
    // Validates that the //! prefix is stripped and the row is preserved.
    const w = n("warning_comment", [], "//! some records have NULL", 12);
    const root = n("source_file", [w]);
    const result = extractWarnings(root);
    assert.equal(result[0].text, "some records have NULL");
    assert.equal(result[0].row, 12);
  });

  it("finds warnings nested inside other CST nodes", () => {
    // Validates the recursive-walk behaviour: warnings inside schema/field nodes are still collected.
    const w = n("warning_comment", [], "//! nested warning", 5);
    const field = n("field_decl", [w]);
    const body = n("schema_body", [field]);
    const block = n("schema_block", [blockLabel("t"), body]);
    const root = n("source_file", [block]);
    assert.equal(extractWarnings(root).length, 1);
  });

  it("strips the //! prefix even when no space follows it", () => {
    // Validates that the prefix-stripping rule does not require a trailing space —
    // both '//! foo' and '//!foo' must yield 'foo'.
    const w = n("warning_comment", [], "//!no space after bang", 0);
    const root = n("source_file", [w]);
    assert.equal(extractWarnings(root)[0].text, "no space after bang");
  });
});

// ── extractQuestions: row and empty case ────────────────────────────────────

describe("extractQuestions — row and empty case (sl-cvs2)", () => {
  it("captures question_comment text and row", () => {
    // Validates that //? prefix is stripped and the row is preserved.
    const q = n("question_comment", [], "//? is this field PII?", 8);
    const root = n("source_file", [q]);
    const result = extractQuestions(root);
    assert.equal(result[0].text, "is this field PII?");
    assert.equal(result[0].row, 8);
  });

});

// ── extractNamespaces ───────────────────────────────────────────────────────

describe("extractNamespaces (sl-cvs2)", () => {
  it("extracts namespace name and row from a namespace_block", () => {
    // Validates the basic namespace extraction: name from the leading identifier, row from the block.
    const ns = namespaceBlock("pos", { row: 5 });
    const root = n("source_file", [ns]);
    const result = extractNamespaces(root);
    assert.equal(result[0].name, "pos");
    assert.equal(result[0].row, 5);
    assert.equal(result[0].note, null);
  });

  it("extracts the namespace note from its metadata block", () => {
    // Validates that note_tag inside the namespace's metadata becomes the note field.
    const noteTag = n("note_tag", [nlString("POS system")]);
    const meta = n("metadata_block", [noteTag]);
    const ns = namespaceBlock("pos", { meta });
    const root = n("source_file", [ns]);
    assert.equal(extractNamespaces(root)[0].note, "POS system");
  });

  it("extracts every namespace_block at the program root", () => {
    // Validates that multiple top-level namespaces are all collected.
    const root = n("source_file", [namespaceBlock("pos"), namespaceBlock("ecom")]);
    assert.equal(extractNamespaces(root).length, 2);
  });
});

// ── extractSchemas with namespaces ──────────────────────────────────────────

describe("extractSchemas — namespace propagation (sl-cvs2)", () => {
  it("sets namespace=null for top-level schemas", () => {
    // Validates that schemas outside any namespace_block carry an explicit null
    // (not undefined) so consumers can rely on the field being present.
    const body = n("schema_body", [fieldDecl("id", "INT")]);
    const block = n("schema_block", [blockLabel("orders"), body]);
    const root = n("source_file", [block]);
    assert.equal(extractSchemas(root)[0].namespace, null);
  });

  it("propagates the namespace name to schemas defined inside a namespace_block", () => {
    // Validates that the recursive walker passes the parent namespace name down to children.
    const body = n("schema_body", [fieldDecl("STORE_ID", "VARCHAR(20)")]);
    const schemaNode = n("schema_block", [blockLabel("stores"), body], "", 3);
    const ns = namespaceBlock("pos", { children: [schemaNode] });
    const root = n("source_file", [ns]);
    const result = extractSchemas(root);
    assert.equal(result[0].name, "stores");
    assert.equal(result[0].namespace, "pos");
  });

  it("collects both global and namespaced schemas in document order", () => {
    // Validates that mixing top-level and namespaced schemas in one file
    // produces both kinds in their declared order, each with the right namespace value.
    const globalSchema = n("schema_block", [blockLabel("dim_date"), n("schema_body", [])]);
    const nsSchema = n("schema_block", [blockLabel("stores"), n("schema_body", [])], "", 5);
    const ns = namespaceBlock("pos", { children: [nsSchema] });
    const root = n("source_file", [globalSchema, ns]);
    const result = extractSchemas(root);
    assert.equal(result.length, 2);
    assert.equal(result[0].namespace, null);
    assert.equal(result[1].namespace, "pos");
  });
});

// ── extractMappings with namespaces ─────────────────────────────────────────

describe("extractMappings — namespaced mapping with qualified ref (sl-cvs2)", () => {
  it("preserves a fully-qualified source ref and qualifies the bare target ref", () => {
    // Validates the namespace-resolution rule: an explicit ns::name source ref keeps its
    // qualifier verbatim, while an unqualified target inside a namespaced mapping
    // is auto-qualified with the enclosing namespace.
    const qualName = n("qualified_name", [ident("pos"), ident("stores")], "pos::stores");
    const srcEntry = sourceRef(qualName);
    const tgtEntry = sourceRef(ident("hub_store"));
    const body = n("mapping_body", [n("source_block", [srcEntry]), n("target_block", [tgtEntry])]);
    const block = n("mapping_block", [blockLabel("load"), body], "", 10);
    const ns = namespaceBlock("vault", { children: [block] });
    const root = n("source_file", [ns]);
    const result = extractMappings(root);
    assert.equal(result[0].namespace, "vault");
    assert.deepEqual(result[0].sources, ["pos::stores"]);
    assert.deepEqual(result[0].targets, ["vault::hub_store"]);
  });
});

// ── extractFragments with namespaces ────────────────────────────────────────

describe("extractFragments — namespace propagation (sl-cvs2)", () => {
  it("attaches the enclosing namespace name to fragments declared inside it", () => {
    // Validates that fragment_blocks inside a namespace_block inherit the namespace.
    const body = n("schema_body", [fieldDecl("load_ts", "TIMESTAMP")]);
    const frag = n("fragment_block", [blockLabel("audit_cols"), body], "", 2);
    const ns = namespaceBlock("shared", { children: [frag] });
    const root = n("source_file", [ns]);
    const result = extractFragments(root);
    assert.equal(result[0].namespace, "shared");
  });
});

// ── extractImports: name forms and arity ────────────────────────────────────

describe("extractImports — name forms and arity (sl-cvs2)", () => {
  function qualifiedName(ns, name) {
    // qualified_name node — represents `ns::name` in the import list
    return n("qualified_name", [ident(ns), ident(name)], `${ns}::${name}`);
  }

  it("extracts a single bare-identifier import", () => {
    // Validates the simplest import form: a single unqualified name.
    const imp = n("import_decl", [
      n("import_name", [ident("address_fields")]),
      n("import_path", [nlString("common.stm")]),
    ]);
    const root = n("source_file", [imp]);
    const result = extractImports(root);
    assert.deepEqual(result[0].names, ["address_fields"]);
    assert.equal(result[0].path, "common.stm");
  });

  it("extracts multiple ns::name qualified imports from one declaration", () => {
    // Validates that multiple qualified names in a single import_decl are collected in order.
    const imp = n("import_decl", [
      n("import_name", [qualifiedName("src", "customers")]),
      n("import_name", [qualifiedName("mart", "dim_customers")]),
      n("import_path", [nlString("source.stm")]),
    ], "", 2);
    const root = n("source_file", [imp]);
    const result = extractImports(root);
    assert.deepEqual(result[0].names, ["src::customers", "mart::dim_customers"]);
    assert.equal(result[0].row, 2);
  });

  it("strips backticks from quoted import names", () => {
    // Validates that backtick-quoted multi-word names are normalised in the names array.
    const imp = n("import_decl", [
      n("import_name", [backtickName("address fields")]),
      n("import_name", [backtickName("audit fields")]),
      n("import_path", [nlString("lib/common.stm")]),
    ]);
    const root = n("source_file", [imp]);
    const result = extractImports(root);
    assert.deepEqual(result[0].names, ["address fields", "audit fields"]);
  });

  it("returns one entry per import_decl when multiple declarations are present", () => {
    // Validates that distinct import_decls produce distinct entries (not merged).
    const imp1 = n("import_decl", [
      n("import_name", [ident("foo")]),
      n("import_path", [nlString("a.stm")]),
    ], "", 0);
    const imp2 = n("import_decl", [
      n("import_name", [ident("bar")]),
      n("import_path", [nlString("b.stm")]),
    ], "", 1);
    const root = n("source_file", [imp1, imp2]);
    const result = extractImports(root);
    assert.equal(result.length, 2);
    assert.equal(result[0].path, "a.stm");
    assert.equal(result[1].path, "b.stm");
  });

});

// ── extractImports: MISSING-name recovery (sl-0nvt) ─────────────────────────

describe("extractImports — zero-width MISSING recovery (sl-0nvt)", () => {
  it("yields no names (not ['']) for an import_name holding a MISSING identifier", () => {
    // `import { } from "x"` recovers as an import_name containing a
    // zero-width MISSING identifier; the empty string must not leak out.
    const missing = { ...n("identifier", [], ""), isMissing: true };
    const root = n("source_file", [
      n("import_decl", [
        n("import_name", [missing], ""),
        n("import_path", [n("nl_string", [], '"crm/pipeline.stm"')], '"crm/pipeline.stm"'),
      ]),
    ]);
    const result = extractImports(root);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].names, []);
    assert.equal(result[0].path, "crm/pipeline.stm");
  });
});

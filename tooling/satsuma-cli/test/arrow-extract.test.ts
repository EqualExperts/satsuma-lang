/**
 * arrow-extract.test.js — Unit tests for extractArrowRecords in src/extract.js
 *
 * Tests use lightweight mock CST nodes. For integration tests against real
 * example files, see integration.test.js.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { extractArrowRecords } from "@satsuma/core";
import { type MockNode, mockNode as n } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../examples");

// ── Mock helpers ─────────────────────────────────────────────────────────────

function ident(text: string): MockNode {
  return n("identifier", [], text);
}

function blockLabel(name: string): MockNode {
  const inner = name.startsWith("'") ? n("backtick_name", [], name) : n("identifier", [], name);
  return n("block_label", [inner]);
}

function fieldPath(name: string): MockNode {
  return n("field_path", [ident(name)], name);
}

function namespacedPath(ns: string, schema: string, field: string | null): MockNode {
  const ids = [ident(ns), ident(schema)];
  if (field) ids.push(ident(field));
  const text = field ? `${ns}::${schema}.${field}` : `${ns}::${schema}`;
  return n("namespaced_path", ids, text);
}

function srcPath(name: string): MockNode {
  return n("src_path", [fieldPath(name)], name);
}

function srcPathNs(ns: string, schema: string, field: string | null): MockNode {
  const inner = namespacedPath(ns, schema, field);
  return n("src_path", [inner], inner.text);
}

function tgtPath(name: string): MockNode {
  return n("tgt_path", [fieldPath(name)], name);
}

function pipeStep(innerType: string, text = ""): MockNode {
  if (innerType === "pipe_text" && (text.startsWith('"') || text.startsWith('"""'))) {
    // NL pipe text — wrap nl_string inside pipe_text
    const strType = text.startsWith('"""') ? "multiline_string" : "nl_string";
    const inner = n("pipe_text", [n(strType, [], text)], text);
    return n("pipe_step", [inner], text);
  }
  return n("pipe_step", [n(innerType, [n("identifier", [], text)], text)], text);
}

function pipeChain(steps: MockNode[]): MockNode {
  return n("pipe_chain", steps, steps.map((s) => s.text).join(" | "));
}

function mapArrow(src: string, tgt: string, steps: MockNode[] = [], row = 0): MockNode {
  const children: MockNode[] = [srcPath(src), tgtPath(tgt)];
  if (steps.length > 0) children.push(pipeChain(steps));
  return n("map_arrow", children, "", row);
}

function computedArrow(tgt: string, steps: MockNode[] = [], row = 0): MockNode {
  const children: MockNode[] = [tgtPath(tgt)];
  if (steps.length > 0) children.push(pipeChain(steps));
  return n("computed_arrow", children, "", row);
}

function mappingBlock(name: string, arrows: MockNode[], row = 0): MockNode {
  const srcBlock = n("source_block", [ident("src_schema")]);
  const tgtBlock = n("target_block", [ident("tgt_schema")]);
  const body = n("mapping_body", [srcBlock, tgtBlock, ...arrows]);
  return n("mapping_block", [blockLabel(name), body], "", row);
}

// ── extractArrowRecords ──────────────────────────────────────────────────────

describe("extractArrowRecords", () => {
  it("extracts a bare arrow (no transform)", () => {
    const arrow = mapArrow("CUST_ID", "legacy_id", [], 10);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.equal(records[0].mapping, "m1");
    assert.equal(records[0].sources[0], "CUST_ID");
    assert.equal(records[0].target, "legacy_id");
    assert.equal(records[0].classification, "none");
    assert.equal(records[0].derived, false);
    assert.equal(records[0].transform_raw, "");
    assert.deepEqual(records[0].steps, []);
    assert.equal(records[0].line, 10);
  });

  it("extracts an NL arrow with bare identifier steps", () => {
    const steps = [pipeStep("pipe_text", "trim"), pipeStep("pipe_text", "lowercase")];
    const arrow = mapArrow("EMAIL", "email", steps, 20);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.equal(records[0].classification, "nl");
    assert.equal(records[0].transform_raw, "trim | lowercase");
    assert.deepEqual(records[0].steps, [
      { type: "pipe_text", text: "trim" },
      { type: "pipe_text", text: "lowercase" },
    ]);
  });

  it("extracts an NL arrow", () => {
    const steps = [pipeStep("pipe_text", '"Do something complex"')];
    const arrow = mapArrow("PHONE", "phone", steps, 30);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records[0].classification, "nl");
    assert.equal(records[0].transform_raw, '"Do something complex"');
  });

  it("extracts an NL arrow with bare + quoted steps", () => {
    const steps = [
      pipeStep("pipe_text", '"Filter profanity"'),
      pipeStep("pipe_text", "escape_html"),
    ];
    const arrow = mapArrow("NOTES", "notes", steps, 40);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records[0].classification, "nl");
    assert.deepEqual(records[0].steps, [
      { type: "pipe_text", text: '"Filter profanity"' },
      { type: "pipe_text", text: "escape_html" },
    ]);
  });

  it("extracts a computed (derived) arrow", () => {
    const steps = [pipeStep("pipe_text", "now_utc()")];
    const arrow = computedArrow("migration_ts", steps, 50);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].sources, []);
    assert.equal(records[0].target, "migration_ts");
    assert.equal(records[0].derived, true);
    assert.equal(records[0].classification, "nl");
  });

  it("extracts arrows from multiple mappings", () => {
    const a1 = mapArrow("A", "a", [], 10);
    const a2 = mapArrow("B", "b", [], 20);
    const m1 = mappingBlock("m1", [a1]);
    const m2 = mappingBlock("m2", [a2]);
    const root = n("source_file", [m1, m2]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 2);
    assert.equal(records[0].mapping, "m1");
    assert.equal(records[1].mapping, "m2");
  });

  it("extracts a map_literal arrow as NL", () => {
    const steps = [pipeStep("map_literal", 'map { R: "retail" }')];
    const arrow = mapArrow("TYPE", "type", steps, 60);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records[0].classification, "nl");
  });

  it("returns empty array when no mappings", () => {
    const root = n("source_file", []);
    assert.deepEqual(extractArrowRecords(root as any), []);
  });

  it("handles mapping with no body", () => {
    const mapping = n("mapping_block", [blockLabel("empty")]);
    const root = n("source_file", [mapping]);
    assert.deepEqual(extractArrowRecords(root as any), []);
  });

  it("extracts nested_arrow source and target", () => {
    const innerArrow = mapArrow("EBELP", "referenceLine", [], 15);
    const nested = n("nested_arrow", [srcPath("Items"), tgtPath("items"), innerArrow], "", 14);
    const mapping = mappingBlock("m1", [nested]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    // Should include the nested_arrow itself and the inner map_arrow
    const nestedRecord = records.find((r) => r.target === "items");
    assert.ok(nestedRecord, "should extract nested_arrow target");
    assert.equal(nestedRecord.sources[0], "Items");
    assert.equal(nestedRecord.line, 14);
  });

  it("extracts multiple sources from multi-source arrow", () => {
    const arrow = n(
      "map_arrow",
      [srcPath("first_name"), srcPath("last_name"), tgtPath("full_name")],
      "",
      40,
    );
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].sources, ["first_name", "last_name"]);
    assert.equal(records[0].target, "full_name");
  });

  it("extracts three sources from multi-source arrow", () => {
    const arrow = n(
      "map_arrow",
      [srcPath("city"), srcPath("state"), srcPath("zip"), tgtPath("address")],
      "",
      41,
    );
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].sources, ["city", "state", "zip"]);
  });

  it("single-source arrow produces length-1 sources array", () => {
    const arrow = mapArrow("CUST_ID", "legacy_id", [], 42);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].sources, ["CUST_ID"]);
  });

  it("produces canonical form for namespaced source paths", () => {
    const arrow = n(
      "map_arrow",
      [srcPathNs("crm", "customers", "email"), tgtPath("email_addr")],
      "",
      30,
    );
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.equal(records[0].sources[0], "crm::customers.email");
  });

  it("produces canonical form for namespaced source without field", () => {
    const arrow = n("map_arrow", [srcPathNs("billing", "invoices", null), tgtPath("out")], "", 31);
    const mapping = mappingBlock("m1", [arrow]);
    const root = n("source_file", [mapping]);

    const records = extractArrowRecords(root as any);
    assert.equal(records.length, 1);
    assert.equal(records[0].sources[0], "billing::invoices");
  });
});

// ── Integration with real example files ──────────────────────────────────────

describe("extractArrowRecords against real examples", () => {
  let parseFile: (filePath: string) => { tree: { rootNode: any }; [k: string]: any };

  before(async () => {
    const parser = await import("#src/parser.js");
    parseFile = parser.parseFile;
  });

  it("extracts all arrows from db-to-db.stm", () => {
    const { tree } = parseFile(resolve(EXAMPLES, "db-to-db/pipeline.stm"));
    const records = extractArrowRecords(tree.rootNode);

    // db-to-db.stm has 16 map_arrows + 3 computed_arrows = 19
    assert.equal(records.length, 19);

    // All belong to 'customer migration' mapping
    for (const r of records) {
      assert.equal(r.mapping, "customer migration");
    }

    // Check an NL arrow with bare identifier steps
    const trimArrow = records.find((r) => r.sources[0] === "FIRST_NM" && r.target === "first_name");
    assert.ok(trimArrow, "should find FIRST_NM -> first_name");
    assert.equal(trimArrow.classification, "nl");
    assert.equal(trimArrow.derived, false);
    assert.equal(trimArrow.steps.length, 3);

    // Check an NL arrow with bare + quoted steps
    const phoneArrow = records.find((r) => r.sources[0] === "PHONE_NBR");
    assert.ok(phoneArrow);
    assert.equal(phoneArrow.classification, "nl");

    // Check an NL arrow with quoted text
    const notesArrow = records.find((r) => r.sources[0] === "NOTES" && r.target === "notes");
    assert.ok(notesArrow);
    assert.equal(notesArrow.classification, "nl");

    // Check a bare arrow (no transform)
    const bareArrow = records.find((r) => r.target === "legacy_customer_id");
    assert.ok(bareArrow);
    assert.equal(bareArrow.classification, "none");

    // Check a derived arrow
    const derivedArrow = records.find((r) => r.target === "display_name");
    assert.ok(derivedArrow);
    assert.equal(derivedArrow.derived, true);
  });

  it("extracts nested bare arrows without target contamination (sl-9uh0)", () => {
    const { tree } = parseFile(resolve(EXAMPLES, "sap-po-to-mfcs/pipeline.stm"));
    const records = extractArrowRecords(tree.rootNode);

    // Find child arrows of the each Items -> items block
    const childArrows = records.filter(
      (r) => r.sources.length > 0 && r.sources[0].startsWith("Items."),
    );
    assert.ok(childArrows.length >= 7, `expected >=7 child arrows, got ${childArrows.length}`);

    // Each child arrow should have a clean source (no newlines, no target contamination)
    for (const a of childArrows) {
      assert.ok(!a.sources[0].includes("\n"), `source should not contain newline: ${a.sources[0]}`);
      assert.ok(!a.target!.includes("\n"), `target should not contain newline: ${a.target}`);
      assert.equal(a.derived, false, `${a.sources[0]} should not be derived`);
    }

    // Specifically check the last arrow (.TXZ01 -> .description) which was previously broken
    const txz01 = childArrows.find((r) => r.sources[0] === "Items.TXZ01");
    assert.ok(txz01, "should find Items.TXZ01 arrow");
    assert.equal(txz01.target, "items.description");
    assert.equal(txz01.derived, false);
  });

  it("extracts arrows from multi-source-hub.stm", () => {
    const { tree } = parseFile(resolve(EXAMPLES, "multi-source/multi-source-hub.stm"));
    const records = extractArrowRecords(tree.rootNode);
    assert.ok(records.length > 0, "should have arrows");

    // All records should have mapping names
    for (const r of records) {
      assert.ok(r.mapping !== undefined);
    }
  });

  it("extracts leaf arrows from hierarchical mapping with flatten/each (cbh-zdk3)", () => {
    // extractArrowRecords returns one record per leaf arrow (map_arrow,
    // computed_arrow, nested_arrow). Flatten/each containers are not
    // themselves arrows — they wrap child arrows.
    const { tree } = parseFile(
      resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm"),
    );
    const records = extractArrowRecords(tree.rootNode);
    const mapping = records.filter((r) => r.mapping === "order line facts");
    // 3 outer map arrows + 5 flatten children + 1 nested container + 3 computed = 12
    assert.equal(mapping.length, 12, "should extract 12 leaf arrows from hierarchical mapping");
  });
});

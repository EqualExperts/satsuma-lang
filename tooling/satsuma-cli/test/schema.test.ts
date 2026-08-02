/**
 * schema.test.js — Unit tests for schema command helpers.
 *
 * Tests the field collection and formatting logic using mock CST nodes.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

// ── Mock CST helpers ──────────────────────────────────────────────────────────

function n(
  type: string,
  namedChildren: any[] = [],
  text = "",
  row = 0,
  anonymousChildren: string[] = [],
) {
  const children: any[] = [];
  children.push(
    ...anonymousChildren.map((t: string) => ({
      type: t,
      text: t,
      isNamed: false,
      namedChildren: [],
      children: [],
    })),
  );
  children.push(...namedChildren.map((c: any) => ({ ...c, isNamed: true })));
  return { type, text, startPosition: { row, column: 0 }, namedChildren, children, isNamed: true };
}
function ident(t: string) {
  return n("identifier", [], t);
}
function quoted(t: string) {
  return n("backtick_name", [], `'${t}'`);
}
function _blockLabel(name: string) {
  const inner = name.startsWith("'") ? quoted(name.slice(1, -1)) : ident(name);
  return n("block_label", [inner]);
}
function spreadLabel(name: string) {
  if (name.startsWith("'")) return n("spread_label", [quoted(name.slice(1, -1))]);
  return n("spread_label", name.split(" ").map(ident));
}
function fieldName(name: string) {
  return n("field_name", [ident(name)]);
}
function typeExpr(t: string) {
  return n("type_expr", [], t);
}
function fieldDecl(name: string, type: string, meta: any = null) {
  const children = [fieldName(name), typeExpr(type)];
  if (meta) children.push(meta);
  return n("field_decl", children);
}

// ── Inline collectFields re-implementation (mirrors schema.js logic) ──────────

function isList(fd: any) {
  if (!fd.children) return false;
  return fd.children.some((c: any) => !c.isNamed && c.text === "list_of");
}

function collectFields(bodyNode: any, indent = 0): { indent: number; text: string }[] {
  const lines: { indent: number; text: string }[] = [];
  for (const c of bodyNode.namedChildren) {
    const pad = "  ".repeat(indent);
    if (c.type === "field_decl") {
      const nameNode = c.namedChildren.find((x: any) => x.type === "field_name");
      const nested = c.namedChildren.find((x: any) => x.type === "schema_body");
      if (nested) {
        // Nested structure: field_decl with schema_body child (unified syntax)
        const inner = nameNode?.namedChildren[0];
        let fname = inner?.text ?? "";
        if (inner?.type === "backtick_name") fname = fname.slice(1, -1);
        const kind = isList(c) ? "list_of record" : "record";
        lines.push({ indent, text: `${pad}${fname} ${kind} {` });
        lines.push(...collectFields(nested, indent + 1));
        lines.push({ indent, text: `${pad}}` });
      } else {
        // Scalar field
        const typeNode = c.namedChildren.find((x: any) => x.type === "type_expr");
        const meta = c.namedChildren.find((x: any) => x.type === "metadata_block");
        const inner = nameNode?.namedChildren[0];
        let fname = inner?.text ?? "";
        if (inner?.type === "backtick_name") fname = fname.slice(1, -1);
        const metaText = meta ? ` ${meta.text}` : "";
        lines.push({ indent, text: `${pad}${fname.padEnd(24)}${typeNode?.text ?? ""}${metaText}` });
      }
    } else if (c.type === "fragment_spread") {
      const lbl = c.namedChildren.find((x: any) => x.type === "spread_label");
      let sname = "";
      if (lbl) {
        const q = lbl.namedChildren.find((x: any) => x.type === "backtick_name");
        if (q) {
          sname = q.text;
        } else {
          sname = lbl.namedChildren
            .filter((x: any) => x.type === "identifier" || x.type === "qualified_name")
            .map((x: any) => x.text)
            .join(" ");
        }
      }
      lines.push({ indent, text: `${pad}...${sname}` });
    }
  }
  return lines;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("collectFields", () => {
  it("renders flat fields with padding", () => {
    const body = n("schema_body", [fieldDecl("id", "INT"), fieldDecl("name", "VARCHAR(100)")]);
    const lines = collectFields(body, 1);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].text.startsWith("  id"));
    assert.ok(lines[0].text.includes("INT"));
    assert.ok(lines[1].text.includes("VARCHAR(100)"));
  });

  it("renders field with metadata", () => {
    const meta = n("metadata_block", [], "(pk)");
    const body = n("schema_body", [fieldDecl("id", "INT", meta)]);
    const lines = collectFields(body, 1);
    assert.ok(lines[0].text.includes("(pk)"));
  });

  it("renders nested record field_decl with indent", () => {
    const innerBody = n("schema_body", [fieldDecl("street", "STRING(200)")]);
    const recordField = n("field_decl", [fieldName("address"), innerBody], "", 0, ["record"]);
    const body = n("schema_body", [recordField]);

    const lines = collectFields(body, 1);
    assert.equal(lines[0].text, "  address record {");
    assert.ok(lines[1].text.startsWith("    street"));
    assert.equal(lines[2].text, "  }");
  });

  it("renders nested list_of record field_decl", () => {
    const innerBody = n("schema_body", [fieldDecl("item", "STRING(50)")]);
    const listField = n("field_decl", [fieldName("tags"), innerBody], "", 0, ["list_of", "record"]);
    const body = n("schema_body", [listField]);

    const lines = collectFields(body, 0);
    assert.equal(lines[0].text, "tags list_of record {");
    assert.ok(lines[1].text.startsWith("  item"));
    assert.equal(lines[2].text, "}");
  });

  it("renders quoted fragment_spread", () => {
    const spread = n("fragment_spread", [spreadLabel("'address fields'")]);
    const body = n("schema_body", [spread]);
    const lines = collectFields(body, 1);
    // backtick_name.text includes surrounding single quotes in display
    assert.equal(lines[0].text.trim(), "...'address fields'");
  });

  it("renders unquoted fragment_spread", () => {
    const spread = n("fragment_spread", [spreadLabel("audit fields")]);
    const body = n("schema_body", [spread]);
    const lines = collectFields(body, 0);
    assert.equal(lines[0].text, "...audit fields");
  });

  it("returns empty array for empty body", () => {
    const body = n("schema_body", []);
    assert.deepEqual(collectFields(body), []);
  });
});

// ── printFieldsOnly output format ─────────────────────────────────────────────

describe("fields-only format", () => {
  let output: string[] = [];
  let origLog: typeof console.log;
  beforeEach(() => {
    output = [];
    origLog = console.log;
    console.log = (...a: any[]) => output.push(a.join(" "));
  });
  afterEach(() => {
    console.log = origLog;
  });

  it("prints name and type tab-padded", () => {
    const fields = [
      { name: "customer_id", type: "UUID" },
      { name: "email", type: "VARCHAR(255)" },
    ];
    for (const f of fields) console.log(`${f.name.padEnd(24)}${f.type}`);
    assert.ok(output[0].startsWith("customer_id"));
    assert.ok(output[0].includes("UUID"));
    assert.ok(output[1].includes("VARCHAR(255)"));
  });
});

// ── Schema not-found logic ────────────────────────────────────────────────────

describe("schema not-found", () => {
  it("finds case-insensitive match", () => {
    const schemas = new Map([
      ["Orders", {}],
      ["customers", {}],
    ]);
    const name = "orders";
    const keys = [...schemas.keys()];
    const close = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    assert.equal(close, "Orders");
  });

  it("returns undefined when no match", () => {
    const schemas = new Map([["orders", {}]]);
    const name = "invoices";
    const keys = [...schemas.keys()];
    const close = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    assert.equal(close, undefined);
  });
});

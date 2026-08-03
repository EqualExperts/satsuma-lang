/**
 * field-decl.test.js — Runtime boundaries for the strict FieldDecl union.
 *
 * Compile-only tests own assignability invariants. These cases prove dynamic
 * protocol strings are validated and normalized without changing JSON shapes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNever,
  classifyFieldDecl,
  createScalarTypeExpression,
  fieldDeclFromRenderedType,
  renderFieldDeclType,
} from "../dist/index.js";

describe("FieldDecl runtime boundaries", () => {
  it("normalizes all four rendered shapes into the established JSON properties", () => {
    // The LSP and viz protocols keep their rendered list spelling, while core
    // retains the historic separate isList marker and record body.
    const scalar = fieldDeclFromRenderedType({ name: "id", type: "UUID" });
    const record = fieldDeclFromRenderedType({ name: "address", type: "record", children: [] });
    const scalarList = fieldDeclFromRenderedType({ name: "tags", type: "list_of STRING" });
    const recordList = fieldDeclFromRenderedType({
      name: "items",
      type: "list_of record",
      children: [],
    });

    assert.deepEqual(JSON.parse(JSON.stringify([scalar, record, scalarList, recordList])), [
      { name: "id", type: "UUID" },
      { name: "address", type: "record", children: [] },
      { name: "tags", type: "STRING", isList: true },
      { name: "items", type: "record", children: [], isList: true },
    ]);
    assert.deepEqual(
      [scalar, record, scalarList, recordList].map(classifyFieldDecl).map(({ kind }) => kind),
      ["scalar", "record", "scalar-list", "record-list"],
    );
    assert.deepEqual([scalar, record, scalarList, recordList].map(renderFieldDeclType), [
      "UUID",
      "record",
      "list_of STRING",
      "list_of record",
    ]);
  });

  it("rejects dynamic values that would manufacture an invalid scalar variant", () => {
    // Static literals are covered by type-tests; runtime checks protect strings
    // arriving through JSON and protocol models.
    const dynamicRecordType = ["rec", "ord"].join("");
    assert.throws(() => createScalarTypeExpression(dynamicRecordType), /reserved 'record' keyword/);
    assert.throws(
      () =>
        fieldDeclFromRenderedType({
          name: "invalid",
          type: "STRING",
          children: [fieldDeclFromRenderedType({ name: "child", type: "INT" })],
        }),
      /cannot carry a record body/,
    );
  });

  it("assertNever fails loud if malformed boundary data reaches an exhaustive consumer", () => {
    // The helper is a runtime backstop as well as a compile-time exhaustiveness
    // marker, so corrupted untyped input reports the consumer context.
    assert.throws(
      () => assertNever("future-variant", "Unhandled FieldDecl variant"),
      /Unhandled FieldDecl variant: future-variant/,
    );
  });
});

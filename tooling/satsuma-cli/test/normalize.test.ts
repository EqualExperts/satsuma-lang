/**
 * normalize.test.js — Unit tests for src/normalize.js
 *
 * Tests the CLI-level field-matching logic (matchFields).
 * normalizeName is tested in satsuma-core/test/string-utils.test.js — its
 * behaviour is not re-tested here to avoid duplication.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldDeclFromRenderedType } from "@satsuma/core";
import type { FieldDecl } from "@satsuma/core";
import { matchFields } from "#src/normalize.js";

/** Build strict core fixtures while these tests stay focused on CLI matching. */
function field(name: string, type: string, children?: FieldDecl[]): FieldDecl {
  return fieldDeclFromRenderedType({ name, type, ...(children ? { children } : {}) });
}

describe("matchFields", () => {
  it("matches fields by normalized name", () => {
    // Verifies the full matching pipeline: normalization + lookup + result shape.
    const src = [field("FirstName", "VARCHAR")];
    const tgt = [field("first_name", "VARCHAR")];
    const result = matchFields(src, tgt);
    assert.equal(result.matched.length, 1);
    assert.equal(result.matched[0].source, "FirstName");
    assert.equal(result.matched[0].target, "first_name");
    assert.equal(result.matched[0].normalized, "firstname");
  });

  it("returns source-only and target-only correctly", () => {
    // Ensures unmatched fields on each side are correctly categorised.
    const src = [field("id", "INT"), field("email", "VARCHAR")];
    const tgt = [field("email", "VARCHAR"), field("phone", "VARCHAR")];
    const result = matchFields(src, tgt);
    assert.equal(result.matched.length, 1);
    assert.deepEqual(result.sourceOnly, ["id"]);
    assert.deepEqual(result.targetOnly, ["phone"]);
  });

  it("handles empty fields", () => {
    const result = matchFields([], []);
    assert.equal(result.matched.length, 0);
    assert.equal(result.sourceOnly.length, 0);
    assert.equal(result.targetOnly.length, 0);
  });

  it("flattens nested fields into dotted paths for matching", () => {
    // Nested source "address.city" should match flat target "city" by leaf name.
    const src = [field("address", "record", [field("city", "VARCHAR")])];
    const tgt = [field("city", "VARCHAR")];
    const result = matchFields(src, tgt);
    assert.ok(
      result.matched.some((m) => m.source === "address.city" && m.target === "city"),
      "should match nested source address.city to flat target city",
    );
  });

  it("matches cross-level: flat source matches nested target by leaf name", () => {
    // Flat source "city" should match nested target "address.city" by leaf.
    const src = [field("city", "VARCHAR")];
    const tgt = [field("address", "record", [field("city", "VARCHAR")])];
    const result = matchFields(src, tgt);
    assert.ok(
      result.matched.some((m) => m.source === "city"),
      "should match flat source city to nested target",
    );
  });

  it("uses first-wins when two target fields normalize identically", () => {
    // Both "first_name" and "firstName" normalize to "firstname".
    // The first one in the target list should win.
    const src = [field("FIRST_NAME", "VARCHAR")];
    const tgt = [field("first_name", "VARCHAR"), field("firstName", "VARCHAR")];
    const result = matchFields(src, tgt);
    assert.equal(result.matched.length, 1);
    assert.equal(result.matched[0].target, "first_name", "first occurrence wins");
  });

  it("deeply nested fields are flattened correctly", () => {
    // Two levels of nesting: address.billing.zip
    const src = [
      field("address", "record", [field("billing", "record", [field("zip", "VARCHAR")])]),
    ];
    const tgt = [field("zip", "VARCHAR")];
    const result = matchFields(src, tgt);
    assert.ok(
      result.matched.some((m) => m.source === "address.billing.zip"),
      "should flatten and match deeply nested field",
    );
  });

  it("parent record names appear as both container and matchable fields", () => {
    // "address" itself is a field, plus its child "city" is also a field.
    const src = [field("address", "record", [field("city", "VARCHAR")])];
    const tgt = [field("address", "record", []), field("city", "VARCHAR")];
    const result = matchFields(src, tgt);
    assert.ok(
      result.matched.some((m) => m.source === "address" && m.target === "address"),
      "parent record name should match",
    );
    assert.ok(
      result.matched.some((m) => m.source === "address.city"),
      "child field should also match",
    );
  });
});

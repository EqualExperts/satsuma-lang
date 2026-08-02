/**
 * spread-expand.test.js — Unit tests for satsuma-core spread-expand module
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectFieldPaths,
  expandEntityFields,
  expandNestedSpreads,
  makeEntityRefResolver,
} from "../dist/spread-expand.js";

function field(name, type = "STRING", children) {
  const f = { name, type };
  if (children) f.children = children;
  return f;
}

function fragment(name, fields, spreads = []) {
  return { name, fields, hasSpreads: spreads.length > 0, spreads };
}

// ── collectFieldPaths ─────────────────────────────────────────────────────────

describe("collectFieldPaths()", () => {
  it("collects flat fields", () => {
    const paths = new Set();
    collectFieldPaths([field("id"), field("name")], "", paths);
    assert.deepEqual([...paths].sort(), ["id", "name"]);
  });

  it("collects nested fields with dotted paths", () => {
    const paths = new Set();
    collectFieldPaths([field("address", "record", [field("city"), field("zip")])], "", paths);
    assert.deepEqual([...paths].sort(), ["address", "address.city", "address.zip"]);
  });
});

// ── makeEntityRefResolver ─────────────────────────────────────────────────────

describe("makeEntityRefResolver()", () => {
  it("resolves unqualified refs in the global map", () => {
    const map = new Map([["::customers", {}]]);
    const resolve = makeEntityRefResolver(map);
    assert.equal(resolve("::customers", null), "::customers");
  });

  it("resolves qualified refs", () => {
    const map = new Map([["crm::customers", {}]]);
    const resolve = makeEntityRefResolver(map);
    assert.equal(resolve("crm::customers", null), "crm::customers");
  });

  it("resolves ns-scoped refs when currentNs is provided", () => {
    const map = new Map([["crm::audit_fields", {}]]);
    const resolve = makeEntityRefResolver(map);
    assert.equal(resolve("audit_fields", "crm"), "crm::audit_fields");
  });

  it("returns null when ref not found", () => {
    const map = new Map();
    const resolve = makeEntityRefResolver(map);
    assert.equal(resolve("missing", null), null);
  });
});

// ── expandEntityFields ────────────────────────────────────────────────────────

describe("expandEntityFields()", () => {
  it("returns empty array for entity with no spreads", () => {
    const entity = { fields: [field("id")], hasSpreads: false };
    const resolve = (ref, _ns) => ref;
    const lookup = () => null;
    assert.deepEqual(expandEntityFields(entity, null, resolve, lookup), []);
  });

  it("expands a single fragment spread", () => {
    const frag = fragment("::audit_fields", [field("created_at"), field("updated_at")]);
    const entity = { fields: [field("id")], hasSpreads: true, spreads: ["::audit_fields"] };
    const resolve = (ref) => ref;
    const lookup = (key) => (key === "::audit_fields" ? frag : null);

    const result = expandEntityFields(entity, null, resolve, lookup);
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "created_at");
    assert.equal(result[0].fromFragment, "::audit_fields");
  });

  it("handles cycle detection (does not infinite-loop)", () => {
    // Fragment A spreads B, fragment B spreads A
    const fragA = { fields: [], hasSpreads: true, spreads: ["::fragB"] };
    const fragB = { fields: [field("x")], hasSpreads: true, spreads: ["::fragA"] };
    const entity = { fields: [], hasSpreads: true, spreads: ["::fragA"] };
    const resolve = (ref) => ref;
    const lookup = (key) => (key === "::fragA" ? fragA : key === "::fragB" ? fragB : null);

    // Should not throw or loop
    const result = expandEntityFields(entity, null, resolve, lookup);
    assert.equal(result.length, 1); // only fragB's field 'x'
    assert.equal(result[0].name, "x");
  });

  it("handles diamond spreads (deduplication)", () => {
    // Both A and B spread C — C should appear only once
    const fragC = { fields: [field("shared")], hasSpreads: false, spreads: [] };
    const fragA = { fields: [], hasSpreads: true, spreads: ["::fragC"] };
    const fragB = { fields: [], hasSpreads: true, spreads: ["::fragC"] };
    const entity = { fields: [], hasSpreads: true, spreads: ["::fragA", "::fragB"] };
    const resolve = (ref) => ref;
    const lookup = (key) =>
      key === "::fragA" ? fragA : key === "::fragB" ? fragB : key === "::fragC" ? fragC : null;

    const result = expandEntityFields(entity, null, resolve, lookup);
    assert.equal(result.filter((f) => f.name === "shared").length, 1);
  });
});

// ── expandNestedSpreads ───────────────────────────────────────────────────────

describe("expandNestedSpreads()", () => {
  it("expands spreads on nested record fields in place", () => {
    const fragFields = [field("city"), field("zip")];
    const frag = { fields: fragFields, hasSpreads: false };
    const nestedField = {
      name: "address",
      type: "record",
      children: [],
      hasSpreads: true,
      spreads: ["::addr_frag"],
    };
    const fields = [nestedField];
    const resolve = (ref) => ref;
    const lookup = (key) => (key === "::addr_frag" ? frag : null);

    expandNestedSpreads(fields, null, resolve, lookup);

    assert.equal(fields[0].children.length, 2);
    assert.equal(fields[0].children[0].name, "city");
    assert.equal(fields[0].hasSpreads, undefined);
  });
});

/**
 * spread-expand.test.js — Unit tests for satsuma-core spread-expand module
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectFieldPaths,
  expandDeclaredFields,
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

  it("omits a fragment field whose name the body already declares", () => {
    // The shadowing rule (sl-qead). Returning the fragment's copy as well put
    // the same field in a schema twice — one path, two entries — which ADR-035
    // forbids and which moved coverage percentages with how many times a name
    // happened to be written.
    const frag = fragment("::meta", [field("load_ts"), field("batch_id")]);
    const entity = {
      fields: [field("id"), field("load_ts")],
      hasSpreads: true,
      spreads: ["::meta"],
    };
    const resolve = (ref) => ref;
    const lookup = (key) => (key === "::meta" ? frag : null);

    assert.deepEqual(
      expandEntityFields(entity, null, resolve, lookup).map((f) => f.name),
      ["batch_id"],
      "the spread contributes only what the body left unsaid",
    );
  });

  it("gives a name to the first spread that declares it, not the last", () => {
    // Two unrelated fragments can declare the same name without either being an
    // ancestor of the other, so the diamond guard (which keys on the fragment)
    // does not catch it — only the name-level rule does.
    const first = fragment("::first", [field("load_ts")]);
    const second = fragment("::second", [field("load_ts"), field("batch_id")]);
    const entity = { fields: [], hasSpreads: true, spreads: ["::first", "::second"] };
    const resolve = (ref) => ref;
    const lookup = (key) => (key === "::first" ? first : key === "::second" ? second : null);

    const result = expandEntityFields(entity, null, resolve, lookup);
    assert.deepEqual(
      result.map((f) => [f.name, f.fromFragment]),
      [
        ["load_ts", "::first"],
        ["batch_id", "::second"],
      ],
    );
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

// ── expandDeclaredFields ─────────────────────────────────────────────────────
//
// The whole answer to "what fields does this schema declare?", and the reason
// it exists is that its two halves used to be sequenced by each consumer: the
// CLI ran both, the viz ran only the schema-level pass, the LSP ran neither,
// and the three reported different totals for one file (sl-5nsv).

describe("expandDeclaredFields()", () => {
  const addressFields = fragment("address_fields", [field("street"), field("city")]);
  const meta = fragment("meta", [field("load_ts"), field("batch_id")]);
  const entities = new Map([
    ["address_fields", addressFields],
    ["meta", meta],
  ]);
  const resolveRef = makeEntityRefResolver(entities);
  const lookup = (key) => entities.get(key) ?? null;

  /** Every dotted leaf path of a field tree, the unit coverage counts in. */
  const leaves = (fields, prefix = "") =>
    fields.flatMap((f) =>
      f.children?.length ? leaves(f.children, `${prefix}${f.name}.`) : [`${prefix}${f.name}`],
    );

  it("inlines a spread declared inside a record body", () => {
    // The nested form. Expanding only the schema-level one leaves `address` a
    // childless record, which every consumer then counts as a single leaf.
    const schema = {
      fields: [
        field("id"),
        { ...field("address", "record", []), hasSpreads: true, spreads: ["address_fields"] },
      ],
      hasSpreads: false,
      spreads: [],
    };
    assert.deepEqual(expandDeclaredFields(schema, null, resolveRef, lookup), [
      field("id"),
      {
        ...field("address", "record", [
          { ...field("street"), fromFragment: "address_fields" },
          { ...field("city"), fromFragment: "address_fields" },
        ]),
      },
    ]);
  });

  it("appends a schema-level spread's fields after the ones written out", () => {
    // Declaration order is part of the contract: consumers zip the expanded
    // list against their own field entries by position.
    const schema = { fields: [field("id")], hasSpreads: true, spreads: ["address_fields"] };
    assert.deepEqual(leaves(expandDeclaredFields(schema, null, resolveRef, lookup)), [
      "id",
      "street",
      "city",
    ]);
  });

  it("expands both forms in one call", () => {
    const schema = {
      fields: [
        { ...field("address", "record", []), hasSpreads: true, spreads: ["address_fields"] },
      ],
      hasSpreads: true,
      spreads: ["address_fields"],
    };
    assert.deepEqual(leaves(expandDeclaredFields(schema, null, resolveRef, lookup)), [
      "address.street",
      "address.city",
      "street",
      "city",
    ]);
  });

  it("counts a field the body and a spread both declare exactly once", () => {
    // sl-qead, at the level every coverage consumer reads. Three distinct
    // leaves must yield three paths, not four: the duplicate landed in both the
    // denominator and (when mapped) the numerator, so a schema's percentage
    // depended on how many times a name was declared — overstating coverage,
    // the one direction `--fail-under` must not fail in.
    const schema = {
      fields: [field("id"), field("load_ts")],
      hasSpreads: true,
      spreads: ["meta"],
    };
    assert.deepEqual(leaves(expandDeclaredFields(schema, null, resolveRef, lookup)), [
      "id",
      "load_ts",
      "batch_id",
    ]);
  });

  it("applies the same rule inside a record body", () => {
    // The nested form of the collision. It reaches consumers through the same
    // function, so it must not need its own dedupe at the call site.
    const schema = {
      fields: [
        {
          ...field("audit", "record", [field("load_ts")]),
          hasSpreads: true,
          spreads: ["meta"],
        },
      ],
      hasSpreads: false,
      spreads: [],
    };
    assert.deepEqual(leaves(expandDeclaredFields(schema, null, resolveRef, lookup)), [
      "audit.load_ts",
      "audit.batch_id",
    ]);
  });

  it("keeps the explicit record's children when a spread declares that record too", () => {
    // Shadowing is whole-field, not a deep merge: the body's `address` wins
    // outright and the fragment's version contributes nothing, so a reader can
    // predict the field set from the nearest declaration alone.
    const schema = {
      fields: [field("street", "record", [field("number")])],
      hasSpreads: true,
      spreads: ["address_fields"],
    };
    assert.deepEqual(leaves(expandDeclaredFields(schema, null, resolveRef, lookup)), [
      "street.number",
      "city",
    ]);
  });

  it("never mutates the entity it was given", () => {
    // Nested expansion works in place, and index records are shared with every
    // other command in the process — expanding for coverage must not leave the
    // index holding fields the author did not write there.
    const address = {
      ...field("address", "record", []),
      hasSpreads: true,
      spreads: ["address_fields"],
    };
    const schema = { fields: [address], hasSpreads: false, spreads: [] };
    expandDeclaredFields(schema, null, resolveRef, lookup);
    assert.deepEqual(address.children, [], "the caller's field tree is untouched");
    assert.deepEqual(address.spreads, ["address_fields"], "and still records its spread");
  });

  it("returns nothing for an absent entity rather than throwing", () => {
    // Resolvers hand back null for a reference they cannot resolve; coverage is
    // not a validation pass and must carry on reporting the schemas it did find.
    assert.deepEqual(expandDeclaredFields(null, null, resolveRef, lookup), []);
  });
});

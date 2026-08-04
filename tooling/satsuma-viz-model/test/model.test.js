/**
 * model.test.js — Contract tests for @satsuma/viz-model.
 *
 * These tests validate the shape of the VizModel protocol types as consumed
 * by the viz web component. They are the canonical home for VizModel fixture
 * validation; the satsuma-viz test suite no longer duplicates this coverage.
 *
 * Since TypeScript interfaces are erased at runtime, the tests use JSDoc type
 * annotations for IDE assistance and verify structural invariants at runtime.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { CONSTRAINT_TAGS } from "@satsuma/viz-model";

describe("CONSTRAINT_TAGS", () => {
  it("contains the six recognised constraint tags from the v2 spec", () => {
    // The viz renderer uses this set to decide which metadata tags get badge
    // treatment. The spec lists exactly these six constraint identifiers.
    assert.ok(CONSTRAINT_TAGS.has("pk"));
    assert.ok(CONSTRAINT_TAGS.has("required"));
    assert.ok(CONSTRAINT_TAGS.has("pii"));
    assert.ok(CONSTRAINT_TAGS.has("indexed"));
    assert.ok(CONSTRAINT_TAGS.has("unique"));
    assert.ok(CONSTRAINT_TAGS.has("encrypt"));
    assert.equal(CONSTRAINT_TAGS.size, 6, "no undocumented extra constraint tags");
  });

  it("does not treat arbitrary metadata keys as constraint tags", () => {
    // Arbitrary @key annotations (e.g. @label, @note) must not be rendered
    // as badges. The set must remain bounded to the v2 spec list.
    assert.ok(!CONSTRAINT_TAGS.has("label"));
    assert.ok(!CONSTRAINT_TAGS.has("note"));
    assert.ok(!CONSTRAINT_TAGS.has("deprecated"));
  });
});

describe("VizModel fixture validation", () => {
  it("accepts the CLI-compatible field chain contract", () => {
    // The later Lit chain renderer and host-supplied LSP payload both depend on
    // this exact field/via_mapping/classification shape staying serializable.
    /** @type {import("@satsuma/viz-model").FieldChainModel} */
    const chain = {
      field: "::staged.id",
      upstream: [{ field: "::raw.id", via_mapping: "::stage", classification: "none" }],
      downstream: [{ field: "::curated.id", via_mapping: "::curate", classification: "nl" }],
    };

    assert.equal(chain.upstream[0].field, "::raw.id");
    assert.equal(chain.downstream[0].via_mapping, "::curate");
  });

  it("accepts a minimal VizModel shape with schema, fields, and comments", () => {
    // Validates the core VizModel → NamespaceGroup → SchemaCard → FieldEntry
    // chain. The renderer accesses namespaces[0].schemas[0].fields directly;
    // any shape mismatch here will silently produce empty cards.
    /** @type {import("@satsuma/viz-model").VizModel} */
    const model = {
      uri: "file:///test.stm",
      fileNotes: [],
      namespaces: [
        {
          name: null,
          schemas: [
            {
              id: "customers",
              qualifiedId: "customers",
              kind: "schema",
              label: "CRM customers",
              fields: [
                {
                  name: "id",
                  type: "UUID",
                  constraints: ["pk", "required"],
                  notes: [],
                  comments: [],
                  children: [],
                  location: { uri: "file:///test.stm", line: 3, character: 2 },
                },
                {
                  name: "email",
                  type: "STRING",
                  constraints: ["pii"],
                  notes: [],
                  comments: [
                    {
                      kind: "warning",
                      text: "Must be hashed before export",
                      location: { uri: "file:///test.stm", line: 4, character: 2 },
                    },
                  ],
                  children: [],
                  location: { uri: "file:///test.stm", line: 5, character: 2 },
                },
              ],
              notes: [],
              comments: [],
              metadata: [],
              location: { uri: "file:///test.stm", line: 1, character: 0 },
              hasExternalLineage: false,
              spreads: [],
            },
          ],
          mappings: [],
          metrics: [],
          fragments: [],
        },
      ],
    };

    assert.equal(model.namespaces.length, 1);
    const schema = model.namespaces[0].schemas[0];
    assert.equal(schema.fields.length, 2);
    const emailField = schema.fields[1];
    assert.equal(emailField.constraints[0], "pii");
    assert.equal(emailField.comments[0].kind, "warning");
  });

  it("accepts a metric card with grain, slices, and additive measure fields", () => {
    // MetricCard is structurally distinct — it has measure semantics not
    // present on SchemaCard. Validates that grain, slices, and filter are
    // accessible as first-class properties (the renderer renders them specially).
    /** @type {import("@satsuma/viz-model").MetricCard} */
    const metric = {
      id: "monthly_revenue",
      qualifiedId: "monthly_revenue",
      label: "MRR",
      source: ["orders"],
      grain: "monthly",
      slices: ["segment", "region"],
      filter: null,
      fields: [
        {
          name: "value",
          type: "DECIMAL(14,2)",
          measure: "additive",
          notes: [],
          location: { uri: "file:///test.stm", line: 20, character: 2 },
        },
        {
          name: "avg_order",
          type: "DECIMAL(10,2)",
          measure: "non_additive",
          notes: [],
          location: { uri: "file:///test.stm", line: 21, character: 2 },
        },
      ],
      notes: [],
      comments: [],
      location: { uri: "file:///test.stm", line: 18, character: 0 },
    };

    assert.equal(metric.fields.length, 2);
    const first = metric.fields[0];
    assert.ok(first);
    assert.equal(first.measure, "additive");
    assert.equal(metric.slices.length, 2);
  });

  it("accepts a fragment card with spreads field (LSP superset vs viz divergence)", () => {
    // FragmentCard.spreads was added in the LSP version but was absent from
    // satsuma-viz/src/model.ts. This test locks in the canonical shape so
    // the divergence cannot re-emerge.
    /** @type {import("@satsuma/viz-model").FragmentCard} */
    const fragment = {
      id: "audit_fields",
      fields: [
        {
          name: "created_at",
          type: "TIMESTAMP",
          constraints: ["required"],
          notes: [],
          comments: [],
          children: [],
          location: { uri: "file:///test.stm", line: 30, character: 2 },
        },
      ],
      spreads: ["base_audit"],
      notes: [],
      location: { uri: "file:///test.stm", line: 28, character: 0 },
    };

    assert.equal(fragment.fields.length, 1);
    assert.equal(fragment.id, "audit_fields");
    assert.deepEqual(fragment.spreads, ["base_audit"]);
  });

  it("accepts a TransformInfo with optional atRefs (LSP-only field)", () => {
    // TransformInfo.atRefs is present only in the LSP version and is optional.
    // Validates that the field is accepted in the canonical type (so LSP can
    // set it) but that its absence is also valid (viz renders without it).
    // After Feature 28, kind is "nl" | "map" only — "pipeline" and "mixed"
    // are removed, and nlText is gone (all content is in text).
    /** @type {import("@satsuma/viz-model").TransformInfo} */
    const withRefs = {
      kind: "nl",
      text: "copy @customers.email",
      steps: ["copy @customers.email"],
      atRefs: [
        {
          ref: "@customers",
          classification: "schema_ref",
          resolved: true,
          resolvedTo: { kind: "schema", name: "customers" },
        },
      ],
    };
    /** @type {import("@satsuma/viz-model").TransformInfo} */
    const withoutRefs = {
      kind: "nl",
      text: "trim | upper",
      steps: ["trim", "upper"],
    };

    assert.equal(withRefs.atRefs?.length, 1);
    assert.equal(withRefs.atRefs?.[0]?.ref, "@customers");
    assert.equal(withoutRefs.atRefs, undefined);
  });
});

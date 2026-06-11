/**
 * diff.test.js — Unit tests for src/diff.js
 *
 * Tests the structural comparison logic that powers `satsuma diff`. Each test
 * constructs minimal ExtractedWorkspace stubs and asserts that the correct change
 * kinds are emitted.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffIndex } from "#src/diff-engine.js";

function makeIndex(schemas: any = {}, mappings: any = {}, { metrics = {}, fragments = {}, transforms = {}, notes = [] as any[], fieldArrows = {} }: any = {}) {
  return {
    schemas: new Map(Object.entries(schemas)),
    mappings: new Map(Object.entries(mappings)),
    metrics: new Map(Object.entries(metrics)),
    fragments: new Map(Object.entries(fragments)),
    transforms: new Map(Object.entries(transforms)),
    notes,
    fieldArrows: new Map(Object.entries(fieldArrows)),
  } as any;
}

describe("diffIndex", () => {
  it("identical indexes produce empty diff", () => {
    const idx = makeIndex(
      { foo: { fields: [{ name: "id", type: "INT" }] } },
      { m1: { sources: ["foo"], targets: ["bar"], arrowCount: 2 } },
    );
    const delta = diffIndex(idx, idx);
    assert.equal(delta.schemas.added.length, 0);
    assert.equal(delta.schemas.removed.length, 0);
    assert.equal(delta.schemas.changed.length, 0);
    assert.equal(delta.mappings.added.length, 0);
    assert.equal(delta.mappings.removed.length, 0);
    assert.equal(delta.mappings.changed.length, 0);
  });

  it("detects added and removed schemas", () => {
    const a = makeIndex({ foo: { fields: [] } });
    const b = makeIndex({ bar: { fields: [] } });
    const delta = diffIndex(a, b);
    assert.deepEqual(delta.schemas.removed, ["foo"]);
    assert.deepEqual(delta.schemas.added, ["bar"]);
  });

  it("detects added fields", () => {
    const a = makeIndex({ foo: { fields: [{ name: "id", type: "INT" }] } });
    const b = makeIndex({
      foo: {
        fields: [
          { name: "id", type: "INT" },
          { name: "name", type: "VARCHAR" },
        ],
      },
    });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 1);
    assert.equal(delta.schemas.changed[0].changes[0].kind, "field-added");
    assert.equal(delta.schemas.changed[0].changes[0].field, "name");
  });

  it("detects removed fields", () => {
    const a = makeIndex({
      foo: {
        fields: [
          { name: "id", type: "INT" },
          { name: "name", type: "VARCHAR" },
        ],
      },
    });
    const b = makeIndex({ foo: { fields: [{ name: "id", type: "INT" }] } });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 1);
    assert.equal(delta.schemas.changed[0].changes[0].kind, "field-removed");
  });

  it("detects type changes", () => {
    const a = makeIndex({ foo: { fields: [{ name: "id", type: "INT" }] } });
    const b = makeIndex({ foo: { fields: [{ name: "id", type: "BIGINT" }] } });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed[0].changes[0].kind, "type-changed");
    assert.equal(delta.schemas.changed[0].changes[0].from, "INT");
    assert.equal(delta.schemas.changed[0].changes[0].to, "BIGINT");
  });

  // ── Metric metadata detection (sl-1meq) ─────────────────────────────────

  it("detects metric source changes (sl-1meq)", () => {
    const a = makeIndex({}, {}, { metrics: { rev: { sources: ["fact_orders"], grain: "monthly", slices: ["region"], fields: [] } } });
    const b = makeIndex({}, {}, { metrics: { rev: { sources: ["fact_orders", "dim_date"], grain: "monthly", slices: ["region"], fields: [] } } });
    const delta = diffIndex(a, b);
    assert.equal(delta.metrics.changed.length, 1);
    assert.equal(delta.metrics.changed[0].changes[0].kind, "source-changed");
    assert.equal(delta.metrics.changed[0].changes[0].from, "fact_orders");
    assert.equal(delta.metrics.changed[0].changes[0].to, "fact_orders, dim_date");
  });

  it("detects metric grain changes (sl-1meq)", () => {
    const a = makeIndex({}, {}, { metrics: { rev: { sources: ["s"], grain: "monthly", slices: [], fields: [] } } });
    const b = makeIndex({}, {}, { metrics: { rev: { sources: ["s"], grain: "quarterly", slices: [], fields: [] } } });
    const delta = diffIndex(a, b);
    assert.equal(delta.metrics.changed.length, 1);
    assert.equal(delta.metrics.changed[0].changes[0].kind, "grain-changed");
  });

  it("detects metric slices changes (sl-1meq)", () => {
    const a = makeIndex({}, {}, { metrics: { rev: { sources: ["s"], grain: null, slices: ["region"], fields: [] } } });
    const b = makeIndex({}, {}, { metrics: { rev: { sources: ["s"], grain: null, slices: ["region", "channel"], fields: [] } } });
    const delta = diffIndex(a, b);
    assert.equal(delta.metrics.changed.length, 1);
    assert.equal(delta.metrics.changed[0].changes[0].kind, "slices-changed");
  });

  // ── Arrow transform detection (sl-edrw) ─────────────────────────────────

  it("detects arrow transform changes via transform_raw (sl-edrw)", () => {
    /** Verifies that diffIndex compares arrow transform bodies, not just endpoints. */
    const arrowA = {
      mapping: "m1", namespace: null, sources: ["src.name"], target: "tgt.name",
      transform_raw: "trim | upper", steps: [], classification: "nl",
      derived: false, line: 5, file: "a.stm",
    };
    const arrowB = {
      mapping: "m1", namespace: null, sources: ["src.name"], target: "tgt.name",
      transform_raw: "trim | lower", steps: [], classification: "nl",
      derived: false, line: 5, file: "b.stm",
    };
    const a = makeIndex(
      {},
      { m1: { sources: ["src"], targets: ["tgt"], arrowCount: 1 } },
      { fieldArrows: { "src.name": [arrowA] } },
    );
    const b = makeIndex(
      {},
      { m1: { sources: ["src"], targets: ["tgt"], arrowCount: 1 } },
      { fieldArrows: { "src.name": [arrowB] } },
    );
    const delta = diffIndex(a, b);
    assert.equal(delta.mappings.changed.length, 1);
    const transformChange = delta.mappings.changed[0].changes.find((c) => c.kind === "arrow-transform-changed");
    assert.ok(transformChange, "expected an arrow-transform-changed change");
    assert.equal(transformChange.from, "trim | upper");
    assert.equal(transformChange.to, "trim | lower");
  });

  it("reports no arrow changes when transform bodies are identical (sl-edrw)", () => {
    const arrow = {
      mapping: "m1", namespace: null, sources: ["src.name"], target: "tgt.name",
      transform_raw: "trim | upper", steps: [], classification: "nl",
      derived: false, line: 5, file: "a.stm",
    };
    const idx = makeIndex(
      {},
      { m1: { sources: ["src"], targets: ["tgt"], arrowCount: 1 } },
      { fieldArrows: { "src.name": [arrow] } },
    );
    const delta = diffIndex(idx, idx);
    assert.equal(delta.mappings.changed.length, 0);
  });

  // ── Mapping note detection (sl-van1) ─────────────────────────────────────

  it("detects mapping note additions (sl-van1)", () => {
    const a = makeIndex(
      {},
      { m1: { sources: ["a"], targets: ["b"], arrowCount: 1 } },
      { notes: [] },
    );
    const b = makeIndex(
      {},
      { m1: { sources: ["a"], targets: ["b"], arrowCount: 1 } },
      { notes: [{ text: "Added note.", parent: "m1", file: "x.stm", row: 5, namespace: null }] },
    );
    const delta = diffIndex(a, b);
    assert.equal(delta.mappings.changed.length, 1);
    const noteChanges = delta.mappings.changed[0].changes.filter((c) => c.kind === "note-added");
    assert.equal(noteChanges.length, 1);
  });

  it("mapping notes do not appear as top-level note changes (sl-van1)", () => {
    const a = makeIndex({}, { m1: { sources: ["a"], targets: ["b"], arrowCount: 1 } }, { notes: [] });
    const b = makeIndex(
      {},
      { m1: { sources: ["a"], targets: ["b"], arrowCount: 1 } },
      { notes: [{ text: "Block note.", parent: "m1", file: "x.stm", row: 5, namespace: null }] },
    );
    const delta = diffIndex(a, b);
    assert.equal(delta.notes.added.length, 0, "block-owned notes should not appear in top-level notes");
  });

  it("detects standalone top-level note additions (sl-van1)", () => {
    /** Top-level notes (parent === null) should appear in delta.notes. */
    const a = makeIndex({}, {}, { notes: [] });
    const b = makeIndex({}, {}, {
      notes: [{ text: "New standalone note.", parent: null, file: "x.stm", row: 1, namespace: null }],
    });
    const delta = diffIndex(a, b);
    assert.deepEqual(delta.notes.added, ["New standalone note."]);
    assert.deepEqual(delta.notes.removed, []);
  });

  it("detects standalone top-level note text changes (sl-van1)", () => {
    /** When a standalone note's text changes, both the old and new appear. */
    const a = makeIndex({}, {}, {
      notes: [{ text: "Original note.", parent: null, file: "x.stm", row: 1, namespace: null }],
    });
    const b = makeIndex({}, {}, {
      notes: [{ text: "Updated note.", parent: null, file: "x.stm", row: 1, namespace: null }],
    });
    const delta = diffIndex(a, b);
    assert.deepEqual(delta.notes.added, ["Updated note."]);
    assert.deepEqual(delta.notes.removed, ["Original note."]);
  });

  // ── Schema note detection (sl-fkwb) ─────────────────────────────────────

  it("detects schema-level note text changes via note tag (sl-4gio)", () => {
    const a = makeIndex({ foo: { note: "Raw source data", fields: [{ name: "id", type: "INT" }] } });
    const b = makeIndex({ foo: { note: "Updated description", fields: [{ name: "id", type: "INT" }] } });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 1);
    assert.equal(delta.schemas.changed[0].changes[0].kind, "note-changed");
    assert.equal(delta.schemas.changed[0].changes[0].from, "Raw source data");
    assert.equal(delta.schemas.changed[0].changes[0].to, "Updated description");
  });

  it("detects schema note added from null (sl-4gio)", () => {
    const a = makeIndex({ foo: { note: null, fields: [] } });
    const b = makeIndex({ foo: { note: "New note", fields: [] } });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 1);
    assert.equal(delta.schemas.changed[0].changes[0].kind, "note-changed");
  });

  it("identical schema notes produce no change", () => {
    const a = makeIndex({ foo: { note: "Same note", fields: [] } });
    const b = makeIndex({ foo: { note: "Same note", fields: [] } });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 0);
  });

  it("detects schema note block changes attributed under schema (sl-fkwb)", () => {
    /** Note blocks inside schema body should produce note-added/note-removed under the schema. */
    const a = makeIndex({ data: { note: null, fields: [{ name: "id", type: "INT" }] } }, {}, {
      notes: [{ text: "This schema holds customer data.", parent: "data", file: "a.stm", row: 1, namespace: null }],
    });
    const b = makeIndex({ data: { note: null, fields: [{ name: "id", type: "INT" }] } }, {}, {
      notes: [{ text: "This schema holds updated customer data with PII.", parent: "data", file: "b.stm", row: 1, namespace: null }],
    });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 1);
    assert.equal(delta.schemas.changed[0].name, "data");
    const noteAdded = delta.schemas.changed[0].changes.find((c) => c.kind === "note-added");
    const noteRemoved = delta.schemas.changed[0].changes.find((c) => c.kind === "note-removed");
    assert.ok(noteAdded, "expected note-added for new note text");
    assert.ok(noteRemoved, "expected note-removed for old note text");
    // Should not appear at top level
    assert.equal(delta.notes.added.length, 0, "schema notes should not leak to top-level");
    assert.equal(delta.notes.removed.length, 0, "schema notes should not leak to top-level");
  });

  it("schema note blocks with identical text produce no change (sl-fkwb)", () => {
    const note = { text: "Same note.", parent: "data", file: "a.stm", row: 1, namespace: null };
    const a = makeIndex({ data: { note: null, fields: [] } }, {}, { notes: [note] });
    const b = makeIndex({ data: { note: null, fields: [] } }, {}, { notes: [note] });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 0);
  });

  // ── Transform body detection ─────────────────────────────────────────────

  it("detects transform body text changes (sl-7ow3)", () => {
    const a = makeIndex({}, {}, { transforms: { "clean address": { body: "trim | lowercase" } } });
    const b = makeIndex({}, {}, { transforms: { "clean address": { body: "trim | lowercase | capitalize" } } });
    const delta = diffIndex(a, b);
    assert.equal(delta.transforms.changed.length, 1);
    assert.equal(delta.transforms.changed[0].name, "clean address");
    assert.equal(delta.transforms.changed[0].changes[0].kind, "body-changed");
    assert.equal(delta.transforms.changed[0].changes[0].from, "trim | lowercase");
    assert.equal(delta.transforms.changed[0].changes[0].to, "trim | lowercase | capitalize");
  });

  it("identical transform bodies produce no change", () => {
    const a = makeIndex({}, {}, { transforms: { "clean": { body: "trim" } } });
    const b = makeIndex({}, {}, { transforms: { "clean": { body: "trim" } } });
    const delta = diffIndex(a, b);
    assert.equal(delta.transforms.changed.length, 0);
  });

  // ── Metric note detection ────────────────────────────────────────────────

  it("detects metric note changes attributed under metric, not top-level (sl-kf76)", () => {
    const a = makeIndex({}, {}, {
      metrics: { rev: { sources: ["s"], grain: null, slices: [], fields: [] } },
      notes: [{ text: "Old note.", parent: "rev", file: "x.stm", row: 3, namespace: null }],
    });
    const b = makeIndex({}, {}, {
      metrics: { rev: { sources: ["s"], grain: null, slices: [], fields: [] } },
      notes: [{ text: "New note.", parent: "rev", file: "x.stm", row: 3, namespace: null }],
    });
    const delta = diffIndex(a, b);
    // Should appear under metrics, not top-level notes
    assert.equal(delta.metrics.changed.length, 1);
    assert.equal(delta.metrics.changed[0].name, "rev");
    const noteAdded = delta.metrics.changed[0].changes.find((c) => c.kind === "note-added");
    const noteRemoved = delta.metrics.changed[0].changes.find((c) => c.kind === "note-removed");
    assert.ok(noteAdded);
    assert.ok(noteRemoved);
    assert.equal(delta.notes.added.length, 0, "metric notes should not leak to top-level");
    assert.equal(delta.notes.removed.length, 0, "metric notes should not leak to top-level");
  });

  // ── Mapping arrow changes ────────────────────────────────────────────────

  it("detects arrow count changes in mappings", () => {
    const a = makeIndex({}, { m1: { sources: ["a"], targets: ["b"], arrowCount: 5 } });
    const b = makeIndex({}, { m1: { sources: ["a"], targets: ["b"], arrowCount: 8 } });
    const delta = diffIndex(a, b);
    assert.equal(delta.mappings.changed.length, 1);
    assert.equal(delta.mappings.changed[0].changes[0].kind, "arrow-count-changed");
  });

  it("detects added and removed arrows", () => {
    /** Verifies that added/removed arrows are detected by source->target key. */
    const arrowA = {
      mapping: "m1", namespace: null, sources: ["src.id"], target: "tgt.id",
      transform_raw: "", steps: [], classification: "nl",
      derived: false, line: 5, file: "a.stm",
    };
    const arrowB = {
      mapping: "m1", namespace: null, sources: ["src.name"], target: "tgt.name",
      transform_raw: "", steps: [], classification: "nl",
      derived: false, line: 5, file: "b.stm",
    };
    const a = makeIndex(
      {},
      { m1: { sources: ["src"], targets: ["tgt"], arrowCount: 1 } },
      { fieldArrows: { "src.id": [arrowA] } },
    );
    const b = makeIndex(
      {},
      { m1: { sources: ["src"], targets: ["tgt"], arrowCount: 1 } },
      { fieldArrows: { "src.name": [arrowB] } },
    );
    const delta = diffIndex(a, b);
    const removed = delta.mappings.changed[0].changes.find((c) => c.kind === "arrow-removed");
    const added = delta.mappings.changed[0].changes.find((c) => c.kind === "arrow-added");
    assert.ok(removed, "expected arrow-removed for old arrow");
    assert.ok(added, "expected arrow-added for new arrow");
  });

  it("detects sources-changed in mappings", () => {
    const a = makeIndex({}, { m1: { sources: ["old_src"], targets: ["t"], arrowCount: 1 } });
    const b = makeIndex({}, { m1: { sources: ["new_src"], targets: ["t"], arrowCount: 1 } });
    const delta = diffIndex(a, b);
    const changes = delta.mappings.changed[0].changes;
    assert.ok(changes.some((c: any) => c.kind === "sources-changed"));
  });

  it("detects targets-changed in mappings", () => {
    const a = makeIndex({}, { m1: { sources: ["s"], targets: ["old_tgt"], arrowCount: 1 } });
    const b = makeIndex({}, { m1: { sources: ["s"], targets: ["new_tgt"], arrowCount: 1 } });
    const delta = diffIndex(a, b);
    const changes = delta.mappings.changed[0].changes;
    assert.ok(changes.some((c: any) => c.kind === "targets-changed"));
  });

  // ── Field metadata changes ──────────────────────────────────────────────

  it("detects metadata-changed on schema fields", () => {
    const a = makeIndex({
      s1: { fields: [{ name: "id", type: "INT", metadata: [{ kind: "tag", tag: "pk" }] }] },
    });
    const b = makeIndex({
      s1: { fields: [{ name: "id", type: "INT", metadata: [{ kind: "tag", tag: "unique" }] }] },
    });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 1);
    const metaChange = delta.schemas.changed[0].changes.find((c) => c.kind === "metadata-changed");
    assert.ok(metaChange, "should detect metadata change");
  });

  // ── Top-level notes ─────────────────────────────────────────────────────

  it("detects added and removed top-level notes (sl-wpyb)", () => {
    const a = makeIndex({}, {}, { notes: [{ parent: null, text: "old note" }] });
    const b = makeIndex({}, {}, { notes: [{ parent: null, text: "new note" }] });
    const delta = diffIndex(a, b);
    assert.ok(delta.notes.added.includes("new note"));
    assert.ok(delta.notes.removed.includes("old note"));
  });

  // ── Nested field recursion ──────────────────────────────────────────────

  it("detects changes in nested child fields", () => {
    const a = makeIndex({
      s1: {
        fields: [{
          name: "address",
          type: "record",
          children: [{ name: "city", type: "VARCHAR" }],
        }],
      },
    });
    const b = makeIndex({
      s1: {
        fields: [{
          name: "address",
          type: "record",
          children: [{ name: "city", type: "TEXT" }],
        }],
      },
    });
    const delta = diffIndex(a, b);
    assert.equal(delta.schemas.changed.length, 1);
    const typeChange = delta.schemas.changed[0].changes.find(
      (c) => c.kind === "type-changed" && c.field === "address.city",
    );
    assert.ok(typeChange, "should detect type change in nested field");
    assert.equal(typeChange.from, "VARCHAR");
    assert.equal(typeChange.to, "TEXT");
  });
});

// ── Anonymous mapping normalization (sl-ndtz) ────────────────────────────────

describe("diffIndex anonymous mappings (sl-ndtz)", () => {
  /** Build a minimal anonymous MappingRecord stored under its internal positional key. */
  const anonMapping = (file: string, row: number, sources: string[], targets: string[], arrowCount = 1) => ({
    [`<anon>@${file}:${row}`]: { name: null, sources, targets, arrowCount, file, row },
  });

  it("treats structurally identical anonymous mappings at different file paths as unchanged", () => {
    // The internal anon key embeds the absolute path, so byte-identical v1/v2
    // files used to report every anonymous mapping as removed-and-added.
    const a = makeIndex({}, anonMapping("/v1/pipe.stm", 2, ["src"], ["tgt"]));
    const b = makeIndex({}, anonMapping("/v2/pipe.stm", 2, ["src"], ["tgt"]));

    const delta = diffIndex(a, b);
    assert.equal(delta.mappings.added.length, 0);
    assert.equal(delta.mappings.removed.length, 0);
    assert.equal(delta.mappings.changed.length, 0);
  });

  it("reports a changed anonymous mapping under a structural id, never the internal key", () => {
    // The synthetic <anon>@path:row key is an implementation detail and must
    // not leak into the delta consumed by user-facing formatters.
    const a = makeIndex({}, anonMapping("/v1/pipe.stm", 2, ["src"], ["tgt"], 1));
    const b = makeIndex({}, anonMapping("/v2/pipe.stm", 7, ["src"], ["tgt"], 3));

    const delta = diffIndex(a, b);
    assert.equal(delta.mappings.changed.length, 1);
    assert.equal(delta.mappings.changed[0].name, "<anonymous src -> tgt>");
    assert.doesNotMatch(delta.mappings.changed[0].name, /<anon>@/);
  });

  it("pairs multiple same-signature anonymous mappings positionally across versions", () => {
    // Two anonymous mappings with identical source/target signatures must get
    // stable ordinals so each pairs with its counterpart instead of colliding.
    const twoAnon = (file: string) => ({
      ...anonMapping(file, 2, ["src"], ["tgt"]),
      ...anonMapping(file, 9, ["src"], ["tgt"]),
    });
    const delta = diffIndex(makeIndex({}, twoAnon("/v1/pipe.stm")), makeIndex({}, twoAnon("/v2/pipe.stm")));

    assert.equal(delta.mappings.added.length, 0);
    assert.equal(delta.mappings.removed.length, 0);
    assert.equal(delta.mappings.changed.length, 0);
  });

  it("preserves the namespace prefix on normalized anonymous mapping ids", () => {
    // Namespaced anon mappings are keyed `ns::<anon>@path:row`; the structural
    // id must stay namespace-qualified so scoped blocks do not cross-match.
    const a = makeIndex({}, { "crm::<anon>@/v1/p.stm:4": { name: null, sources: ["s"], targets: ["t"], arrowCount: 1, file: "/v1/p.stm", row: 4 } });
    const b = makeIndex({}, { "crm::<anon>@/v2/p.stm:4": { name: null, sources: ["s"], targets: ["t"], arrowCount: 2, file: "/v2/p.stm", row: 4 } });

    const delta = diffIndex(a, b);
    assert.equal(delta.mappings.changed.length, 1);
    assert.equal(delta.mappings.changed[0].name, "crm::<anonymous s -> t>");
  });
});

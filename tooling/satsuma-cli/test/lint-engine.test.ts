/**
 * lint-engine.test.js — Unit tests for lint rules and engine
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLint, applyFixes } from "#src/lint-engine.js";
import type { ExtractedWorkspace } from "#src/types.js";

/** Shape of a mock schema passed to makeIndex. */
interface MockSchema {
  name: string;
  fields: Array<{ name: string; children?: Array<{ name: string }> }>;
  /** Set when the schema spreads a fragment that has not been expanded — its field list is then incomplete. */
  hasSpreads?: boolean;
  /** Fragment names this schema spreads (`...name`), resolved against `fragments` passed to makeIndex. */
  spreads?: string[];
  file?: string;
  row?: number;
}

/** Shape of a mock fragment passed to makeIndex, resolved by name for a MockSchema's `spreads`. */
interface MockFragment {
  name: string;
  fields: Array<{ name: string; children?: Array<{ name: string }> }>;
}

/** Shape of a mock mapping passed to makeIndex. */
interface MockMapping {
  name: string;
  namespace?: string | null;
  sources?: string[];
  targets?: string[];
  file?: string;
  row?: number;
}

/** Shape of a mock NL ref datum passed to makeIndex. */
interface MockNLRef {
  text: string;
  mapping: string;
  namespace: string | null;
  targetField: string | null;
  file: string;
  line: number;
  column: number;
}

/**
 * Shape of a mock arrow passed to makeIndex.
 *
 * `kind` and `enumeratesChildren` default to the plain-arrow reading (`map`,
 * nothing enumerated), which is the shape `unenumerated-record-target` judges;
 * a case that needs another declaration shape states it.
 */
interface MockArrow {
  mapping: string;
  namespace?: string | null;
  sources: string[];
  target: string | null;
  kind?: "map" | "computed" | "nested" | "each" | "flatten";
  enumeratesChildren?: boolean;
  file?: string;
  line?: number;
}

/** Build a minimal ExtractedWorkspace for lint testing. */
function makeIndex({
  schemas = [],
  mappings = [],
  nlRefData = [],
  arrows = [],
  fragments = [],
}: {
  schemas?: MockSchema[];
  mappings?: MockMapping[];
  nlRefData?: MockNLRef[];
  arrows?: MockArrow[];
  fragments?: MockFragment[];
} = {}): ExtractedWorkspace {
  const schemaMap = new Map<string, any>();
  for (const s of schemas) {
    schemaMap.set(s.name, { ...s, file: s.file ?? "test.stm", row: s.row ?? 0 });
  }
  const mappingMap = new Map<string, any>();
  for (const m of mappings) {
    mappingMap.set(m.name, { ...m, file: m.file ?? "test.stm", row: m.row ?? 0 });
  }
  const fragmentMap = new Map<string, any>();
  for (const f of fragments) {
    fragmentMap.set(f.name, { ...f, hasSpreads: false, spreads: [], file: "test.stm", row: 0 });
  }
  return {
    schemas: schemaMap,
    mappings: mappingMap,
    metrics: new Map(),
    fragments: fragmentMap,
    transforms: new Map(),
    notes: [],
    warnings: [],
    questions: [],
    fieldArrows: new Map(),
    arrows: arrows.map((a) => ({
      kind: "map",
      enumeratesChildren: false,
      namespace: null,
      transform_raw: "",
      steps: [],
      classification: "none",
      derived: false,
      file: "test.stm",
      line: 0,
      ...a,
    })),
    referenceGraph: {
      usedByMappings: new Map(),
      fragmentsUsedIn: new Map(),
      metricsReferences: new Map(),
    },
    namespaceNames: new Set(),
    nlRefData,
    duplicates: [],
    totalErrors: 0,
  } as any as ExtractedWorkspace;
}

// ── hidden-source-in-nl ────────────────────────────────────────────────────

describe("lint: hidden-source-in-nl", () => {
  it("flags NL reference to schema not in source list", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "department" }, { name: "employee_id" }] },
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl", fields: [{ name: "department" }] },
      ],
      mappings: [
        {
          name: "staging::stage gl",
          namespace: "staging",
          sources: ["source::finance_gl"],
          targets: ["staging::stg_gl"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup @department from @source::hr_employees",
          mapping: "stage gl",
          namespace: "staging",
          targetField: "department",
          file: "test.stm",
          line: 10,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "hidden-source-in-nl");
    assert.equal(diags[0].severity, "error");
    assert.equal(diags[0].fixable, true);
    assert.ok(diags[0].fix);
  });

  it("does not flag schema already in source list", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl", fields: [{ name: "department" }] },
      ],
      mappings: [
        {
          name: "staging::stage gl",
          namespace: "staging",
          sources: ["source::finance_gl"],
          targets: ["staging::stg_gl"],
        },
      ],
      nlRefData: [
        {
          text: "Copy from @source::finance_gl",
          mapping: "stage gl",
          namespace: "staging",
          targetField: "department",
          file: "test.stm",
          line: 10,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 0);
  });

  it("fix adds schema to source block", () => {
    const source = [
      "mapping `stage gl` {",
      "  source { source::finance_gl }",
      "  target { staging::stg_gl }",
      "}",
    ].join("\n");

    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "department" }] },
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl", fields: [{ name: "department" }] },
      ],
      mappings: [
        {
          name: "stage gl",
          sources: ["source::finance_gl"],
          targets: ["staging::stg_gl"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @source::hr_employees",
          mapping: "stage gl",
          namespace: null,
          targetField: "department",
          file: "test.stm",
          line: 10,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 1);

    const sourceByFile = new Map([["test.stm", source]]);
    const { fixedFiles, appliedFixes } = applyFixes(sourceByFile, diags);

    assert.equal(appliedFixes.length, 1);
    assert.ok(fixedFiles.has("test.stm"));
    const fixed = fixedFiles.get("test.stm")!;
    assert.match(fixed, /source \{ source::finance_gl, source::hr_employees \}/);
  });

  it("fix adds schema to arrow source list for arrow-level NL", () => {
    const source = [
      "mapping `stage gl` {",
      "  source { source::finance_gl }",
      "  target { staging::stg_gl }",
      "",
      "  finance_gl.posted_by -> stg_gl.department {",
      '    "Lookup from @source::hr_employees"',
      "  }",
      "}",
    ].join("\n");

    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "department" }] },
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl", fields: [{ name: "department" }] },
      ],
      mappings: [
        {
          name: "stage gl",
          sources: ["source::finance_gl"],
          targets: ["staging::stg_gl"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @source::hr_employees",
          mapping: "stage gl",
          namespace: null,
          targetField: "stg_gl.department",
          file: "test.stm",
          line: 10,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 1);

    const sourceByFile = new Map([["test.stm", source]]);
    const { fixedFiles, appliedFixes } = applyFixes(sourceByFile, diags);

    assert.equal(appliedFixes.length, 1);
    const fixed = fixedFiles.get("test.stm")!;
    // Arrow should now be multi-source
    assert.match(fixed, /finance_gl\.posted_by, source::hr_employees -> stg_gl\.department/);
    // Source block should also be updated
    assert.match(fixed, /source \{ source::finance_gl, source::hr_employees \}/);
  });

  it("fix adds schema to source block only for non-arrow NL", () => {
    const source = [
      "mapping `stage gl` {",
      "  source { source::finance_gl }",
      "  target { staging::stg_gl }",
      "",
      "  note {",
      '    "Lookup from @source::hr_employees"',
      "  }",
      "}",
    ].join("\n");

    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "department" }] },
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl", fields: [{ name: "department" }] },
      ],
      mappings: [
        {
          name: "stage gl",
          sources: ["source::finance_gl"],
          targets: ["staging::stg_gl"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @source::hr_employees",
          mapping: "stage gl",
          namespace: null,
          targetField: null,
          file: "test.stm",
          line: 10,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 1);

    const sourceByFile = new Map([["test.stm", source]]);
    const { fixedFiles, appliedFixes } = applyFixes(sourceByFile, diags);

    assert.equal(appliedFixes.length, 1);
    const fixed = fixedFiles.get("test.stm")!;
    // Source block should be updated
    assert.match(fixed, /source \{ source::finance_gl, source::hr_employees \}/);
    // No arrow modification (note block, not arrow NL)
    assert.ok(!fixed.includes("->"));
  });

  it("fix is idempotent", () => {
    // After fix, hr_employees is already in source list — no diagnostic expected
    const index = makeIndex({
      schemas: [
        { name: "source::hr_employees", fields: [{ name: "department" }] },
        { name: "source::finance_gl", fields: [{ name: "posted_by" }] },
        { name: "staging::stg_gl", fields: [{ name: "department" }] },
      ],
      mappings: [
        {
          name: "stage gl",
          sources: ["source::finance_gl", "source::hr_employees"],
          targets: ["staging::stg_gl"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @source::hr_employees",
          mapping: "stage gl",
          namespace: null,
          targetField: "department",
          file: "test.stm",
          line: 10,
          column: 6,
        },
      ],
    });

    // After fix, schema is in source list so no diagnostics
    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 0);
  });

  it("does not flag dotted sub-field path when root segment is a declared source field", () => {
    // When an NL ref is `PERSONAL_NAME.FIRST_NAME` and PERSONAL_NAME is a
    // record field within a declared source schema, it should NOT be flagged.
    const index = makeIndex({
      schemas: [
        {
          name: "src_contact",
          fields: [
            {
              name: "PERSONAL_NAME",
              children: [{ name: "FIRST_NAME" }, { name: "LAST_NAME" }],
            },
            { name: "email" },
          ],
        },
        { name: "tgt_person", fields: [{ name: "first_name" }] },
      ],
      mappings: [
        {
          name: "map_person",
          sources: ["src_contact"],
          targets: ["tgt_person"],
        },
      ],
      nlRefData: [
        {
          text: "Copy from @PERSONAL_NAME.FIRST_NAME",
          mapping: "map_person",
          namespace: null,
          targetField: "first_name",
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 0);
  });

  it("flags dotted sub-field path when root segment is NOT a declared source field", () => {
    // `other_schema.some_field` where other_schema is a real schema but not
    // in the mapping's source/target list — should be flagged.
    const index = makeIndex({
      schemas: [
        { name: "src_contact", fields: [{ name: "email" }] },
        { name: "other_schema", fields: [{ name: "some_field" }] },
        { name: "tgt_person", fields: [{ name: "first_name" }] },
      ],
      mappings: [
        {
          name: "map_person",
          sources: ["src_contact"],
          targets: ["tgt_person"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @other_schema.some_field",
          mapping: "map_person",
          namespace: null,
          targetField: "first_name",
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "hidden-source-in-nl");
  });
});

// ── unresolved-nl-ref ──────────────────────────────────────────────────────

describe("lint: unresolved-nl-ref", () => {
  it("flags unresolved @ref", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::orders", fields: [{ name: "order_id" }] },
        { name: "staging::stg_orders", fields: [{ name: "order_id" }] },
      ],
      mappings: [
        {
          name: "staging::stage orders",
          namespace: "staging",
          sources: ["source::orders"],
          targets: ["staging::stg_orders"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @nonexistent_thing",
          mapping: "stage orders",
          namespace: "staging",
          targetField: "order_id",
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "unresolved-nl-ref");
    assert.equal(diags[0].fixable, false);
  });

  it("does not flag resolved references", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::orders", fields: [{ name: "order_id" }] },
        { name: "staging::stg_orders", fields: [{ name: "order_id" }] },
      ],
      mappings: [
        {
          name: "staging::stage orders",
          namespace: "staging",
          sources: ["source::orders"],
          targets: ["staging::stg_orders"],
        },
      ],
      nlRefData: [
        {
          text: "Copy @order_id from source",
          mapping: "stage orders",
          namespace: "staging",
          targetField: "order_id",
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(diags.length, 0);
  });

  it("flags unresolved @refs in file-level standalone notes (sl-vjvf)", () => {
    // Bug sl-vjvf: unresolved @refs in file-level notes were previously skipped.
    // They should now produce unresolved-nl-ref warnings like any other note context.
    const index = makeIndex({
      schemas: [{ name: "source::orders", fields: [{ name: "order_id" }] }],
      nlRefData: [
        {
          text: "The @flatten transform is used for @pii compliance",
          mapping: "note:",
          namespace: null,
          targetField: null,
          file: "test.stm",
          line: 1,
          column: 0,
        },
      ],
    });

    const diags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(diags.length, 2, "unresolved @refs in file-level notes should produce warnings");
  });

  it("still flags unresolved refs in metric/schema note blocks", () => {
    const index = makeIndex({
      schemas: [{ name: "source::orders", fields: [{ name: "order_id" }] }],
      nlRefData: [
        {
          text: "Lookup from @nonexistent_thing",
          mapping: "note:source::orders",
          namespace: null,
          targetField: null,
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });

    const diags = runLint(index, { select: ["unresolved-nl-ref"] });
    assert.equal(diags.length, 1, "block-level note refs should still be checked");
    assert.equal(diags[0].rule, "unresolved-nl-ref");
  });
});

// ── duplicate-definition ──────────────────────────────────────────────────

describe("lint: duplicate-definition", () => {
  it("flags schema declared twice in same namespace", () => {
    const index = makeIndex({
      schemas: [{ name: "staging::orders", fields: [{ name: "order_id" }] }],
    });
    index.duplicates = [
      {
        kind: "schema",
        name: "staging::orders",
        file: "pipeline-b.stm",
        row: 10,
        previousKind: "schema",
        previousFile: "pipeline-a.stm",
        previousRow: 5,
      },
    ];

    const diags = runLint(index, { select: ["duplicate-definition"] });
    assert.equal(diags.length, 1);
    assert.equal(diags[0].rule, "duplicate-definition");
    assert.equal(diags[0].severity, "error");
    assert.equal(diags[0].fixable, false);
    assert.equal(diags[0].file, "pipeline-b.stm");
    assert.equal(diags[0].line, 11);
    assert.match(diags[0].message, /Schema 'staging::orders' is already defined/);
  });

  it("flags cross-kind conflict (schema vs metric)", () => {
    const index = makeIndex();
    index.duplicates = [
      {
        kind: "metric",
        name: "revenue",
        file: "metrics-platform/metrics.stm",
        row: 20,
        previousKind: "schema",
        previousFile: "schemas.stm",
        previousRow: 3,
      },
    ];

    const diags = runLint(index, { select: ["duplicate-definition"] });
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /Metric 'revenue' conflicts with schema/);
  });

  it("does not flag namespace-metadata conflicts", () => {
    const index = makeIndex();
    index.duplicates = [
      {
        kind: "namespace-metadata",
        name: "staging",
        file: "b.stm",
        row: 0,
        previousKind: "namespace-metadata",
        previousFile: "a.stm",
        previousRow: 0,
        tag: "note",
        value: "v2",
        previousValue: "v1",
      },
    ];

    const diags = runLint(index, { select: ["duplicate-definition"] });
    assert.equal(diags.length, 0);
  });

  it("produces no findings when no duplicates exist", () => {
    const index = makeIndex({
      schemas: [
        { name: "orders", fields: [{ name: "order_id" }] },
        { name: "customers", fields: [{ name: "customer_id" }] },
      ],
    });
    index.duplicates = [];

    const diags = runLint(index, { select: ["duplicate-definition"] });
    assert.equal(diags.length, 0);
  });

  it("handles missing duplicates array gracefully", () => {
    const index = makeIndex();
    // duplicates not set — should not throw
    const diags = runLint(index, { select: ["duplicate-definition"] });
    assert.equal(diags.length, 0);
  });
});

// ── Engine: select / ignore ────────────────────────────────────────────────

describe("lint engine: rule filtering", () => {
  it("--select filters to specified rules", () => {
    const index = makeIndex();
    const diags = runLint(index, { select: ["hidden-source-in-nl"] });
    // No findings on empty index, but should not throw
    assert.ok(Array.isArray(diags));
  });

  it("--ignore excludes specified rules", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::orders", fields: [{ name: "order_id" }] },
        { name: "staging::stg_orders", fields: [{ name: "order_id" }] },
      ],
      mappings: [
        {
          name: "staging::stage orders",
          namespace: "staging",
          sources: ["source::orders"],
          targets: ["staging::stg_orders"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @nonexistent_thing",
          mapping: "stage orders",
          namespace: "staging",
          targetField: "order_id",
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });

    const all = runLint(index);
    const filtered = runLint(index, { ignore: ["unresolved-nl-ref"] });
    assert.ok(all.length > filtered.length);
  });
});

// ── Engine: diagnostics shape ──────────────────────────────────────────────

describe("lint diagnostic shape", () => {
  it("includes all required fields", () => {
    const index = makeIndex({
      schemas: [
        { name: "source::orders", fields: [{ name: "order_id" }] },
        { name: "staging::stg_orders", fields: [{ name: "order_id" }] },
      ],
      mappings: [
        {
          name: "staging::stage orders",
          namespace: "staging",
          sources: ["source::orders"],
          targets: ["staging::stg_orders"],
        },
      ],
      nlRefData: [
        {
          text: "Lookup from @nonexistent_thing",
          mapping: "stage orders",
          namespace: "staging",
          targetField: "order_id",
          file: "test.stm",
          line: 5,
          column: 6,
        },
      ],
    });

    const diags = runLint(index);
    assert.ok(diags.length > 0);
    const d = diags[0];
    assert.equal(typeof d.file, "string");
    assert.equal(typeof d.line, "number");
    assert.equal(typeof d.column, "number");
    assert.ok(["error", "warning"].includes(d.severity));
    assert.equal(typeof d.rule, "string");
    assert.equal(typeof d.message, "string");
    assert.equal(typeof d.fixable, "boolean");
  });
});

// ── unenumerated-record-target ─────────────────────────────────────────────

describe("lint: unenumerated-record-target", () => {
  /** src has a scalar and a record; tgt has a record. Each case varies only the arrow. */
  const twoShapes = (arrows: MockArrow[]) =>
    makeIndex({
      schemas: [
        {
          name: "src",
          fields: [
            { name: "full_name" },
            { name: "addr", children: [{ name: "line1" }, { name: "city" }] },
          ],
        },
        {
          name: "tgt",
          fields: [{ name: "address", children: [{ name: "line1" }, { name: "city" }] }],
        },
      ],
      mappings: [{ name: "load", sources: ["src"], targets: ["tgt"] }],
      arrows,
    });

  const run = (index: ExtractedWorkspace) =>
    runLint(index, { select: ["unenumerated-record-target"] });

  it("flags an arrow from a scalar into a record that enumerates nothing", () => {
    // The shape the rule exists for, and the one coverage refuses to credit
    // (ADR-038): a reader cannot tell which of the record's fields the arrow
    // fills, so the leaves report as gaps with no indication why.
    const diags = run(twoShapes([{ mapping: "load", sources: ["full_name"], target: "address" }]));
    assert.equal(diags.length, 1);
    assert.equal(diags[0].severity, "warning");
    assert.match(diags[0].message, /targets a record/);
    assert.match(diags[0].message, /Enumerate them/);
    assert.equal(diags[0].fixable, false);
  });

  it("stays silent when the source is itself a record", () => {
    // `addr -> address` is the correspondence whole-structure coverage credits,
    // so there is nothing under-specified to report.
    assert.deepEqual(
      run(twoShapes([{ mapping: "load", sources: ["addr"], target: "address" }])),
      [],
    );
  });

  it("stays silent when the body enumerates the record's children", () => {
    // The author has said which fields map, which is the other way to answer the
    // question the rule asks. Enumerating must not be penalised.
    const diags = run(
      twoShapes([
        {
          mapping: "load",
          sources: ["full_name"],
          target: "address",
          kind: "nested",
          enumeratesChildren: true,
        },
      ]),
    );
    assert.deepEqual(diags, []);
  });

  it("stays silent for an each header, which opens an iteration rather than a correspondence", () => {
    // Iteration kinds assert nothing about a subtree either way, so they are
    // outside this rule — flagging them would fire on every well-formed each block.
    const diags = run(
      twoShapes([{ mapping: "load", sources: ["full_name"], target: "address", kind: "each" }]),
    );
    assert.deepEqual(diags, []);
  });

  it("stays silent when the target is a leaf rather than a record", () => {
    // A record target is the precondition — an ordinary scalar-to-scalar arrow
    // has nothing unstated about it. This is the bulk of every real workspace,
    // so a false positive here would make the rule unusable.
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "full_name" }] },
        { name: "tgt", fields: [{ name: "name" }] },
      ],
      mappings: [{ name: "load", sources: ["src"], targets: ["tgt"] }],
      arrows: [{ mapping: "load", sources: ["full_name"], target: "name" }],
    });
    assert.deepEqual(run(index), []);
  });

  it("stays silent when the target schema has unresolved spreads", () => {
    // The field list is incomplete, so "targets a record" cannot be established
    // — reporting on it would blame the author for an unexpanded fragment. This
    // schema declares `hasSpreads` with no matching fragment registered, the
    // mock's stand-in for a spread naming a fragment the workspace never defines.
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "full_name" }] },
        {
          name: "tgt",
          fields: [{ name: "address", children: [{ name: "line1" }] }],
          hasSpreads: true,
          spreads: ["missing_fragment"],
        },
      ],
      mappings: [{ name: "load", sources: ["src"], targets: ["tgt"] }],
      arrows: [{ mapping: "load", sources: ["full_name"], target: "address" }],
    });
    assert.deepEqual(run(index), []);
  });

  // ── gpt-i1uv differential pair ──────────────────────────────────────────
  //
  // Two mappings with a byte-identical arrow shape (`full_name -> address`),
  // differing only in whether the target schema spreads a fragment declared
  // in the same workspace and fully resolved. The rule must fire for both:
  // a *resolved* spread leaves nothing hidden about the target's field list,
  // so it is not the "incomplete field list" case the skip above exists for.
  // Before the fix, `endpointKind` skipped any schema with `hasSpreads` set —
  // resolved or not — so the with-spread mapping went unreported.

  const differentialPair = (targetHasSpread: boolean) =>
    makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "full_name" }] },
        {
          name: "tgt",
          fields: [{ name: "address", children: [{ name: "line1" }] }],
          ...(targetHasSpread ? { hasSpreads: true, spreads: ["audit_fields"] } : {}),
        },
      ],
      fragments: [{ name: "audit_fields", fields: [{ name: "loaded_at" }] }],
      mappings: [{ name: "load", sources: ["src"], targets: ["tgt"] }],
      arrows: [{ mapping: "load", sources: ["full_name"], target: "address" }],
    });

  it("flags an unenumerated record target with no spread", () => {
    // Control half of the differential pair: same arrow shape as the
    // spread-bearing case below, minus the spread. Establishes the baseline
    // the with-spread case must match once the spread resolves.
    const diags = run(differentialPair(false));
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /targets a record/);
  });

  it("flags an unenumerated record target whose schema spreads a resolved fragment", () => {
    // gpt-i1uv: `tgt` spreads `audit_fields`, which is declared and resolves —
    // the arrow's target path ("address") is a directly-declared field the
    // spread never touches, so a resolved spread elsewhere in the schema must
    // not suppress the diagnostic. Before the fix this reported nothing at
    // all, because `endpointKind` skipped every `hasSpreads` schema outright.
    const diags = run(differentialPair(true));
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /targets a record/);
  });

  it("recommends one arrow per target leaf for a multi-source arrow, not enumeration or a record source", () => {
    // sl-3fou: a multi-source arrow can take neither single-source remedy —
    // spec §4.4 makes its body a transform pipeline, not a nesting scope, so
    // an arrow written inside it (the "enumerate them" fix) is a parse error,
    // and when both sources are scalar lists there is no record among them to
    // map from either. Only "one arrow per target leaf" is something the
    // author can actually write, so the message must say that and only that.
    const index = makeIndex({
      schemas: [
        { name: "src", fields: [{ name: "species_codes" }, { name: "counts" }] },
        {
          name: "tgt",
          fields: [{ name: "observations", children: [{ name: "species" }, { name: "birds" }] }],
        },
      ],
      mappings: [{ name: "load", sources: ["src"], targets: ["tgt"] }],
      arrows: [{ mapping: "load", sources: ["species_codes", "counts"], target: "observations" }],
    });
    const diags = run(index);
    assert.equal(diags.length, 1);
    assert.match(diags[0].message, /one arrow per target leaf/);
    assert.doesNotMatch(diags[0].message, /Enumerate them/);
    assert.doesNotMatch(diags[0].message, /map from a record/);
  });
});

// ── unenumerated-record-target: recommended remedy must actually parse ──────

describe("lint: unenumerated-record-target multi-source remedy parses", () => {
  /**
   * The bug this ticket fixes was a message recommending constructs that do
   * not parse. Asserting the diagnostic's wording is not enough by itself —
   * this proves the *suggested fix* ("one arrow per target leaf") is real
   * Satsuma the parser accepts, using the exact shape from docs/nested-data
   * §5 ("Scalar lists — address the target leaves directly").
   */
  it("parses one arrow per target leaf, the remedy the multi-source message now recommends", async () => {
    const { parseSource } = await import("#src/parser.js");
    const source = `schema tablet_v1_export (format json) {
  transect_ref   STRING(8)       (pk)
  species_codes  list_of STRING
  counts         list_of INT
}

schema portal_transect (format json) {
  ref  STRING(8)

  observations list_of record {
    species  STRING
    birds    INT
  }
}

mapping \`v1 transect observations\` {
  source { tablet_v1_export }
  target { portal_transect }

  transect_ref -> ref
  species_codes -> observations.species
  counts -> observations.birds
}
`;
    const { errorCount } = parseSource(source);
    assert.equal(errorCount, 0);
  });
});

/**
 * field-positions.test.ts — The CLI's field declaration-position rule.
 *
 * Positions matter because downstream UIs turn (file, line) into an editor-jump
 * link. The load-bearing case is a spread-expanded field: its `startRow` is a
 * row in the *fragment's* file, while every command reports the *consuming
 * schema's* file, so naively pairing them produces a precise-looking wrong
 * answer. These tests pin the rule from cbh-5lzd and its inheritance through
 * nesting.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./setup.js";
import { extractSchemas, extractFragments, fieldDeclFromRenderedType } from "@satsuma/core";
import { parseSource } from "../dist/parser.js";
import { buildIndex } from "../dist/index-builder.js";
import { expandEntityFields, expandNestedSpreads } from "../dist/spread-expand.js";
import { fieldDeclarationRow, toCoverageFields } from "../dist/field-positions.js";
import type { ExpandedField } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Synthetic workspace paths. buildIndex only uses them as index keys and as the
// `file` it stamps on records, so no fixture file needs to exist on disk.
const SCHEMA_FILE = resolve(__dirname, "fixtures/positions-a.stm");
const SECOND_FILE = resolve(__dirname, "fixtures/positions-b.stm");

// A consuming schema declared at row 10 of one file — the position a spread
// field must be reported at, per cbh-5lzd.
const CONSUMER = { file: SCHEMA_FILE, row: 10 };

/** Parse Satsuma source to a tree (parseSource also returns src/errorCount). */
function parse(source: string) {
  return parseSource(source).tree;
}

/** A ParsedFile for buildIndex, as loadWorkspace would produce it. */
function parsedFile(filePath: string, source: string) {
  return { filePath, ...parseSource(source) };
}

describe("fieldDeclarationRow()", () => {
  it("reports a schema's own field at its extracted declaration row", () => {
    // The common case: core's extractFieldTree always sets startRow, and it is
    // a row in the same file the command reports, so it passes straight through.
    const field: ExpandedField = fieldDeclFromRenderedType({
      name: "id",
      type: "INT",
      startRow: 12,
    });
    assert.equal(fieldDeclarationRow(field, CONSUMER, false), 12);
  });

  it("reports a spread-expanded field at the consuming schema's row", () => {
    // startRow here is row 3 of the *fragment's* file. Reporting it alongside
    // the consuming schema's file would send a jump link into the wrong file at
    // a plausible-looking line, so the consuming entity's row wins.
    const field: ExpandedField = {
      ...fieldDeclFromRenderedType({ name: "email", type: "STRING", startRow: 3 }),
      fromFragment: "contact",
    };
    assert.equal(fieldDeclarationRow(field, CONSUMER, false), CONSUMER.row);
  });

  it("reports a descendant of a spread field at the consuming schema's row", () => {
    // Only the field copied directly out of the fragment carries fromFragment;
    // its children do not. Without inherited provenance a nested child of a
    // spread record would silently fall back to the fragment's row.
    const child: ExpandedField = fieldDeclFromRenderedType({
      name: "city",
      type: "STRING",
      startRow: 4,
    });
    assert.equal(fieldDeclarationRow(child, CONSUMER, true), CONSUMER.row);
  });

  it("returns undefined when the field carries no position at all", () => {
    // Absence must propagate as absence. Substituting 0 would read as line 1
    // and point a reader at the top of the file (sl-5sjp).
    assert.equal(
      fieldDeclarationRow(fieldDeclFromRenderedType({ name: "id", type: "INT" }), CONSUMER, false),
      undefined,
    );
  });
});

describe("toCoverageFields()", () => {
  it("carries declaration rows through a nested schema's field tree", () => {
    // Positions must survive the projection at every depth: a nested field's
    // row is what a coverage overlay uses to place its marker.
    const source = `schema src {
  id INT
  address record {
    line1 STRING
  }
}`;
    const [schema] = extractSchemas(parse(source).rootNode);
    const projected = toCoverageFields(schema.fields, { file: SCHEMA_FILE, row: schema.row });
    assert.deepEqual(projected, [
      { name: "id", line: 1 },
      // `container` is set from the declared type on every record, not only the
      // empty ones core cannot recognise structurally (ccc-3vaw) — one rule, so
      // the flag cannot be right for `record {}` and missing for `record {…}`.
      { name: "address", line: 2, container: true, children: [{ name: "line1", line: 3 }] },
    ]);
  });

  it("rewrites spread-expanded fields, and only those, to the consuming row", () => {
    // The mixed case that decides whether the rule is applied per-field rather
    // than per-schema: `id` keeps its own row while the spread-in fields move.
    const source = `fragment contact {
  email STRING
  phone STRING
}
schema customer {
  id INT
  ...contact
}`;
    const root = parse(source).rootNode;
    const schema = extractSchemas(root).find((s) => s.name === "customer");
    assert.ok(schema, "expected the customer schema to be extracted");
    const index = buildIndex([parsedFile(SCHEMA_FILE, source)]);
    const fields = [...schema.fields, ...expandEntityFields(schema, null, index)];
    const projected = toCoverageFields(fields, { file: SCHEMA_FILE, row: schema.row });
    assert.deepEqual(projected, [
      // `id` is declared at row 5 of this file, so it keeps its own position.
      { name: "id", line: 5 },
      // `email`/`phone` are declared at rows 1-2 of the *fragment*; both are
      // reported at the consuming schema's header row instead.
      { name: "email", line: schema.row },
      { name: "phone", line: schema.row },
    ]);
  });

  it("rewrites fields spread into a nested record, including their children", () => {
    // Nested spreads expand in place into a record's children, so the
    // provenance flag has to survive one more level of recursion.
    const source = `fragment geo {
  point record {
    lat DECIMAL
  }
}
schema place {
  location record {
    label STRING
    ...geo
  }
}`;
    const root = parse(source).rootNode;
    const schema = extractSchemas(root).find((s) => s.name === "place");
    assert.ok(schema, "expected the place schema to be extracted");
    const index = buildIndex([parsedFile(SCHEMA_FILE, source)]);
    expandNestedSpreads(schema.fields, null, index);
    const projected = toCoverageFields(schema.fields, { file: SCHEMA_FILE, row: schema.row });
    const location = projected[0];
    assert.equal(location.name, "location");
    assert.deepEqual(location.children, [
      // Declared in this file, keeps its own row.
      { name: "label", line: 7 },
      // Spread in from the fragment: the record and its child both report the
      // consuming schema's row rather than rows 1-2 of the fragment.
      {
        name: "point",
        line: schema.row,
        container: true,
        children: [{ name: "lat", line: schema.row }],
      },
    ]);
  });
});

describe("FieldDecl positions through the index", () => {
  it("preserves startRow and startColumn on indexed schema fields", () => {
    // The CLI kept a structural clone of core's FieldDecl that omitted both
    // fields, hiding positions from every command even though the extractor set
    // them (sl-5sjp). This asserts the data survives buildIndex's field merge.
    const source = `schema src {
  id INT
  name STRING
}`;
    const index = buildIndex([parsedFile(SCHEMA_FILE, source)]);
    const schema = index.schemas.get("src");
    assert.ok(schema, "expected schema 'src' in the index");
    assert.deepEqual(
      schema.fields.map((f) => [f.name, f.startRow, f.startColumn]),
      [
        ["id", 1, 2],
        ["name", 2, 2],
      ],
    );
  });

  it("preserves positions on fields merged in from a second file", () => {
    // Satsuma allows splitting a schema across files; mergeFields pushes the
    // second file's field objects into the first's list, and a copy that
    // dropped positions there would be invisible until a jump link misfired.
    const fileA = `schema src {
  id INT
}`;
    const fileB = `schema src {

  extra STRING
}`;
    const index = buildIndex([parsedFile(SCHEMA_FILE, fileA), parsedFile(SECOND_FILE, fileB)]);
    const schema = index.schemas.get("src");
    assert.ok(schema, "expected schema 'src' in the index");
    const extra = schema.fields.find((f) => f.name === "extra");
    assert.equal(extra?.startRow, 2, "row must come from file B, where 'extra' is declared");
  });
});

describe("extracted fragments carry positions too", () => {
  it("sets startRow on fragment fields so spread provenance is detectable", () => {
    // The spread rule exists precisely because fragment fields have real rows
    // in the wrong file. If fragments carried no rows the rule would be moot,
    // so this pins the premise the rule rests on.
    const [fragment] = extractFragments(
      parse(`fragment contact {
  email STRING
}`).rootNode,
    );
    assert.equal(fragment.fields[0]?.startRow, 1);
  });
});

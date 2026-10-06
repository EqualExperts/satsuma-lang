const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeDefinition } = require("../dist/definition");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");
const fs = require("node:fs");
const path = require("node:path");
const { allDescendants, children, extractArrowRecords } = require("@satsuma/core");

before(async () => {
  await initTestParser();
});

/** Build an index from { uri: source } and return { index, trees }. */
function buildIndex(files) {
  const idx = createWorkspaceIndex();
  const trees = {};
  for (const [uri, source] of Object.entries(files)) {
    const tree = parse(source);
    trees[uri] = tree;
    indexFile(idx, uri, tree);
  }
  return { index: idx, trees };
}

/** Shorthand: get definition result at a position in a given file. */
function definition(files, uri, line, col) {
  const { index, trees } = buildIndex(files);
  return computeDefinition(trees[uri], line, col, uri, index);
}

describe("computeDefinition", () => {
  it("returns null for empty files", () => {
    const result = definition({ "file:///a.stm": "" }, "file:///a.stm", 0, 0);
    assert.equal(result, null);
  });

  it("jumps from source ref to schema definition", () => {
    const result = definition(
      {
        "file:///a.stm": `schema customers {
  id UUID (pk)
  name VARCHAR
}
mapping \`test\` {
  source { customers }
  target { dim }
  id -> id
}`,
      },
      "file:///a.stm",
      5,
      12, // cursor on "customers" in source { customers }
    );
    assert.ok(result);
    // Should point to the schema definition
    if (Array.isArray(result)) {
      assert.equal(result[0].uri, "file:///a.stm");
      assert.equal(result[0].range.start.line, 0); // schema is on line 0
    } else {
      assert.equal(result.uri, "file:///a.stm");
      assert.equal(result.range.start.line, 0);
    }
  });

  it("jumps to definition when the cursor sits at the end of the identifier (sl-ogd5)", () => {
    // tree-sitter ranges are half-open: before nodeAtPosition, a cursor
    // immediately after "customers" resolved to the following node and
    // go-to-definition returned null at word end while working mid-word.
    const result = definition(
      {
        "file:///a.stm": `schema customers {
  id UUID (pk)
  name VARCHAR
}
mapping \`test\` {
  source { customers }
  target { dim }
  id -> id
}`,
      },
      "file:///a.stm",
      5,
      20, // cursor immediately after the final "s" of "customers"
    );
    assert.ok(result, "expected a definition at end-of-identifier cursor");
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.uri, "file:///a.stm");
    assert.equal(loc.range.start.line, 0);
  });

  it("jumps from target ref to schema definition", () => {
    const result = definition(
      {
        "file:///a.stm": `schema dim {
  id UUID
}
mapping \`test\` {
  source { src }
  target { dim }
  id -> id
}`,
      },
      "file:///a.stm",
      5,
      12, // cursor on "dim" in target { dim }
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 0);
  });

  it("jumps from fragment spread to fragment definition", () => {
    const result = definition(
      {
        "file:///a.stm": `fragment audit_fields {
  created_at TIMESTAMP
  updated_at TIMESTAMP
}
schema customers {
  id UUID
  ...audit_fields
}`,
      },
      "file:///a.stm",
      6,
      6, // cursor on "audit_fields" in ...audit_fields
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 0); // fragment on line 0
  });

  it("jumps to cross-file definition", () => {
    const result = definition(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}",
        "file:///b.stm":
          "mapping `test` {\n  source { customers }\n  target { dim }\n  id -> id\n}",
      },
      "file:///b.stm",
      1,
      12, // cursor on "customers" in source block
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.uri, "file:///a.stm");
    assert.equal(loc.range.start.line, 0);
  });

  it("jumps to namespaced definition", () => {
    const result = definition(
      {
        "file:///a.stm": `namespace crm {
  schema customers {
    id UUID
  }
}
mapping \`test\` {
  source { crm::customers }
  target { dim }
  id -> id
}`,
      },
      "file:///a.stm",
      6,
      14, // cursor on "crm::customers" in source block
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    // Should point to the schema block_label inside namespace
    assert.equal(loc.range.start.line, 1);
  });

  it("jumps from a ns::`name` source ref to the quoted schema (bsw-iuzs)", () => {
    // Before the grammar accepted a backtick name after ::, this source ref
    // was a syntax error and go-to-definition found nothing. Cursor sits
    // inside the quoted segment, the part a reader clicks.
    const result = definition(
      {
        "file:///a.stm": `namespace raw {
  schema \`crm-contacts\` {
    id INT
  }
}
mapping m {
  source { raw::\`crm-contacts\` }
  target { t }
  id -> id
}`,
      },
      "file:///a.stm",
      6,
      20, // cursor on "crm-contacts" inside raw::`crm-contacts`
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 1);
  });

  it("jumps from a metric's ns::`name` source to the quoted schema (bsw-iuzs)", () => {
    // The metric source is read by core, unquoted, so it resolves like a
    // mapping source does. Before, the raw text kept its backticks and no
    // definition matched.
    const result = definition(
      {
        "file:///a.stm": `namespace raw {
  schema \`crm-contacts\` { id INT }
}
schema rev (metric, source raw::\`crm-contacts\`) { v INT }`,
      },
      "file:///a.stm",
      3,
      35, // cursor on "crm-contacts" inside raw::`crm-contacts`
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 1);
  });

  it("jumps from the item under the cursor in a braced metric source list", () => {
    // A braced list names several schemas; the cursor picks one. Reading the
    // whole value_text as one name resolved none of them.
    const result = definition(
      {
        "file:///a.stm": `schema first { id INT }
schema second { id INT }
schema rev (metric, source {first, second}) { v INT }`,
      },
      "file:///a.stm",
      2,
      36, // cursor on "second"
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 1);
  });

  it("jumps from a multi-word spread to the fragment it names", () => {
    // `...address fields` parses as identifier + continuation_word. The LSP
    // once kept a private copy of spreadLabelText that dropped the second
    // word and looked up "address"; it now uses core's (bsw-iuzs review).
    const result = definition(
      {
        "file:///a.stm": `fragment \`address fields\` { street STRING }
schema s {
  ...address fields
}`,
      },
      "file:///a.stm",
      2,
      14, // cursor on "fields"
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 0);
  });

  it("jumps from block label to its own definition", () => {
    const result = definition(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}",
      },
      "file:///a.stm",
      0,
      8, // cursor on "customers" in block label
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.uri, "file:///a.stm");
  });

  it("returns null for unresolvable reference", () => {
    const result = definition(
      {
        "file:///a.stm":
          "mapping `test` {\n  source { nonexistent }\n  target { dim }\n  id -> id\n}",
      },
      "file:///a.stm",
      1,
      12,
    );
    assert.equal(result, null);
  });

  it("jumps from import name to definition", () => {
    const result = definition(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}",
        "file:///b.stm": 'import { customers } from "a.stm"',
      },
      "file:///b.stm",
      0,
      10, // cursor on "customers" in import
    );
    assert.ok(result);
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.uri, "file:///a.stm");
  });

  it("jumps from arrow source field to schema field definition", () => {
    const result = definition(
      {
        "file:///a.stm": `schema src {
  email VARCHAR(255)
  name VARCHAR
}
schema tgt {
  email_addr VARCHAR
}
mapping \`test\` {
  source { src }
  target { tgt }
  email -> email_addr
}`,
      },
      "file:///a.stm",
      10,
      2, // cursor on "email" in "email -> email_addr"
    );
    assert.ok(result, "Expected definition for arrow source field");
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.uri, "file:///a.stm");
    assert.equal(loc.range.start.line, 1); // email field in src schema
  });

  it("jumps from arrow target field to schema field definition", () => {
    const result = definition(
      {
        "file:///a.stm": `schema src {
  email VARCHAR(255)
}
schema tgt {
  email_addr VARCHAR
}
mapping \`test\` {
  source { src }
  target { tgt }
  email -> email_addr
}`,
      },
      "file:///a.stm",
      9,
      12, // cursor on "email_addr" in "email -> email_addr"
    );
    assert.ok(result, "Expected definition for arrow target field");
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.uri, "file:///a.stm");
    assert.equal(loc.range.start.line, 4); // email_addr field in tgt schema
  });

  it("jumps from an ancestor-escape source path to the field it points at (ADR-053)", () => {
    // The `^.` parent escape pops the `sightings` container, so the field the
    // author reached for is the top-level `transect_ref` — go-to-definition
    // must resolve the path the escape leads to, not the marker itself.
    const result = definition(
      {
        "file:///a.stm": `schema src {
  transect_ref VARCHAR
  sightings list_of record {
    species VARCHAR
  }
}
schema tgt {
  ref VARCHAR
}
mapping \`test\` {
  source { src }
  target { tgt }
  each sightings -> ref {
    ^.transect_ref -> ref
  }
}`,
      },
      "file:///a.stm",
      13,
      7, // cursor on "transect_ref" in "^.transect_ref -> ref"
    );
    assert.ok(result, "Expected definition for ancestor-escape source field");
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.uri, "file:///a.stm");
    assert.equal(loc.range.start.line, 1); // transect_ref field in src schema
  });

  // ── Container-relative arrow paths (bsw-89wr) ──────────────────────────
  //
  // A path inside an each/flatten is resolved against its container, the way
  // extraction resolves it, so go-to-definition lands on the field the arrow
  // actually maps — never on a same-named field elsewhere in the schema.

  const NESTED = `schema src {
  id VARCHAR
  \`tr ref\` VARCHAR
  orders list_of record {
    id VARCHAR
    lines list_of record {
      a record {
        b VARCHAR
      }
    }
  }
}
schema tgt {
  rows list_of record {
    id VARCHAR
    note_text VARCHAR
    lines list_of record {
      x VARCHAR
    }
  }
}
mapping m {
  source { src }
  target { tgt }
  each orders -> rows {
    .id -> .id
    flatten .lines -> .lines {
      ^.^.\`tr ref\` -> .x
      .a.b -> .x
    }
  }
}`;

  /** The single location go-to-definition returns at a point in NESTED. */
  function nestedDefinition(line, col) {
    const result = definition({ "file:///a.stm": NESTED }, "file:///a.stm", line, col);
    assert.ok(result, "expected a definition");
    return Array.isArray(result) ? result[0] : result;
  }

  it("jumps from a relative source path to its container's field, not the top-level namesake", () => {
    // `.id` inside `each orders` is `orders.id` (line 4), not `id` (line 1).
    assert.equal(nestedDefinition(25, 5).range.start.line, 4);
  });

  it("jumps from a relative target path to the target container's field", () => {
    // `.id` on the right is `rows.id` in tgt (line 14).
    assert.equal(nestedDefinition(25, 12).range.start.line, 14);
  });

  it("jumps from a two-level ^. escape to the unquoted top-level backtick field", () => {
    // `^.^.` from inside each → flatten returns to the schema root, and the
    // backtick segment must match `tr ref` without its quotes (line 2).
    assert.equal(nestedDefinition(27, 12).range.start.line, 2);
  });

  it("jumps to the segment under the cursor in a multi-segment relative path", () => {
    // `.a.b` under orders.lines: `a` is the record (line 6), `b` its child (line 7).
    assert.equal(nestedDefinition(28, 7).range.start.line, 6);
    assert.equal(nestedDefinition(28, 9).range.start.line, 7);
  });

  it("treats a container-relative first segment as a field even when it shares a schema's name", () => {
    // `src.x` inside `each orders` names the record orders.src (line 3); only
    // at mapping-body level is `src` the schema prefix (line 0).
    const source = `schema src {
  x UUID
  orders list_of record {
    src record {
      x UUID
    }
  }
}
schema tgt {
  z UUID
  out list_of record {
    y UUID
  }
}
mapping m {
  source { src }
  target { tgt }
  each orders -> out {
    src.x -> y
  }
  src.x -> z
}`;
    const at = (line, col) => {
      const result = definition({ "file:///a.stm": source }, "file:///a.stm", line, col);
      assert.ok(result, "expected a definition");
      return (Array.isArray(result) ? result[0] : result).range.start.line;
    };
    assert.equal(at(18, 4), 3);
    assert.equal(at(20, 2), 0);
  });

  it("jumps to a field a fragment spreads into a record, in the fragment's file", () => {
    // The field is declared in the fragment, so that is where the jump lands.
    const result = definition(
      {
        "file:///a.stm": `schema src {
  orders list_of record {
    ...audit
  }
}
schema tgt {
  rows list_of record {
    by VARCHAR
  }
}
mapping m {
  source { src }
  target { tgt }
  each orders -> rows {
    .created_by -> .by
  }
}`,
        "file:///b.stm": `fragment audit {
  created_by VARCHAR
}`,
      },
      "file:///a.stm",
      14,
      6,
    );
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc?.uri, "file:///b.stm");
    assert.equal(loc?.range.start.line, 1);
  });

  it("jumps from @ref in NL string to block definition", () => {
    // Line 6: "  -> display { "Look up @customers table" }"
    const result = definition(
      {
        "file:///a.stm": `schema customers {
  id UUID
}
mapping \`test\` {
  source { customers }
  target { dim }
  -> display { "Look up @customers table" }
}`,
      },
      "file:///a.stm",
      6,
      25, // cursor inside @customers
    );
    assert.ok(result, "Expected definition for @ref");
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 0); // schema customers on line 0
  });

  it("jumps from @ref in NL string to schema field", () => {
    // Line 7: "  -> full_name { "Concat @customer_id with name" }"
    const result = definition(
      {
        "file:///a.stm": `schema src {
  customer_id UUID (pk)
  name VARCHAR
}
mapping \`test\` {
  source { src }
  target { dim }
  -> full_name { "Concat @customer_id with name" }
}`,
      },
      "file:///a.stm",
      7,
      26, // cursor inside @customer_id
    );
    assert.ok(result, "Expected definition for @ref field");
    const loc = Array.isArray(result) ? result[0] : result;
    assert.equal(loc.range.start.line, 1); // customer_id field on line 1
  });
});

describe("go-to-definition on every container-relative path in the example corpus (bsw-89wr)", () => {
  // Ground truth is extraction: whatever field extractArrowRecords says an
  // arrow maps, go-to-definition on that path must land on its declaration.
  // Before bsw-89wr every relative `.field` path here returned null.
  const EXAMPLES = ["top-level-dotted-each/pipeline.stm", "nested-iteration/pipeline.stm"];
  const PATH_FORMS = new Set(["relative_field_path", "parent_path", "root_path"]);

  /** Map of declaration line → dotted field path, over every schema's fields. */
  function declaredPathsByLine(index) {
    const byLine = new Map();
    const walk = (fields, prefix) => {
      for (const f of fields) {
        const p = [...prefix, f.name];
        byLine.set(f.range.start.line, p.join("."));
        walk(f.children, p);
      }
    };
    for (const [schema, defs] of index.definitions) {
      for (const def of defs) walk(def.fields, [schema]);
    }
    return byLine;
  }

  for (const example of EXAMPLES) {
    it(`examples/${example}`, () => {
      const uri = "file:///corpus.stm";
      const source = fs.readFileSync(path.resolve(__dirname, "../../../examples", example), "utf8");
      const { index, trees } = buildIndex({ [uri]: source });
      const tree = trees[uri];
      const records = new Map(
        extractArrowRecords(tree.rootNode).map((r) => [`${r.line}:${r.startColumn}`, r]),
      );
      const declared = declaredPathsByLine(index);
      const mappingSide = { src_path: "src", tgt_path: "tgt" };

      let checked = 0;
      for (const pathNode of [
        ...allDescendants(tree.rootNode, "src_path"),
        ...allDescendants(tree.rootNode, "tgt_path"),
      ]) {
        if (!PATH_FORMS.has(pathNode.namedChildren[0]?.type)) continue;
        const arrow = pathNode.parent;
        const record = records.get(`${arrow.startPosition.row}:${arrow.startPosition.column}`);
        const expected =
          pathNode.type === "tgt_path"
            ? record.target
            : record.sources[children(arrow, "src_path").findIndex((n) => n.equals(pathNode))];

        const end = pathNode.endPosition;
        const result = computeDefinition(tree, end.row, end.column - 1, uri, index);
        const where = `${pathNode.text} at line ${end.row + 1}`;
        assert.ok(result, `no definition for ${where}`);
        const loc = Array.isArray(result) ? result[0] : result;
        const landed = declared.get(loc.range.start.line) ?? "";
        // `landed` is `<schema>.<path>`; extraction's path may or may not carry
        // the schema prefix (a schema-form flatten adds it), so compare both.
        const landedLocal = landed.slice(landed.indexOf(".") + 1);
        assert.ok(
          landed === expected || landedLocal === expected,
          `${where} landed on ${landed}, extraction says ${expected} (${mappingSide[pathNode.type]})`,
        );
        checked++;
      }
      assert.ok(checked > 0, "the example must exercise at least one container-relative path");
    });
  }
});

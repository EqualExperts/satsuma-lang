const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeCompletions } = require("../dist/completion");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");

before(async () => { await initTestParser(); });

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

/** Get completions at a position. */
function complete(files, uri, line, col) {
  const { index, trees } = buildIndex(files);
  return computeCompletions(trees[uri], line, col, uri, index);
}

describe("computeCompletions", () => {
  it("returns empty for empty files", () => {
    const items = complete({ "file:///a.stm": "" }, "file:///a.stm", 0, 0);
    assert.equal(items.length, 0);
  });

  it("suggests schema names inside source block", () => {
    const items = complete(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}\nschema orders {\n  id UUID\n}",
        "file:///b.stm": "mapping `test` {\n  source { c }\n  target { dim }\n  id -> id\n}",
      },
      "file:///b.stm",
      1,
      12, // cursor inside source { }
    );
    assert.ok(items.length >= 2);
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("customers"));
    assert.ok(labels.includes("orders"));
    // All should be Class kind
    assert.ok(items.every((i) => i.kind === 7)); // CompletionItemKind.Class = 7
  });

  it("suggests schema names inside target block", () => {
    const items = complete(
      {
        "file:///a.stm": "schema dim_customers {\n  id UUID\n}",
        "file:///b.stm": "mapping `test` {\n  source { src }\n  target { d }\n  id -> id\n}",
      },
      "file:///b.stm",
      2,
      12, // cursor inside target { }
    );
    assert.ok(items.some((i) => i.label === "dim_customers"));
  });

  it("suggests fragments and transforms after spread", () => {
    const items = complete(
      {
        "file:///a.stm": `fragment audit_fields {
  ts TIMESTAMP
}
transform \`clean email\` {
  trim | lowercase
}
schema customers {
  id UUID
  ...a
}`,
      },
      "file:///a.stm",
      8,
      5, // cursor inside the spread
    );
    assert.ok(items.some((i) => i.label === "audit_fields"));
    assert.ok(items.some((i) => i.label === "clean email"));
  });

  it("suggests metadata tokens inside parentheses", () => {
    const items = complete(
      {
        "file:///a.stm": "schema test {\n  id UUID (p)\n}",
      },
      "file:///a.stm",
      1,
      12, // cursor inside (p)
    );
    assert.ok(items.length > 10);
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("pk"));
    assert.ok(labels.includes("required"));
    assert.ok(labels.includes("pii"));
    assert.ok(labels.includes("scd"));
    // All should be Keyword kind
    assert.ok(items.every((i) => i.kind === 14)); // CompletionItemKind.Keyword = 14
  });

  it("suggests transform functions inside an empty arrow body", () => {
    // sl-0tgo: the old check tested for "_arrow_transform_body", a hidden
    // grammar rule that never surfaces as a node type, so the branch was
    // unreachable. `a -> b {  }` parses as a nested_arrow with no
    // declarations and the cursor lands on the nested_arrow node itself —
    // the user just opened a transform body and expects pipe functions.
    const items = complete(
      {
        "file:///a.stm": "mapping m {\n  source { s }\n  target { t }\n  a -> b {  }\n}",
      },
      "file:///a.stm",
      3,
      11, // cursor between the empty braces
    );
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("trim"), "expected pipe-function completions in empty arrow body");
  });

  it("suggests transform functions in pipe chain", () => {
    const items = complete(
      {
        "file:///a.stm": "transform `clean` {\n  trim | lowercase\n}",
      },
      "file:///a.stm",
      1,
      10, // cursor on "lowercase" in pipe chain
    );
    assert.ok(items.length > 5);
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("trim"));
    assert.ok(labels.includes("lowercase"));
    assert.ok(labels.includes("coalesce"));
    assert.ok(labels.includes("null_if_empty"));
  });

  it("suggests block names in import declaration", () => {
    const items = complete(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}\nfragment audit {\n  ts TIMESTAMP\n}",
        "file:///b.stm": 'import { c } from "a.stm"',
      },
      "file:///b.stm",
      0,
      10, // cursor inside import { }
    );
    assert.ok(items.some((i) => i.label === "customers"));
    assert.ok(items.some((i) => i.label === "audit"));
  });

  it("suggests fields from source schemas in arrow paths", () => {
    const items = complete(
      {
        "file:///a.stm": `schema customers {
  id UUID (pk)
  name VARCHAR
  email VARCHAR
}
mapping \`test\` {
  source { customers }
  target { dim }
  name -> name
}`,
      },
      "file:///a.stm",
      8,
      3, // cursor on "name" in src_path of arrow
    );
    // Should suggest fields from customers schema
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("id"));
    assert.ok(labels.includes("name"));
    assert.ok(labels.includes("email"));
  });

  it("returns empty for comment context", () => {
    const items = complete(
      {
        "file:///a.stm": "// this is a comment\nschema test {\n  id UUID\n}",
      },
      "file:///a.stm",
      0,
      5, // cursor inside comment
    );
    assert.equal(items.length, 0);
  });

  // ── Additional source/target/pipe/metadata coverage ─────────────────────────

  it("source block completions include schemas defined in other workspace files", () => {
    // Verifies cross-file workspace indexing reaches the source-block context.
    const items = complete(
      {
        "file:///defs.stm": "schema customers { id UUID }\nschema orders { id UUID }",
        "file:///b.stm": "mapping `m` {\n  source { x }\n  target { y }\n  id -> id\n}",
      },
      "file:///b.stm",
      1,
      12,
    );
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("customers"));
    assert.ok(labels.includes("orders"));
  });

  it("target block completions exclude fragments and transforms", () => {
    // Source/target only allow schema names — fragments and transforms must
    // not appear or the user will pick a non-schema and produce broken mapping.
    const items = complete(
      {
        "file:///a.stm":
          "fragment audit { ts TIMESTAMP }\n" +
          "transform `clean` { trim }\n" +
          "schema dim { id UUID }\n" +
          "mapping `m` { source { dim } target { d } id -> id }",
      },
      "file:///a.stm",
      3,
      35, // cursor inside target { d }
    );
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("dim"));
    assert.ok(!labels.includes("audit"), "fragment must not appear in target block");
    assert.ok(!labels.includes("clean"), "transform must not appear in target block");
  });

  it("pipe chain completions are not contaminated by schema names", () => {
    // Pipe chains list transform functions only — surfacing schemas here would
    // be confusing because schemas are not callable in a pipe.
    const items = complete(
      {
        "file:///a.stm":
          "schema customers { id UUID }\ntransform `clean` {\n  trim | lowercase\n}",
      },
      "file:///a.stm",
      2,
      10,
    );
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("trim"), "expected pipe-chain context to surface transform functions");
    assert.ok(!labels.includes("customers"), "schema names must not leak into pipe completions");
  });

  it("metadata completions surface SCD subkinds, not just top-level tags", () => {
    // The metadata vocabulary includes SCD-typing keywords such as `scd`; the
    // user must be able to discover them in a single completion popup.
    const items = complete(
      { "file:///a.stm": "schema dim {\n  id UUID (s)\n}" },
      "file:///a.stm",
      1,
      12,
    );
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes("scd"));
    assert.ok(labels.includes("required"));
  });

  // ── Namespace/import contexts ────────────────────────────────────────────────

  it("import-name completions include schemas from the target file's namespace", () => {
    // The import { … } completion list is built from the union of indexed
    // block names; namespace-qualified blocks should be discoverable too.
    const items = complete(
      {
        "file:///defs.stm":
          "namespace crm {\n  schema customers { id UUID }\n}\n",
        "file:///entry.stm": 'import { c } from "defs.stm"',
      },
      "file:///entry.stm",
      0,
      10,
    );
    const labels = items.map((i) => i.label);
    // Either "customers" or the qualified "crm::customers" must be offered.
    assert.ok(
      labels.some((l) => l === "customers" || l === "crm::customers"),
      "namespace-qualified schema must be discoverable in import completions",
    );
  });

  it("arrow target completions surface fields from the target schema", () => {
    // Symmetric to the existing arrow_source test — covers the tgt_path branch
    // of detectCompletionContext.
    const items = complete(
      {
        "file:///a.stm":
          `schema src {
  id UUID
  name VARCHAR
}
schema dim {
  id UUID
  label VARCHAR
}
mapping \`m\` {
  source { src }
  target { dim }
  name -> label
}`,
      },
      "file:///a.stm",
      11,
      11, // cursor inside "label" of the tgt_path on the arrow line
    );
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.includes("label") || labels.includes("id"),
      "target field completion should include fields from the dim schema",
    );
  });

  it("source-block schema completions tag every item with the Class kind", () => {
    // Clients filter completions by kind (icon, ranking). All schema-context
    // entries must carry CompletionItemKind.Class (= 7) regardless of which
    // file the schema came from.
    const items = complete(
      {
        "file:///defs.stm": "schema customers { id UUID }\nschema orders { id UUID }",
        "file:///b.stm": "mapping `m` {\n  source { x }\n  target { y }\n  id -> id\n}",
      },
      "file:///b.stm",
      1,
      12,
    );
    assert.ok(items.length >= 2);
    assert.ok(items.every((i) => i.kind === 7), "every schema completion must use CompletionItemKind.Class");
  });

  // ── MISSING-node (parser recovery) cases ─────────────────────────────────────

  it("does not crash on completions inside an unterminated source block (MISSING-node tree)", () => {
    // The user is mid-typing — the closing brace of source { is missing, so
    // tree-sitter recovers a MISSING node. The handler must return an array
    // (possibly empty) without throwing — the edit-time UX must never be
    // blocked by transient parse errors.
    let items;
    assert.doesNotThrow(() => {
      items = complete(
        {
          "file:///a.stm": "schema customers { id UUID }\nschema orders { id UUID }",
          "file:///b.stm": "mapping `m` {\n  source { c",
        },
        "file:///b.stm",
        1,
        11,
      );
    });
    assert.ok(Array.isArray(items));
  });

  it("does not crash on completions when a metadata closing paren is missing", () => {
    // Recovered tree from `id UUID (p` — the parser inserts a MISSING `)`.
    // The completion context detector walks the cursor's ancestors and must
    // gracefully return an array even if the surrounding production is broken.
    let items;
    assert.doesNotThrow(() => {
      items = complete(
        { "file:///a.stm": "schema test {\n  id UUID (p\n}" },
        "file:///a.stm",
        1,
        12,
      );
    });
    assert.ok(Array.isArray(items));
  });
});

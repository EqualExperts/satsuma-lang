const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeReferences } = require("../dist/references");
const { createWorkspaceIndex, indexFile } = require("../dist/workspace-index");

before(async () => {
  await initTestParser();
});

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

/** Get references at a position, with or without declaration. */
function refs(files, uri, line, col, includeDecl = false) {
  const { index, trees } = buildIndex(files);
  return computeReferences(trees[uri], line, col, uri, index, includeDecl);
}

describe("computeReferences", () => {
  it("returns empty for empty files", () => {
    const result = refs({ "file:///a.stm": "" }, "file:///a.stm", 0, 0);
    assert.equal(result.length, 0);
  });

  it("finds references to a schema from source blocks", () => {
    const result = refs(
      {
        "file:///a.stm": `schema customers {
  id UUID
}
mapping \`a\` {
  source { customers }
  target { dim }
  id -> id
}`,
      },
      "file:///a.stm",
      0,
      8, // cursor on "customers" in schema definition
      false,
    );
    assert.equal(result.length, 1); // one reference in source block
    assert.equal(result[0].uri, "file:///a.stm");
  });

  it("includes declaration when requested", () => {
    const result = refs(
      {
        "file:///a.stm": `schema customers {
  id UUID
}
mapping \`a\` {
  source { customers }
  target { dim }
  id -> id
}`,
      },
      "file:///a.stm",
      0,
      8, // cursor on "customers" definition
      true,
    );
    // 1 reference + 1 declaration
    assert.equal(result.length, 2);
  });

  it("finds references across multiple files", () => {
    const result = refs(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}",
        "file:///b.stm": "mapping `a` {\n  source { customers }\n  target { d }\n  id -> id\n}",
        "file:///c.stm": "mapping `b` {\n  source { customers }\n  target { e }\n  id -> id\n}",
      },
      "file:///a.stm",
      0,
      8, // cursor on "customers" definition
      false,
    );
    assert.equal(result.length, 2); // one ref in b.stm, one in c.stm
    const uris = result.map((r) => r.uri).sort();
    assert.deepEqual(uris, ["file:///b.stm", "file:///c.stm"]);
  });

  it("finds fragment spread references", () => {
    const result = refs(
      {
        "file:///a.stm": `fragment audit_fields {
  ts TIMESTAMP
}
schema customers {
  id UUID
  ...audit_fields
}
schema orders {
  id UUID
  ...audit_fields
}`,
      },
      "file:///a.stm",
      0,
      10, // cursor on "audit_fields" in fragment definition
      false,
    );
    assert.equal(result.length, 2); // two spread references
  });

  it("finds references from a reference site (not just definitions)", () => {
    const result = refs(
      {
        "file:///a.stm": `schema customers {
  id UUID
}
mapping \`a\` {
  source { customers }
  target { dim }
  id -> id
}
mapping \`b\` {
  source { customers }
  target { fact }
  id -> id
}`,
      },
      "file:///a.stm",
      4,
      12, // cursor on "customers" in source block of mapping \`a\`
      false,
    );
    // Should find both source block references
    assert.equal(result.length, 2);
  });

  it("returns empty for unreferenced symbol", () => {
    const result = refs(
      {
        "file:///a.stm": "schema lonely {\n  id UUID\n}",
      },
      "file:///a.stm",
      0,
      8,
      false,
    );
    assert.equal(result.length, 0);
  });

  it("finds arrow field references for a schema field", () => {
    const src = `schema customers {
  id UUID
  email VARCHAR
}
mapping \`a\` {
  source { customers }
  target { dim }
  email -> contact_email
}`;
    // Cursor on "email" in schema definition (line 2, col 2)
    const result = refs({ "file:///a.stm": src }, "file:///a.stm", 2, 3, false);
    // Should include the arrow src_path reference
    assert.ok(result.length >= 1, "expected at least one reference from arrow field path");
    // Check that at least one result points to the arrow line
    const arrowRef = result.find((r) => r.range.start.line === 7);
    assert.ok(arrowRef, "expected a reference on the arrow line (line 7)");
  });

  it("finds @ref references in NL strings for a schema", () => {
    const src = `schema customers {
  id UUID
}
mapping \`a\` {
  source { customers }
  target { dim }
  -> name { "Use data from @customers table" }
}`;
    // Cursor on "customers" in schema definition (line 0, col 8)
    const result = refs({ "file:///a.stm": src }, "file:///a.stm", 0, 8, false);
    // Should include: source block ref + @ref in NL string
    assert.ok(result.length >= 2, `expected at least 2 references, got ${result.length}`);
  });

  it("finds import references", () => {
    const result = refs(
      {
        "file:///a.stm": "schema customers {\n  id UUID\n}",
        "file:///b.stm":
          'import { customers } from "a.stm"\nmapping x {\n  source { customers }\n  target { d }\n  id -> id\n}',
      },
      "file:///a.stm",
      0,
      8, // cursor on "customers" definition
      false,
    );
    // import ref + source ref
    assert.equal(result.length, 2);
  });
});

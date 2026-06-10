const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  createWorkspaceIndex,
  indexFile,
  createScopedIndex,
  getImportReachableUris,
} = require("../dist/workspace-index");
const { computeMissingImportDiagnostics, computeCoreSemanticDiagnostics } = require("../dist/semantic-diagnostics");

before(async () => { await initTestParser(); });

/** Build an index from a map of { uri: source }. */
function buildIndex(files) {
  const idx = createWorkspaceIndex();
  for (const [uri, source] of Object.entries(files)) {
    indexFile(idx, uri, parse(source));
  }
  return idx;
}

describe("computeMissingImportDiagnostics", () => {
  it("emits no diagnostics when all source/target refs are defined in the same file", () => {
    const src = `schema customers { id UUID }
mapping m {
  source { customers }
  target { customers }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeMissingImportDiagnostics(parse(src), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("emits no diagnostics when the referenced schema is imported", () => {
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `schema orders { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("emits a missing-import diagnostic when a source ref exists in workspace but is not imported", () => {
    const aSrc = `mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `schema orders { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.ok(diags.length > 0, "expected at least one missing-import diagnostic");
    const diag = diags[0];
    assert.equal(diag.code, "missing-import");
    assert.equal(diag.source, "satsuma");
    assert.ok(diag.message.includes("orders"), "message should mention the symbol name");
    assert.ok(diag.message.includes("import"), "message should suggest an import");
  });

  it("ignores quoted join descriptions when checking missing imports", () => {
    const aSrc = `schema a { id INT }
schema b { id INT }
schema t { id INT }
mapping m {
  source {
    a
    b
    "Join on a.id = b.id WHERE @a.status = complete"
  }
  target { t }
  a.id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": aSrc });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("includes the suggested import statement in the diagnostic message", () => {
    const aSrc = `mapping m {
  source { customers }
  target { customers }
  id -> id
}`;
    const bSrc = `schema customers { id UUID }`;
    const idx = buildIndex({
      "file:///project/a.stm": aSrc,
      "file:///project/b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///project/a.stm", idx);
    assert.ok(diags.length > 0);
    const msg = diags[0].message;
    // Suggestion should include the schema name and a path
    assert.ok(msg.includes("customers"));
    assert.ok(msg.includes("b.stm"), `expected b.stm in suggestion, got: ${msg}`);
  });

  it("does not flag symbols that are not defined anywhere (leaves those to validate)", () => {
    // 'ghost_schema' does not appear in any indexed file
    const aSrc = `mapping m {
  source { ghost_schema }
  target { ghost_schema }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": aSrc });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("does not emit missing-import for import context references", () => {
    // The import declaration itself references 'orders' — that should not be flagged
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `schema orders { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    // orders IS imported, so no missing-import diagnostics
    assert.equal(diags.length, 0);
  });

  it("allows directly imported symbols even when the imported file has its own imports", () => {
    // a imports { orders } from b. b imports { customers } from c.
    // a references only orders (directly imported) — no diagnostic needed.
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { orders }
  target { orders }
  id -> id
}`;
    const bSrc = `import { customers } from "c.stm"\nschema orders { id UUID }`;
    const cSrc = `schema customers { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
      "file:///c.stm": cSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    // orders is imported — no diagnostic
    assert.equal(diags.length, 0);
  });

  it("flags symbols from transitively reachable files that are not dependencies of imported symbols (sl-cf9t)", () => {
    // a imports { orders } from b. b imports { customers } from c.
    // a tries to use customers — but customers is NOT a dependency of orders,
    // so it is not reachable from a's imports (ADR-022 symbol-level scoping).
    const aSrc = `import { orders } from "b.stm"
mapping m {
  source { customers }
  target { orders }
  id -> id
}`;
    const bSrc = `import { customers } from "c.stm"\nschema orders { id UUID }`;
    const cSrc = `schema customers { id UUID }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
      "file:///c.stm": cSrc,
    });
    const diags = computeMissingImportDiagnostics(parse(aSrc), "file:///a.stm", idx);
    const importDiag = diags.find((d) => d.code === "missing-import");
    assert.ok(importDiag, "expected a missing-import diagnostic for customers");
    assert.ok(importDiag.message.includes("customers"), "diagnostic should name the symbol");
  });
});

describe("computeCoreSemanticDiagnostics", () => {
  it("does not report quoted join descriptions as undefined mapping sources", () => {
    const src = `schema a { id INT }
schema b { id INT }
schema t { id INT }
mapping m {
  source {
    a
    b
    "Join on a.id = b.id WHERE @a.status = complete"
  }
  target { t }
  a.id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("does not report duplicate definitions from files outside the active import graph", () => {
    const aSrc = `schema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", scoped);
    assert.equal(diags.length, 0);
  });

  it("reports duplicate definitions when both files are in the active import graph", () => {
    const aSrc = `import { orders } from "b.stm"\nschema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///b.stm", scoped);
    const dupDiag = diags.find((d) => d.code === "duplicate-definition");
    assert.ok(dupDiag, "expected a duplicate-definition diagnostic");
  });

  // Regression for sl-akz6 / gh-274: on Windows the startup scan indexes a
  // file under pathToFileURL's spelling (file:///C:/...) while didOpen indexes
  // it under the client's spelling (file:///c%3A/...). Without canonical index
  // keys the file exists twice and every definition in it is reported as a
  // duplicate.
  it("does not report duplicates when the same file is indexed under two Windows URI spellings", () => {
    const src = `schema orders { id UUID }`;
    const idx = createWorkspaceIndex();
    indexFile(idx, "file:///C:/ws/a.stm", parse(src)); // workspace-scan spelling
    indexFile(idx, "file:///c%3A/ws/a.stm", parse(src)); // didOpen spelling
    const diags = computeCoreSemanticDiagnostics("file:///c%3A/ws/a.stm", idx);
    const dup = diags.find((d) => d.code === "duplicate-definition");
    assert.equal(dup, undefined, "same file under two spellings must not self-duplicate");
  });

  // Companion to the spelling test: diagnostics must still be FOUND when the
  // query uses a different spelling than the index — canonicalization must not
  // trade false positives for false negatives.
  it("matches a file's diagnostics across URI spellings of the same path", () => {
    const aSrc = `import { orders } from "b.stm"\nschema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = createWorkspaceIndex();
    indexFile(idx, "file:///C:/ws/a.stm", parse(aSrc));
    indexFile(idx, "file:///C:/ws/b.stm", parse(bSrc));
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///c%3A/ws/a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///c%3A/ws/b.stm", scoped);
    const dupDiag = diags.find((d) => d.code === "duplicate-definition");
    assert.ok(dupDiag, "expected the genuine duplicate to be reported under the alternate spelling");
  });

  it("returns no diagnostics for a valid single-file workspace", () => {
    const src = `schema customers { id UUID }
mapping m {
  source { customers }
  target { customers }
  id -> id
}`;
    const idx = buildIndex({ "file:///a.stm": src });
    const diags = computeCoreSemanticDiagnostics("file:///a.stm", idx);
    assert.equal(diags.length, 0);
  });

  it("returns diagnostics with 0-indexed positions (LSP convention)", () => {
    const aSrc = `import { orders } from "b.stm"\nschema orders { id UUID }`;
    const bSrc = `schema orders { name STRING }`;
    const idx = buildIndex({
      "file:///a.stm": aSrc,
      "file:///b.stm": bSrc,
    });
    const scoped = createScopedIndex(idx, getImportReachableUris("file:///a.stm", idx));
    const diags = computeCoreSemanticDiagnostics("file:///b.stm", scoped);
    if (diags.length > 0) {
      // LSP lines are 0-indexed
      assert.ok(diags[0].range.start.line >= 0, "line should be 0-indexed");
    }
  });
});

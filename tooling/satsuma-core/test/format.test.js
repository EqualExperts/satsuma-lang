/**
 * format.test.js — Unit tests for the core formatter.
 *
 * Tests cover:
 * - Idempotency: format(format(x)) === format(x) for all corpus files
 * - Structural equivalence: parse tree is preserved after formatting
 * - Specific formatting rules: alignment, comments, blank lines, etc.
 *
 * The formatter is a pure function (Tree + source → string) with no I/O.
 * These tests live in satsuma-core because the implementation is here;
 * CLI-specific concerns (stdin, --diff, exit codes) are tested separately.
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, initParser, getParser } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the grammar WASM — committed artifact, no build needed for tests.
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");
const examplesDir = join(__dirname, "../../../examples");

// Initialise the WASM parser once before all tests.
before(async () => {
  await initParser(WASM_PATH);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse source text and return { tree, errorCount } without file I/O. */
function parseSource(src) {
  const parser = getParser();
  const tree = parser.parse(src);
  if (!tree) throw new Error("parse returned null");
  function countErrors(node) {
    let n = node.type === "ERROR" ? 1 : 0;
    for (const c of node.namedChildren) n += countErrors(c);
    return n;
  }
  return { tree, errorCount: countErrors(tree.rootNode) };
}

function fmt(src) {
  const { tree } = parseSource(src);
  return format(tree, src);
}

function structureOf(node) {
  if (node.childCount === 0) {
    if (node.isNamed) return node.type + "=" + JSON.stringify(node.text);
    return null;
  }
  const kids = [];
  for (const c of node.children) {
    const s = structureOf(c);
    if (s !== null) kids.push(s);
  }
  return node.type + "(" + kids.join(",") + ")";
}

// ── Corpus Round-Trip (Idempotency + Structural Equivalence) ─────────────────

describe("corpus round-trip", () => {
  const stmFiles = readdirSync(examplesDir, { recursive: true }).filter(f => f.endsWith(".stm"));

  for (const file of stmFiles) {
    describe(`examples/${file}`, () => {
      const src = readFileSync(join(examplesDir, file), "utf8");

      it("is idempotent", () => {
        const out1 = fmt(src);
        const out2 = fmt(out1);
        assert.equal(out1, out2, "format(format(x)) should equal format(x)");
      });

      it("preserves parse tree structure", () => {
        const { tree: tree1 } = parseSource(src);
        const out = fmt(src);
        const { tree: tree2 } = parseSource(out);
        assert.equal(
          structureOf(tree1.rootNode),
          structureOf(tree2.rootNode),
          "parse trees should be structurally identical"
        );
      });
    });
  }
});

// ── Field Alignment ──────────────────────────────────────────────────────────

describe("field alignment", () => {
  it("aligns name and type columns based on max widths", () => {
    const src = `schema test {
  id INT (pk)
  long_name STRING
}`;
    const out = fmt(src);
    const lines = out.split("\n");
    // max_name = 9 ("long_name"), type_col = 11
    assert.match(lines[1], /^ {2}id {9}INT/);
    assert.match(lines[2], /^ {2}long_name {2}STRING/);
  });

  it("aligns metadata column", () => {
    const src = `schema test {
      alpha2 STRING(2) (pk)
      name STRING(100)
    }`;
    const out = fmt(src);
    const lines = out.split("\n");
    assert.match(lines[1], /^ {2}alpha2 {2}STRING\(2\)\s+\(pk\)/);
  });

  it("does not align multi-line record fields", () => {
    const src = `schema test {
  id INT (pk)
  addr record {
    line1 STRING
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("addr record {"), "record field should use minimal spacing");
  });

  it("handles fragment spreads as non-aligned standalone lines", () => {
    const src = `schema test {
  id INT (pk)
  ...\`audit fields\`
}`;
    const out = fmt(src);
    assert.ok(out.includes("  ...`audit fields`"), "spread should be at block indent");
  });
});

// ── Comments ─────────────────────────────────────────────────────────────────

describe("comments", () => {
  it("preserves all three comment types", () => {
    const src = `// regular
//! warning
//? question
schema test {
  x INT
}`;
    const out = fmt(src);
    assert.ok(out.includes("// regular"));
    assert.ok(out.includes("//! warning"));
    assert.ok(out.includes("//? question"));
  });

  it("normalizes space after comment marker", () => {
    const src = `//no space
//!no space
//?no space
schema test { x INT }`;
    const out = fmt(src);
    assert.ok(out.includes("// no space"));
    assert.ok(out.includes("//! no space"));
    assert.ok(out.includes("//? no space"));
  });

  it("preserves section-header comments as-is", () => {
    const src = `schema a { x INT }

// --- Section ---

schema b { y STRING }`;
    const out = fmt(src);
    assert.ok(out.includes("// --- Section ---"));
  });

  it("preserves trailing inline comments", () => {
    const src = `schema test {
  x INT  // trailing comment
  y STRING
}`;
    const out = fmt(src);
    assert.ok(out.includes("INT") && out.includes("// trailing comment"));
    // Check 2-space minimum gap
    const line = out.split("\n").find(l => l.includes("trailing comment"));
    assert.ok(line);
    assert.match(line, /\S {2}\/\/ trailing comment/);
  });
});

// ── Block-Level Comment Preservation ────────────────────────────────────────
// Tree-sitter places comments that appear between `{` and the body node as
// children of the block, not the body.  The formatter must collect these
// "gap comments" so they are not silently dropped.

describe("block-level comment preservation", () => {
  it("preserves the first comment in a schema body (sl-h3tu)", () => {
    const src = `schema test {
  //! Data quality warning
  a STRING
  //! Second warning
  b STRING
}`;
    const out = fmt(src);
    assert.ok(out.includes("//! Data quality warning"), "first comment before first field must be preserved");
    assert.ok(out.includes("//! Second warning"), "mid-body comment must also be preserved");
  });

  it("preserves all three comment types as first child in schema body", () => {
    const src1 = `schema a {
  // regular first
  x INT
}`;
    const src2 = `schema b {
  //! warning first
  x INT
}`;
    const src3 = `schema c {
  //? question first
  x INT
}`;
    assert.ok(fmt(src1).includes("// regular first"));
    assert.ok(fmt(src2).includes("//! warning first"));
    assert.ok(fmt(src3).includes("//? question first"));
  });

  it("preserves the first comment in a fragment body", () => {
    const src = `fragment audit_fields {
  // Audit trail columns
  created_at TIMESTAMP
}`;
    const out = fmt(src);
    assert.ok(out.includes("// Audit trail columns"));
  });

  it("preserves the first comment in a mapping body (sl-ztet)", () => {
    const src = `schema s { a STRING }
schema t { b STRING }
mapping {
  // First comment before source block
  source { s }
  target { t }
  a -> b
}`;
    const out = fmt(src);
    assert.ok(out.includes("// First comment before source block"));
  });

  it("preserves first AND trailing comments in metric schema bodies (sl-1kzh)", () => {
    // Metrics are now schema blocks decorated with (metric, ...) metadata.
    // This validates that leading and trailing gap comments inside the body are preserved.
    const src = `schema orders { total INT }
schema test_metric (metric, source orders) {
  // First comment in metric body
  total INT
  // Second comment
}`;
    const out = fmt(src);
    assert.ok(out.includes("// First comment in metric body"), "leading gap comment in metric must be preserved");
    assert.ok(out.includes("// Second comment"), "trailing gap comment in metric must be preserved");
  });

  it("preserves first AND trailing comments in transform bodies (sl-17lk)", () => {
    const src = `transform with_comments {
  // Comment before first pipe step
  trim | lowercase
  // Trailing comment
}`;
    const out = fmt(src);
    assert.ok(out.includes("// Comment before first pipe step"), "leading gap comment in transform must be preserved");
    assert.ok(out.includes("// Trailing comment"), "trailing gap comment in transform must be preserved");
  });

  it("preserves first comment in nested record bodies (sl-necw)", () => {
    const src = `schema nested_test {
  id INT (pk)
  address record {
    // Street address components
    street STRING(200)
    city STRING(100)
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("// Street address components"), "first comment inside nested record must be preserved");
  });

  it("preserves first comment in list_of record bodies", () => {
    const src = `schema test {
  items list_of record {
    // Item fields
    sku STRING
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("// Item fields"), "first comment inside list_of record must be preserved");
  });

  it("is idempotent for blocks with leading gap comments", () => {
    const src = `schema test {
  // First comment
  x INT
}`;
    const out1 = fmt(src);
    const out2 = fmt(out1);
    assert.equal(out1, out2, "format(format(x)) must equal format(x) when leading gap comments exist");
  });

  it("is idempotent for metric schema blocks with gap comments", () => {
    // Metrics are schema blocks decorated with (metric, ...) metadata.
    // format(format(x)) must equal format(x) for metric schemas with gap comments.
    const src = `schema s { x INT }
schema m (metric, source s) {
  // Leading
  x INT
  // Trailing
}`;
    const out1 = fmt(src);
    const out2 = fmt(out1);
    assert.equal(out1, out2, "metric with gap comments must be idempotent");
  });

  it("is idempotent for transform blocks with gap comments", () => {
    const src = `transform t {
  // Leading
  trim | lowercase
  // Trailing
}`;
    const out1 = fmt(src);
    const out2 = fmt(out1);
    assert.equal(out1, out2, "transform with gap comments must be idempotent");
  });

  // ── sl-dz3n: comments were silently deleted in five positions ──────────────
  // Each case below reproduces one position from the ticket. The module header
  // promises the formatter preserves comments, so loss anywhere is a bug.

  it("preserves leading, in-chain, and trailing comments in arrow transform bodies (sl-dz3n)", () => {
    const src = `mapping m {
  source { s }
  target { t }
  a -> b {
    // strip whitespace first
    trim
    // fold to lowercase next
    | lowercase  // then case-fold
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("// strip whitespace first"), "comment between { and pipe chain must survive");
    assert.ok(out.includes("// fold to lowercase next"), "comment between pipe steps must survive");
    assert.ok(out.includes("// then case-fold"), "trailing inline comment on last step must survive");
    assert.equal(out, fmt(out), "arrow body comments must be idempotent");
  });

  it("preserves comments between pipe steps in transform blocks (sl-dz3n)", () => {
    // The transform-block leading/trailing positions are covered above (sl-17lk);
    // this guards the in-chain position, which goes through formatPipeChainMultiLine.
    const src = `transform t {
  trim
  // normalise case before comparing
  | lowercase
}`;
    const out = fmt(src);
    assert.ok(out.includes("// normalise case before comparing"), "comment between pipe steps must survive");
    assert.equal(out, fmt(out), "in-chain transform comments must be idempotent");
  });

  it("preserves own-line and inline comments inside source blocks (sl-dz3n)", () => {
    const src = `mapping m {
  source {
    // primary table
    s_a,
    s_b  // joined secondary
  }
  target { t }
  a -> b
}`;
    const out = fmt(src);
    assert.ok(out.includes("// primary table"), "own-line comment before a source ref must survive");
    assert.ok(out.includes("// joined secondary"), "inline comment after a source ref must survive");
    assert.equal(out, fmt(out), "source block comments must be idempotent");
  });

  it("preserves own-line and inline comments inside metadata blocks (sl-dz3n)", () => {
    const src = `schema s (
  format postgresql,  // physical store
  // governance owner is data-eng
  note "hello"
) {
  id INT
}`;
    const out = fmt(src);
    assert.ok(out.includes("// physical store"), "inline comment after a metadata entry must survive");
    assert.ok(out.includes("// governance owner is data-eng"), "own-line comment between entries must survive");
    assert.equal(out, fmt(out), "metadata comments must be idempotent");
  });

  it("preserves own-line and inline comments inside note blocks (sl-dz3n)", () => {
    const src = `note {
  // reviewed 2026-06
  "First line"
  "Second line"  // trailing
}`;
    const out = fmt(src);
    assert.ok(out.includes("// reviewed 2026-06"), "own-line comment before a note string must survive");
    assert.ok(out.includes("// trailing"), "inline comment after a note string must survive");
    assert.equal(out, fmt(out), "note block comments must be idempotent");
  });

  it("preserves inline comments on schema and mapping opening-brace lines (sl-dz3n)", () => {
    const src = `schema s { // why this schema exists
  id INT
}

mapping m { // why this mapping exists
  source { s }
  target { t }
  id -> id
}`;
    const out = fmt(src);
    assert.ok(out.includes("// why this schema exists"), "brace-line comment on schema must survive");
    assert.ok(out.includes("// why this mapping exists"), "brace-line comment on mapping must survive");
    assert.equal(out, fmt(out), "brace-line comments must be idempotent");
  });
});

// ── Blank Lines ──────────────────────────────────────────────────────────────

describe("blank lines", () => {
  it("puts 1 blank line between top-level blocks", () => {
    const src = `schema a { x INT }
schema b { y STRING }`;
    const out = fmt(src);
    assert.ok(out.includes("}\n\nschema b"), "should have 1 blank line between blocks");
    assert.ok(!out.includes("}\n\n\nschema b"), "should not have 2 blank lines between blocks");
  });

  it("preserves blank line between file header and section comment (cbh-0lhj)", () => {
    const src = `// File header\n\n// Section comment\nschema a { x INT }`;
    const out = fmt(src);
    assert.ok(out.includes("// File header\n\n// Section comment"), "should preserve blank line between header and section comment");
  });

  it("no blank lines between consecutive imports", () => {
    const src = `import { foo } from "a.stm"
import { bar } from "b.stm"`;
    const out = fmt(src);
    assert.ok(out.includes('"a.stm"\nimport'));
  });

  it("file ends with single newline", () => {
    const src = `schema test {
  x INT
}


`;
    const out = fmt(src);
    assert.ok(out.endsWith("}\n"), "should end with single newline");
    assert.ok(!out.endsWith("}\n\n"), "should not have trailing blank lines");
  });

  it("preserves blank lines within blocks (normalized to 1)", () => {
    const src = `mapping test {
  source { s }
  target { t }



  s.x -> t.y
}`;
    const out = fmt(src);
    // Multiple blank lines should normalize to 1
    assert.ok(!out.includes("\n\n\n  s.x"), "should not have 2+ blank lines within block");
    assert.ok(out.includes("}\n\n  s.x"), "should preserve 1 blank line");
  });
});

// ── Mapping Formatting ───────────────────────────────────────────────────────

describe("mapping formatting", () => {
  it("formats simple arrows", () => {
    const src = `mapping test {
  source { s }
  target { t }
  s.id   ->   t.id
}`;
    const out = fmt(src);
    assert.ok(out.includes("s.id -> t.id"), "should normalize arrow spacing");
  });

  it("formats inline transforms", () => {
    const src = `mapping test {
  source { s }
  target { t }
  s.x -> t.x {   trim  |  lowercase  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("{ trim | lowercase }"), "should normalize pipe spacing");
  });

  it("formats computed arrows", () => {
    const src = `mapping test {
  source { s }
  target { t }
  -> t.computed { "NL description." }
}`;
    const out = fmt(src);
    assert.ok(out.includes("-> t.computed"));
  });

  // Regression for sl-q9oj: the multi-line branch of formatSourceBlock joined
  // refs with bare newlines, silently dropping the commas the author wrote.
  // Commas are optional in the grammar but are the canonical corpus style,
  // so the formatter must preserve them.
  it("keeps commas between refs when a multi-ref source block goes multi-line", () => {
    const src = `mapping test {
  source { store, customers }
  target { t }
  store.id -> t.id
}`;
    const out = fmt(src);
    assert.ok(
      out.includes("    store,\n    customers\n"),
      `multi-line source refs should stay comma-separated, got:\n${out}`,
    );
  });

  // Formatting must be idempotent: re-formatting formatter output (with its
  // restored commas) must not change it again.
  it("formats a multi-ref source block idempotently", () => {
    const src = `mapping test {
  source { store, customers }
  target { t }
  store.id -> t.id
}`;
    const once = fmt(src);
    assert.equal(fmt(once), once);
  });
});

// ── Transform, Metric, Note, Import ──────────────────────────────────────────

describe("transform formatting", () => {
  it("formats transform block", () => {
    const src = `transform my_transform {
  trim | lowercase
}`;
    const out = fmt(src);
    assert.ok(out.includes("transform my_transform {"));
    assert.ok(out.includes("  trim | lowercase"));
  });
});

describe("import formatting", () => {
  it("formats import declaration", () => {
    const src = `import { foo, bar } from "lib.stm"`;
    const out = fmt(src);
    assert.equal(out.trim(), 'import { foo, bar } from "lib.stm"');
  });
});

describe("note formatting", () => {
  it("formats note with triple-quoted string", () => {
    const src = `note {
  """
  Some content.
  """
}`;
    const out = fmt(src);
    assert.ok(out.includes("note {"));
    assert.ok(out.includes('"""'));
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty input", () => {
    assert.equal(fmt(""), "\n");
  });

  it("handles empty blocks", () => {
    const src = `schema empty { }`;
    const out = fmt(src);
    assert.ok(out.includes("schema empty {"));
  });

  it("handles deeply nested records", () => {
    const src = `schema test {
  outer record {
    inner record {
      x INT
    }
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("    inner record {"));
    assert.ok(out.includes("      x  INT"));
  });

  it("formats NL pipe chains with numbers as identifiers inline", () => {
    // After Feature 28, function-call and arithmetic syntax is gone.
    // Bare tokens, NL strings, and numbers are all valid NL pipe steps.
    const src = `mapping test {
  source { s }
  target { t }
  s.x -> t.y { coalesce 0 | "multiply by 100" | round }
}`;
    const out = fmt(src);
    assert.ok(out.includes("coalesce 0"), "should preserve bare-token NL step with number");
    assert.ok(out.includes('"multiply by 100"'), "should preserve quoted NL step");
  });

  it("handles map literals with comparison keys", () => {
    const src = `mapping test {
  source { s }
  target { t }
  s.x -> t.y {
    map {
      < 1000: "low"
      default: "high"
    }
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("< 1000"), "should preserve comparison key");
    assert.ok(out.includes("default"), "should preserve default key");
  });

  it("handles list_of scalar fields in alignment", () => {
    const src = `schema test {
  id INT (pk)
  tags list_of STRING
  codes list_of INT (required)
}`;
    const out = fmt(src);
    // list_of fields participate in alignment
    assert.ok(out.includes("tags   list_of STRING") || out.includes("tags  list_of STRING"));
    assert.ok(out.includes("codes  list_of INT"));
  });

  it("handles namespace blocks", () => {
    const src = `namespace myns (note "Test namespace") {
  schema inner { x INT }
}`;
    const out = fmt(src);
    assert.ok(out.includes('namespace myns (note "Test namespace") {'));
    assert.ok(out.includes("  schema inner {"));
  });

  it("handles multi-line metadata on blocks", () => {
    const src = `schema test (
  format postgresql,
  note "A long description"
) {
  id INT (pk)
}`;
    const out = fmt(src);
    assert.ok(out.includes("schema test ("));
    assert.ok(out.includes("format postgresql,"));
    assert.ok(out.includes(") {"));
  });

  it("handles each/flatten blocks", () => {
    const src = `mapping test {
  source { s }
  target { t }
  each s.items -> t.items {
    .sku -> .sku { trim }
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("each s.items -> t.items {"));
    assert.ok(out.includes("  .sku -> .sku { trim }"));
  });

  // Regression for sl-7236: the each/flatten child loop only dispatched on the
  // three arrow node types, so nested each/flatten sub-blocks (allowed by the
  // grammar's _nested_block_item) fell through every branch and were silently
  // deleted — fmt destroyed mapping logic on valid input.
  it("preserves an each block nested inside an each block", () => {
    const src = `mapping test {
  source { s }
  target { t }
  each orders -> out_orders {
    id -> oid
    each items -> out_items {
      sku -> out_sku
    }
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("each orders -> out_orders {"));
    assert.ok(out.includes("  each items -> out_items {"), "inner each header must survive");
    assert.ok(out.includes("    sku -> out_sku"), "inner each arrows must survive at depth-2 indent");
    assert.equal(out, fmt(out), "nested each output must be idempotent");
  });

  it("preserves a flatten block nested inside an each block", () => {
    const src = `mapping test {
  source { s }
  target { t }
  each orders -> flat {
    flatten items -> .rows {
      name -> name
    }
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("  flatten items -> .rows {"), "inner flatten header must survive");
    assert.ok(out.includes("    name -> name"), "inner flatten arrows must survive at depth-2 indent");
    assert.equal(out, fmt(out), "nested flatten output must be idempotent");
  });

  it("handles metric schema block with metric_name and metadata", () => {
    // Metrics are now schema blocks with (metric, metric_name "MRR", ...) metadata.
    // Validates that the formatter handles metric schemas correctly.
    const src = `schema mrr (metric, metric_name "MRR", source subs, grain monthly) {
  value DECIMAL(14,2) (measure additive)
}`;
    const out = fmt(src);
    assert.ok(out.includes('schema mrr ('));
    assert.ok(out.includes('metric_name "MRR"'));
    assert.ok(out.includes("value  DECIMAL(14,2)  (measure additive)"));
  });

  it("handles multi-source blocks", () => {
    const src = `mapping test {
  source {
    schema_a
    schema_b
    "join condition"
  }
  target { t }
  a.x -> t.x
}`;
    const out = fmt(src);
    assert.ok(out.includes("source {"));
    assert.ok(out.includes("  schema_a"));
    assert.ok(out.includes("  schema_b"));
  });

  it("handles quoted block labels", () => {
    const src = "schema `my schema` { x INT }";
    const out = fmt(src);
    assert.ok(out.includes("schema `my schema` {"));
  });

  it("handles backtick field names in alignment", () => {
    const src = `schema test {
  \`special_field\` INT
  normal STRING
}`;
    const out = fmt(src);
    assert.ok(out.includes("`special_field`"));
  });

  it("handles inline map on single line", () => {
    const src = `mapping test {
  source { s }
  target { t }
  s.x -> t.y { map { A: "active", I: "inactive" } }
}`;
    const out = fmt(src);
    assert.ok(out.includes("map {") && out.includes("}"));
  });

  it("preserves NL string content verbatim", () => {
    const src = `mapping test {
  source { s }
  target { t }
  -> t.x {
    "Complex NL: use \`field_a\` + \`field_b\`. Handle edge cases."
  }
}`;
    const out = fmt(src);
    assert.ok(out.includes("`field_a`"));
    assert.ok(out.includes("`field_b`"));
  });
});

// ── Golden Fixture Tests ─────────────────────────────────────────────────────

describe("golden fixture round-trip (all corpus)", () => {
  const stmFiles = readdirSync(examplesDir, { recursive: true }).filter(f => f.endsWith(".stm"));

  for (const file of stmFiles) {
    it(`format(parse(examples/${file})) parses without errors`, () => {
      const src = readFileSync(join(examplesDir, file), "utf8");
      const out = fmt(src);
      const { errorCount } = parseSource(out);
      assert.equal(errorCount, 0, `formatted output should parse cleanly`);
    });
  }
});

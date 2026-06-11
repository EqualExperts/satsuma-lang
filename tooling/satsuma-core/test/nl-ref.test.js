/**
 * nl-ref.test.js — Unit tests for satsuma-core nl-ref module
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AT_REF_PATTERN,
  createAtRefRegex,
  extractAtRefs,
  extractNLRefData,
  computeNLRefPosition,
  classifyRef,
  resolveRef,
  resolveAllNLRefs,
  stripNLRefScopePrefix,
} from "../dist/nl-ref.js";
import { initParser, getParser } from "../dist/parser.js";

// Real-parser cases below (sl-74m6) parse minimal Satsuma snippets against the
// committed grammar WASM, mirroring the bootstrap in parse-errors.test.js.
const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

// ── extractAtRefs ─────────────────────────────────────────────────────────────

describe("extractAtRefs()", () => {
  it("extracts @ref mentions", () => {
    const refs = extractAtRefs("Sum @amount grouped by @order_id");
    assert.deepEqual(refs.map(r => r.ref), ["amount", "order_id"]);
  });

  it("extracts @ns::schema.field refs", () => {
    const refs = extractAtRefs("Join @crm::customers.id to @dim_customer.customer_id");
    assert.deepEqual(refs.map(r => r.ref), ["crm::customers.id", "dim_customer.customer_id"]);
  });

  it("handles @`backtick-name` refs", () => {
    const refs = extractAtRefs("@`order-id` value");
    assert.equal(refs.length, 1);
    assert.equal(refs[0].ref, "order-id");
  });

  it("returns empty for text with no refs", () => {
    const refs = extractAtRefs("plain text with no references");
    assert.deepEqual(refs, []);
  });

  // sl-gl21: the @ref regex previously matched any @ followed by an identifier,
  // producing false positives inside email addresses and SQL LIKE wildcards.
  // The lookbehind anchors @ to start-of-string, whitespace, or specific
  // opening/separator punctuation. These cases lock that contract in place.

  it("does not extract @refs from email-like patterns (sl-gl21)", () => {
    // user@example.com — the `r` before @ is a word char, so the lookbehind fails.
    const refs = extractAtRefs("contact user@example.com for details");
    assert.deepEqual(refs, []);
  });

  it("does not extract @refs from SQL LIKE wildcards like %@foo (sl-gl21)", () => {
    // The example that triggered the original report:
    // `email LIKE %@test.internal` inside a note. `%` must not be allowed
    // before @ — only whitespace and a small set of opening punctuation.
    const refs = extractAtRefs("filter where email LIKE %@test.internal");
    assert.deepEqual(refs, []);
  });

  it("does not extract @refs after a digit or underscore", () => {
    // Guards against accidentally widening the allowed prefix set: digits,
    // letters and underscore are all word chars and must remain disallowed.
    assert.deepEqual(extractAtRefs("v2@version"), []);
    assert.deepEqual(extractAtRefs("name_@suffix"), []);
  });

  it("extracts @ref at start of string", () => {
    // Start-of-string is one of the explicitly allowed positions.
    const refs = extractAtRefs("@customer_id is the key");
    assert.deepEqual(refs.map(r => r.ref), ["customer_id"]);
  });

  it("extracts @refs after opening punctuation like ( [ { , ;", () => {
    // Acceptance criterion from sl-gl21: opening punctuation must still
    // qualify as a valid prefix so refs in parenthesised text resolve.
    assert.deepEqual(extractAtRefs("coalesce(@a, @b)").map(r => r.ref), ["a", "b"]);
    assert.deepEqual(extractAtRefs("[@a; @b]").map(r => r.ref), ["a", "b"]);
    assert.deepEqual(extractAtRefs("{@a}").map(r => r.ref), ["a"]);
  });

  // sl-74m6: quotes, `=` and `:` were excluded from the lookbehind as collateral
  // of the sl-gl21 fix, silently dropping refs that abut them in real NL prose.
  // None of these shapes overlap the email/wildcard false positives sl-gl21
  // exists to block, so they must be extracted.

  it("extracts a @ref immediately after a double or single quote (sl-74m6)", () => {
    // Prose like `"@customers" table` quotes the ref itself — the ref must
    // still reach lineage and validation.
    assert.deepEqual(extractAtRefs('"@customers" table').map(r => r.ref), ["customers"]);
    assert.deepEqual(extractAtRefs("'@customers' table").map(r => r.ref), ["customers"]);
  });

  it("extracts a @ref immediately after = (sl-74m6)", () => {
    // SQL-ish condition text with no space around the operator:
    // `where id =@customers.id`.
    assert.deepEqual(extractAtRefs("where id =@customers.id").map(r => r.ref), ["customers.id"]);
  });

  it("extracts a @ref immediately after : (sl-74m6)", () => {
    // Key/value prose with no space after the colon: `key:@customers.id`.
    assert.deepEqual(extractAtRefs("key:@customers.id").map(r => r.ref), ["customers.id"]);
  });

  it("extracts @refs across multiple lines (after newline counts as whitespace)", () => {
    // \n is part of \s, so refs at the start of a continuation line in a
    // triple-quoted NL string must still be extracted. This pairs with the
    // multiline-position helper exercised below.
    const refs = extractAtRefs("first line\n@second_line ref");
    assert.deepEqual(refs.map(r => r.ref), ["second_line"]);
  });
});

// ── createAtRefRegex / AT_REF_PATTERN ─────────────────────────────────────────

describe("createAtRefRegex()", () => {
  it("returns a fresh regex instance each call", () => {
    // Two consumers must not share /g state — sharing the same RegExp object
    // across modules historically caused intermittent missed matches when one
    // consumer left lastIndex non-zero.
    const a = createAtRefRegex();
    const b = createAtRefRegex();
    assert.notEqual(a, b);
    a.exec("@x");
    assert.equal(b.lastIndex, 0);
  });

  it("AT_REF_PATTERN compiles to the same shape as the regex", () => {
    // The exported pattern string is what non-core consumers (LSP, viz)
    // would inline if they need a custom-flagged regex. It must compile and
    // produce equivalent matches to createAtRefRegex().
    const re = new RegExp(AT_REF_PATTERN, "g");
    assert.equal(re.exec("@foo")?.[0], "@foo");
  });
});

// ── computeNLRefPosition ──────────────────────────────────────────────────────

describe("computeNLRefPosition()", () => {
  // sl-2ji3: the validator previously reported diagnostic positions for @refs
  // inside multiline NL strings using a naive `item.line + 1, item.column +
  // offset + 1` formula. That ignored newlines, so an @ref on line 3 of a
  // triple-quoted body got reported at the line of the opening `"""`.

  it("reports a 1-based single-line position for refs on the opener line", () => {
    // The NL string starts at row=10, col=4. An @ref at offset 5 within the
    // text sits on the same line, so column is the start column + offset + 1.
    const item = { text: "see @foo here", line: 10, column: 4 };
    const pos = computeNLRefPosition(item, item.text.indexOf("@"));
    assert.deepEqual(pos, { line: 11, column: 9 });
  });

  it("reports the correct line for an @ref on a continuation line of a multiline string", () => {
    // Multiline body of a """...""" string starting at file row 5. The @ref
    // is on the third logical line of the body, so line should be 5+2+1 = 8.
    const item = {
      text: "first line\nsecond line\n@third_ref here",
      line: 5,
      column: 0,
    };
    const offset = item.text.indexOf("@");
    const pos = computeNLRefPosition(item, offset);
    assert.equal(pos.line, 8);
    // Column 1 because the @ is the first character on its line.
    assert.equal(pos.column, 1);
  });

  it("uses the per-line column rather than the byte offset on continuation lines", () => {
    // The bug from sl-2ji3 was that column was reported as `startColumn +
    // offset` even after newlines, producing huge bogus columns. Here the @
    // sits 4 chars into its own line, so column must be 5 (1-based), not the
    // byte offset relative to the string start.
    const item = { text: "first\n    @ref end", line: 2, column: 8 };
    const offset = item.text.indexOf("@");
    const pos = computeNLRefPosition(item, offset);
    assert.equal(pos.line, 4);  // 2 + 1 newline + 1 (1-based)
    assert.equal(pos.column, 5);
  });
});

// ── classifyRef ───────────────────────────────────────────────────────────────

describe("classifyRef()", () => {
  it("classifies bare identifier", () => {
    assert.equal(classifyRef("customer_id"), "bare");
  });

  it("classifies dotted field", () => {
    assert.equal(classifyRef("schema.field"), "dotted-field");
  });

  it("classifies namespace-qualified schema", () => {
    assert.equal(classifyRef("crm::customers"), "namespace-qualified-schema");
  });

  it("classifies namespace-qualified field", () => {
    assert.equal(classifyRef("crm::customers.email"), "namespace-qualified-field");
  });
});

// ── resolveRef ────────────────────────────────────────────────────────────────

function makeLookup(schemas = {}, fragments = {}, transforms = {}, mappings = {}) {
  const schemaMap = new Map(Object.entries(schemas));
  const fragMap = new Map(Object.entries(fragments));
  const transformMap = new Map(Object.entries(transforms));
  const mappingMap = new Map(Object.entries(mappings));
  return {
    hasSchema: (k) => schemaMap.has(k),
    getSchema: (k) => schemaMap.get(k) ?? null,
    hasFragment: (k) => fragMap.has(k),
    getFragment: (k) => fragMap.get(k) ?? null,
    hasTransform: (k) => transformMap.has(k),
    getMapping: (k) => mappingMap.get(k) ?? null,
    iterateSchemas: () => schemaMap.entries(),
  };
}

describe("resolveRef()", () => {
  it("resolves a bare field against mapping sources", () => {
    const lookup = makeLookup({ "::orders": { fields: [{ name: "order_id" }], hasSpreads: false } });
    const ctx = { sources: ["::orders"], targets: [], namespace: null };
    const r = resolveRef("order_id", ctx, lookup);
    assert.equal(r.resolved, true);
    assert.equal(r.resolvedTo.kind, "field");
    assert.equal(r.resolvedTo.name, "::orders.order_id");
  });

  it("resolves a namespace-qualified schema", () => {
    const lookup = makeLookup({ "crm::customers": { fields: [], hasSpreads: false } });
    const ctx = { sources: [], targets: [], namespace: null };
    const r = resolveRef("crm::customers", ctx, lookup);
    assert.equal(r.resolved, true);
    assert.equal(r.resolvedTo.kind, "schema");
  });

  it("returns unresolved for unknown ref", () => {
    const lookup = makeLookup({});
    const ctx = { sources: [], targets: [], namespace: null };
    const r = resolveRef("unknown_field", ctx, lookup);
    assert.equal(r.resolved, false);
  });

  it("resolves bare field via workspace fallback when no context", () => {
    const lookup = makeLookup({ my_schema: { fields: [{ name: "email" }], hasSpreads: false } });
    const ctx = { sources: [], targets: [], namespace: null };
    const r = resolveRef("email", ctx, lookup);
    assert.equal(r.resolved, true);
    assert.equal(r.resolvedTo.kind, "field");
  });

  // sl-98cz: extraction records source/target lists exactly as authored, so a
  // namespaced mapping's bare source name ("customers") arrives unqualified
  // while the index keys the schema "crm::customers". resolveRef must try the
  // namespace-qualified form before giving up, or every bare @field ref against
  // a namespaced source schema becomes a false unresolved-nl-ref warning.

  it("resolves a bare field against an unqualified source name inside a namespace (sl-98cz)", () => {
    const lookup = makeLookup({
      "crm::customers": { fields: [{ name: "account_id" }], hasSpreads: false },
      "crm::tgt": { fields: [{ name: "id" }], hasSpreads: false },
    });
    // The ticket repro: sources raw, targets pre-qualified (extractMappings
    // qualifies only targets), both fields must resolve symmetrically.
    const ctx = { sources: ["customers"], targets: ["crm::tgt"], namespace: "crm" };
    const src = resolveRef("account_id", ctx, lookup);
    assert.equal(src.resolved, true);
    assert.equal(src.resolvedTo.name, "crm::customers.account_id");
    const tgt = resolveRef("id", ctx, lookup);
    assert.equal(tgt.resolved, true);
    assert.equal(tgt.resolvedTo.name, "crm::tgt.id");
  });

  it("resolves a dotted field against an unqualified source name inside a namespace (sl-98cz)", () => {
    const lookup = makeLookup({
      "crm::customers": { fields: [{ name: "account_id" }], hasSpreads: false },
    });
    const ctx = { sources: ["customers"], targets: [], namespace: "crm" };
    const r = resolveRef("customers.account_id", ctx, lookup);
    assert.equal(r.resolved, true);
    assert.equal(r.resolvedTo.name, "crm::customers.account_id");
  });

  it("falls back to the global schema when the namespace-qualified name does not exist (sl-98cz)", () => {
    // A namespaced mapping may legitimately source a global schema; namespace
    // qualification must not shadow it when no sibling schema exists.
    const lookup = makeLookup({
      "::shared_ref": { fields: [{ name: "code" }], hasSpreads: false },
    });
    const ctx = { sources: ["::shared_ref"], targets: [], namespace: "crm" };
    const r = resolveRef("code", ctx, lookup);
    assert.equal(r.resolved, true);
    assert.equal(r.resolvedTo.name, "::shared_ref.code");
  });
});

// ── resolveAllNLRefs ──────────────────────────────────────────────────────────

describe("resolveAllNLRefs()", () => {
  it("resolves refs from NL ref data items", () => {
    const lookup = makeLookup({ "::orders": { fields: [{ name: "amount" }], hasSpreads: false } });
    const items = [
      {
        text: "Sum @amount",
        mapping: "my_mapping",
        namespace: null,
        targetField: "total",
        line: 5,
        column: 0,
        file: "test.stm",
      },
    ];
    const results = resolveAllNLRefs(items, lookup);
    assert.equal(results.length, 1);
    assert.equal(results[0].ref, "amount");
    assert.equal(results[0].classification, "bare");
  });

  it("returns empty array for empty input", () => {
    const lookup = makeLookup({});
    assert.deepEqual(resolveAllNLRefs([], lookup), []);
  });
});

// ── stripNLRefScopePrefix ────────────────────────────────────────────────────

describe("stripNLRefScopePrefix", () => {
  it("strips note:metric: prefix to bare entity name", () => {
    assert.equal(stripNLRefScopePrefix("note:metric:churn_rate"), "churn_rate");
  });

  it("strips note:schema: prefix to bare entity name", () => {
    assert.equal(stripNLRefScopePrefix("note:schema:orders"), "orders");
  });

  it("strips note:fragment: prefix to bare entity name", () => {
    assert.equal(stripNLRefScopePrefix("note:fragment:address"), "address");
  });

  it("strips transform: prefix to bare entity name", () => {
    assert.equal(stripNLRefScopePrefix("transform:normalize"), "normalize");
  });

  it("returns placeholder for standalone file-level note", () => {
    // Standalone notes have mapping "note:" — after stripping the bare
    // prefix, the result would be empty. Use a descriptive placeholder.
    assert.equal(stripNLRefScopePrefix("note:"), "(file-level note)");
  });

  it("returns mapping names without scope prefix unchanged", () => {
    assert.equal(stripNLRefScopePrefix("crm sync"), "crm sync");
    assert.equal(stripNLRefScopePrefix("ns::load data"), "ns::load data");
  });
});

// ── extractNLRefData — map literal NL strings (sl-74m6) ──────────────────────
//
// Real-parser tests: a map literal is a structured pipe-step shape, so mock
// CSTs would just restate the implementation. These parse minimal mappings and
// assert the walker reaches the NL strings inside map entries — previously only
// pipe_text steps were scanned and refs in map values escaped lineage entirely.

describe("extractNLRefData — map literal NL strings (sl-74m6)", () => {
  before(async () => {
    await initParser(WASM_PATH);
  });

  function nlRefItems(src) {
    return extractNLRefData(getParser().parse(src).rootNode);
  }

  it("extracts a @ref inside a map literal string value", () => {
    // The ticket repro: a ref mentioned in a map value must produce an NL ref
    // item attributed to the arrow's target field.
    const src = 'mapping m {\n  a -> b { map { "x": "see @customers.id" } }\n}';
    const items = nlRefItems(src);
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "see @customers.id");
    assert.equal(items[0].mapping, "m");
    assert.equal(items[0].targetField, "b");
  });

  it("extracts a @ref inside a map literal string key", () => {
    // Keys are condition text and may also reference fields; they must not be
    // a blind spot either.
    const src = 'mapping m {\n  a -> b { map { "matches @customers.tier": "gold" } }\n}';
    const items = nlRefItems(src);
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "matches @customers.tier");
  });

  it("extracts a @ref from a map literal in a transform body", () => {
    // Transforms share the pipe-step walker with arrows — the map-literal fix
    // must apply there too.
    const src = 'transform grade {\n  map { "a": "top tier per @customers.tier" }\n}';
    const items = nlRefItems(src);
    assert.equal(items.length, 1);
    assert.equal(items[0].mapping, "transform:grade");
  });

  it("ignores map literal values with no refs or backticks", () => {
    // The walker pre-filters NL strings: plain map values must not generate
    // NL ref items (they would inflate nl-refs output with noise).
    const src = 'mapping m {\n  a -> b { map { "r": "retail", "w": "wholesale" } }\n}';
    assert.deepEqual(nlRefItems(src), []);
  });
});

// ── extractNLRefData — bare pipe-text at_refs (bptar-l6n8) ────────────────────
//
// The grammar parses unquoted pipe text structurally, so `{ derived from @b }`
// produces an at_ref node with no surrounding NL string. The walker previously
// collected only nl_string/multiline_string nodes, making bare refs invisible
// to nl-refs output, lineage, and validation while the quoted form worked.

describe("extractNLRefData — bare pipe-text at_refs (bptar-l6n8)", () => {
  before(async () => {
    await initParser(WASM_PATH);
  });

  function nlRefItems(src) {
    return extractNLRefData(getParser().parse(src).rootNode);
  }

  it("extracts a bare @ref from an arrow transform body", () => {
    // The ticket repro: same prose as the quoted control below, minus quotes.
    const items = nlRefItems("mapping m {\n  a -> b { derived from @src.col }\n}");
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "@src.col");
    assert.equal(items[0].mapping, "m");
    assert.equal(items[0].targetField, "b");
  });

  it("extracts a bare @ref from a transform block body", () => {
    // Transforms share the pipe-step walker — bare refs must surface there too.
    const items = nlRefItems("transform t {\n  uppercase | take from @customers.id\n}");
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "@customers.id");
    assert.equal(items[0].mapping, "transform:t");
  });

  it("extracts every bare @ref when one pipe step holds several", () => {
    // Each at_ref is its own CST node; all of them must become items, each
    // anchored at its own position for diagnostics.
    const items = nlRefItems("mapping m {\n  a -> b { @x plus @y }\n}");
    assert.deepEqual(items.map((i) => i.text), ["@x", "@y"]);
    assert.notEqual(items[0].column, items[1].column);
  });

  it("extracts a bare backtick-named @ref", () => {
    // @`order id` is the backtick at_ref grammar branch; the item text keeps
    // the raw form so downstream extractAtRefs/normalization applies once.
    const items = nlRefItems("mapping m {\n  a -> b { lookup @`order id` }\n}");
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "@`order id`");
  });

  it("anchors a bare @ref so position math matches the quoted form", () => {
    // For quoted items, column points at the opening delimiter and
    // computeNLRefPosition's +1 lands on the @. A bare item has no delimiter,
    // so its column is the @ itself and the same +1 yields the 1-based column.
    const src = "mapping m {\n  a -> b { from @z }\n}";
    const [item] = nlRefItems(src);
    const pos = computeNLRefPosition(item, item.text.indexOf("@"));
    assert.equal(pos.line, 2); // 1-based line of the arrow
    assert.equal(pos.column, src.split("\n")[1].indexOf("@") + 1); // 1-based @ column
  });
});

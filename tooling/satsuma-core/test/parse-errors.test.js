/**
 * parse-errors.test.js — Authoritative tests for CST error-node collection.
 *
 * Validates the behaviour of collectParseErrors() against real parsed Satsuma
 * source snippets so the tests cover end-to-end fidelity (grammar → CST → entry).
 * These tests are the canonical suite; any CLI or LSP tests that re-tested the
 * same walk logic are retired in favour of these.
 *
 * The final suite pins one grammar rule through the same function: a gap
 * inside an arrow path is a parse error (bsw-0twy).
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { initParser, getParser, collectParseErrors } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

before(async () => {
  await initParser(WASM_PATH);
});

function parse(src) {
  return getParser().parse(src);
}

describe("collectParseErrors", () => {
  it("returns an empty array for a clean parse tree", () => {
    // A valid schema must produce zero entries — confirms the function does not
    // generate false positives on well-formed Satsuma source.
    const tree = parse("schema Customers {}");
    const errors = collectParseErrors(tree);
    assert.deepEqual(errors, []);
  });

  it("returns an empty array for a schema with fields", () => {
    // Multi-field schema — ensures the walk doesn't mis-classify valid field nodes.
    const tree = parse("schema Customers {\n  name VARCHAR\n  age INT\n}");
    const errors = collectParseErrors(tree);
    assert.deepEqual(errors, []);
  });

  it("reports an ERROR node for unexpected tokens", () => {
    // ERROR nodes are inserted when the parser cannot match a token sequence.
    // The entry must not be a MISSING node and must carry a descriptive message.
    const tree = parse("schema Customers { %%% }");
    const errors = collectParseErrors(tree);
    assert.ok(errors.length > 0, "must report at least one error for '%%%'");
    const errEntry = errors.find((e) => !e.isMissing);
    assert.ok(errEntry, "must include a non-missing (ERROR) entry");
    assert.match(errEntry.message, /Syntax error/);
    assert.equal(errEntry.isMissing, false);
  });

  it("reports a MISSING node separately from ERROR nodes", () => {
    // MISSING nodes are inserted by the error-recovery parser and carry no source
    // text — they must be reported as distinct entries from ERROR nodes, and the
    // isMissing flag must be set so consumers can apply different formatting.
    // "schema Customers {" is missing its closing brace — the grammar inserts a MISSING node.
    const tree = parse("schema Customers {");
    const errors = collectParseErrors(tree);
    assert.ok(errors.length > 0, "incomplete source must produce at least one entry");
    const missingEntry = errors.find((e) => e.isMissing);
    assert.ok(missingEntry, "must include at least one MISSING entry");
    assert.equal(missingEntry.isMissing, true);
    assert.match(missingEntry.message, /Missing expected/);
  });

  it("positions are 0-indexed (matching tree-sitter native format)", () => {
    // The CLI converts to 1-indexed by adding 1; the LSP uses 0-indexed directly.
    // This test pins the native format so consumers know the contract.
    const tree = parse("%%% bad tokens"); // error at start of file
    const errors = collectParseErrors(tree);
    assert.ok(errors.length > 0);
    // Source starts at line 0, column 0
    const first = errors[0];
    assert.ok(first, "errors array must have at least one entry");
    assert.equal(first.startRow, 0);
    assert.equal(first.startColumn, 0);
  });

  it("message for ERROR nodes includes a preview of the unexpected text", () => {
    // The message preview helps users identify the offending token without reading
    // the full CST — important for long lines where the error spans many tokens.
    const tree = parse("schema Customers { %%% }");
    const errors = collectParseErrors(tree);
    const errEntry = errors.find((e) => !e.isMissing);
    assert.ok(errEntry, "must have at least one ERROR entry");
    assert.match(errEntry.message, /unexpected/i);
  });
});

// ── Whitespace inside an arrow path (bsw-0twy) ───────────────────────────────
//
// A path is one lexical unit (spec §4.4): no space, line break or comment may
// follow `.`, `^.` or `$.`. Before bsw-0twy the grammar accepted `^. oid`,
// `^. ^.sid`, `$. a`, `. a` and `a. b`. Extraction then read the raw text with
// the gap in it and reported a garbage path, while `satsuma fmt` dropped the
// gap and so silently changed what the arrow resolved to. Rejecting the
// spaced forms in the grammar is what lets the formatter promise it never
// changes meaning: a recovery-free file has no gaps left for it to close.

/** The gaps a careless author might leave inside a path. */
const PATH_GAP = fc.constantFrom(" ", "\n      ", " // why\n      ");

/** One path, as its tokens: the anchor markers, then segments joined by dots. */
const ARROW_PATH_TOKENS = fc
  .record({
    anchor: fc.oneof(
      fc.constant([]),
      fc.constant(["."]),
      fc.constant(["$."]),
      fc.integer({ min: 1, max: 3 }).map((n) => Array(n).fill("^.")),
    ),
    segments: fc.array(fc.constantFrom("a", "`odd name`", "each"), {
      minLength: 1,
      maxLength: 3,
    }),
  })
  // A bare leading `each` is the keyword, not a path. After a marker or a dot
  // it is an ordinary field name, which is why the generator still offers it.
  .filter(({ anchor, segments }) => anchor.length > 0 || segments[0] !== "each")
  .map(({ anchor, segments }) => {
    const tokens = [...anchor];
    segments.forEach((segment, i) => {
      if (i > 0) tokens.push(".");
      tokens.push(segment);
    });
    return tokens;
  });

/** Indices of the tokens a gap may follow: every marker and every dot. */
function gapPositions(tokens) {
  return tokens.flatMap((token, i) => (token.endsWith(".") ? [i] : []));
}

/** Wrap one arrow source path in the smallest mapping where escapes are legal. */
function nestedArrowSource(pathText) {
  return `mapping {\n  each xs -> t {\n    ${pathText} -> out\n  }\n}\n`;
}

describe("whitespace inside an arrow path (bsw-0twy)", () => {
  it("parses every unspaced path cleanly", () => {
    // Control for the property below: the generated paths are legal Satsuma, so
    // any parse error there is caused by the inserted gap and nothing else.
    fc.assert(
      fc.property(ARROW_PATH_TOKENS, (tokens) => {
        const source = nestedArrowSource(tokens.join(""));
        assert.deepEqual(collectParseErrors(parse(source)), [], source);
      }),
    );
  });

  it("rejects a space, line break or comment after any `.`, `^.` or `$.` in a path", () => {
    // The grammar rule itself: whatever the anchor, segment count or gap kind,
    // a gap after a marker or a dot is a parse error rather than a spaced path
    // that extraction and the formatter would read two different ways.
    const withGap = ARROW_PATH_TOKENS.filter((tokens) => gapPositions(tokens).length > 0).chain(
      (tokens) =>
        fc.record({
          tokens: fc.constant(tokens),
          after: fc.constantFrom(...gapPositions(tokens)),
          gap: PATH_GAP,
        }),
    );
    fc.assert(
      fc.property(withGap, ({ tokens, after, gap }) => {
        const spaced = tokens.map((token, i) => (i === after ? token + gap : token)).join("");
        const source = nestedArrowSource(spaced);
        assert.ok(collectParseErrors(parse(source)).length > 0, `must not parse:\n${source}`);
      }),
    );
  });
});

/**
 * Tests for arms Y and J of Feature 44's static-compactness measurement.
 *
 * Two classes of property matter here, and they fail in opposite directions:
 *
 *   - **Shape** — the design's savings (scalar shorthands, name-keyed
 *     collections, flow style) are what make the YAML arm a fair lower bound. A
 *     regression that inflates the YAML overstates Satsuma's advantage.
 *   - **Totality** — every authored fact must survive. A fact dropped from the
 *     YAML shrinks that arm and overstates Satsuma's advantage too.
 *
 * Several cases below are regressions for gaps the fact-preservation guard
 * caught during development, each of which had silently flattered Satsuma.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { initParser, getParser } from "@satsuma/core";
import { projectSpec } from "./static-compactness-model.mjs";
import { emitYaml, assertRoundTrips, assertFactsPreserved } from "./static-compactness-render.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

before(async () => {
  await initParser(join(repoRoot, "tooling", "tree-sitter-satsuma", "tree-sitter-satsuma.wasm"));
});

/** Projects and renders a snippet, so each test states only the Satsuma it needs. */
function render(source) {
  return emitYaml(projectSpec(getParser().parse(source).rootNode));
}

// ── Shape: the savings the design depends on ───────────────────────────────

test("a field carrying nothing but a type collapses to the scalar shorthand", () => {
  // This is the single largest saving in the design. If it regressed to
  // `{type: X}` the YAML arm would inflate and Satsuma's advantage would be
  // overstated across the whole corpus.
  assert.match(
    render("schema s {\n  amount CURRENCY(18,2)\n}\n"),
    /^ {6}amount: CURRENCY\(18,2\)$/m,
  );
});

test("an arrow carrying nothing but a source path collapses to the scalar shorthand", () => {
  const yaml = render(
    "schema a {\n  src STRING\n}\nschema b {\n  dst STRING\n}\nmapping m {\n  source { a }\n  target { b }\n  src -> dst\n}\n",
  );
  assert.match(yaml, /^ {6}dst: src$/m);
});

test("a field name YAML would read as a boolean is quoted, so it stays a name", () => {
  // Satsuma identifiers include `y`, `n`, `on` and `off`, all of which YAML 1.1
  // resolves to booleans. Left bare, the field would come back as `true` and the
  // arms would disagree about what the schema declares — a fidelity failure the
  // round-trip guard catches, and rule Q2 prevents.
  const yaml = render("schema s {\n  y STRING\n  off STRING\n}\n");
  const fields = parseYaml(yaml).schemas.s.fields;
  assert.deepEqual(Object.keys(fields), ["y", "off"]);
});

test("a type expression is bare in block context and quoted inside a flow mapping", () => {
  // Rule Q2: a comma terminates a plain scalar inside `{ }` but not in block
  // context, so `CURRENCY(18,2)` must be quoted in one and not the other.
  // Quoting both would spend tokens YAML does not have to spend.
  const yaml = render("schema s {\n  bare CURRENCY(18,2)\n  tagged CURRENCY(18,2) (required)\n}\n");
  assert.match(yaml, /bare: CURRENCY\(18,2\)/);
  assert.match(yaml, /tagged: \{type: "CURRENCY\(18,2\)", required: true\}/);
});

test("metadata tokens follow the open rule, each value shaped like its Satsuma argument", () => {
  // A bare tag becomes `true`, a one-argument tag becomes a scalar, and a
  // braced set becomes a sequence. Satsuma's vocabulary is open-ended, so the
  // renderer must key on shape rather than a fixed list of known tokens.
  const yaml = render(
    "schema s {\n  a ID (pk)\n  b STRING (default USD)\n  c PICKLIST (enum {x, y})\n}\n",
  );
  const fields = parseYaml(yaml).schemas.s.fields;
  assert.equal(fields.a.pk, true);
  assert.equal(fields.b.default, "USD");
  assert.deepEqual(fields.c.enum, ["x", "y"]);
});

// ── Totality: facts that must survive ──────────────────────────────────────

test("a computed arrow omits `from` rather than inventing a source", () => {
  // `-> is_closed { … }` has no source. Emitting an empty or guessed `from`
  // would state a fact the .stm does not.
  const yaml = render(
    'schema a {\n  x STRING\n}\nschema b {\n  y BOOLEAN\n}\nmapping m {\n  source { a }\n  target { b }\n  -> y {\n    "True when @x is set"\n  }\n}\n',
  );
  const arrow = parseYaml(yaml).mappings.m.arrows.y;
  assert.ok(!("from" in arrow), "a computed arrow must not carry a source");
  assert.equal(arrow.rule, "True when @x is set");
});

test("prose becomes `rule` and mechanical tokens become `steps`", () => {
  // The prose/token distinction is lexical in Satsuma (`"trim"` vs `trim`) and
  // must become structural in YAML, because YAML quoting carries no meaning.
  const yaml = render(
    'schema a {\n  x STRING\n}\nschema b {\n  y STRING\n}\nmapping m {\n  source { a }\n  target { b }\n  x -> y {\n    "Round to the nearest penny"\n    | round 2\n  }\n}\n',
  );
  const arrow = parseYaml(yaml).mappings.m.arrows.y;
  assert.equal(arrow.rule, "Round to the nearest penny");
  assert.equal(arrow.steps, "round 2");
});

test("a triple-quoted multi-line body is recognised as prose, not as a mechanical step", () => {
  // Satsuma has two prose spellings (spec §2.2). Treating `"""…"""` as a
  // vocabulary token would emit the delimiters as if they were code.
  const yaml = render(
    'schema a {\n  x STRING\n}\nschema b {\n  y STRING\n}\nmapping m {\n  source { a }\n  target { b }\n  x -> y {\n    """\n    Use @x when it is set.\n    """\n  }\n}\n',
  );
  const arrow = parseYaml(yaml).mappings.m.arrows.y;
  assert.match(arrow.rule, /Use @x when it is set\./);
  assert.ok(!JSON.stringify(arrow).includes('\\"\\"\\"'), "prose delimiters leaked into the value");
});

test("a value map keeps every case including the _ wildcard", () => {
  const yaml = render(
    'schema a {\n  x STRING\n}\nschema b {\n  y STRING\n}\nmapping m {\n  source { a }\n  target { b }\n  x -> y {\n    map {\n      open: "o"\n      _: "unknown"\n    }\n  }\n}\n',
  );
  assert.deepEqual(parseYaml(yaml).mappings.m.arrows.y.values, { open: "o", _: "unknown" });
});

test("several //! comments in one schema all survive instead of colliding on one key", () => {
  // Regression. Each warning was pushed as a separate `"!"` entry into an
  // ordered map, so all but the last were silently discarded — shrinking the
  // YAML arm and overstating Satsuma's advantage. The design's escape rule
  // (a repeated key takes a sequence) is what fixes it.
  const yaml = render(
    "schema s {\n  a STRING //! first concern\n  b STRING //! second concern\n}\n",
  );
  assert.deepEqual(parseYaml(yaml).schemas.s["!"], ["first concern", "second concern"]);
});

test("a namespaced schema records which namespace it belongs to", () => {
  // Regression. The namespace changes how every bare reference to the schema
  // resolves, so dropping it loses meaning as well as tokens.
  const yaml = render("namespace analytics {\n  schema s {\n    a STRING\n  }\n}\n");
  assert.equal(parseYaml(yaml).schemas.s.namespace, "analytics");
});

test("an each arrow records that it iterates, and states its source once", () => {
  // Regression. Dropping the kind turned an iterating arrow into a scalar
  // mapping — a meaning change, not just a size one. The source rides on the
  // `each` key so it is not also repeated under `from`.
  const yaml = render(
    "schema a {\n  items list_of record {\n    x STRING\n  }\n}\nschema b {\n  rows list_of record {\n    y STRING\n  }\n}\nmapping m {\n  source { a }\n  target { b }\n  each items -> rows {\n    x -> y\n  }\n}\n",
  );
  const arrow = parseYaml(yaml).mappings.m.arrows.rows;
  assert.equal(arrow.each, "items");
  assert.ok(!("from" in arrow), "an iterating arrow must not state its source twice");
});

// ── The guards themselves ──────────────────────────────────────────────────

test("assertFactsPreserved rejects a rendering that dropped an authored fact", () => {
  // The negative test for the guard that protects the published number. Without
  // it, a renderer that forgets a construct produces a smaller YAML arm, a
  // larger apparent advantage for Satsuma, and a green test suite.
  assert.throws(
    () =>
      assertFactsPreserved(
        { schemas: [{ name: "s", note: "a load-bearing note" }] },
        "schemas:\n  s: {}\n",
      ),
    /authored fact\(s\) are missing/,
  );
});

test("assertFactsPreserved accepts a rendering that carries every fact", () => {
  // The complement: the guard must not fire spuriously, or it would be
  // weakened until it stopped protecting anything.
  const source = "schema s {\n  a STRING (pk)\n}\n";
  const model = projectSpec(getParser().parse(source).rootNode);
  assert.doesNotThrow(() => assertFactsPreserved(model, emitYaml(model)));
});

test("assertRoundTrips rejects YAML that does not parse back to the tree it was built from", () => {
  // Guards the hand-written emitter: a quoting bug can change what a document
  // *says* while leaving it valid YAML, and a measurement of a document that
  // says the wrong thing is worse than no measurement at all.
  const model = projectSpec(getParser().parse("schema s {\n  a STRING\n}\n").rootNode);
  assert.throws(
    () => assertRoundTrips(model, "schemas:\n  s:\n    fields:\n      a: INTEGER\n"),
    /did not round-trip/,
  );
});

test("every corpus example round-trips and keeps every fact", () => {
  // The corpus is the real input the published number is computed from, so the
  // guards are exercised against it here rather than only against snippets.
  // This is what would fail if a future grammar change added a construct the
  // renderers do not handle.
  for (const relative of [
    "examples/sfdc-to-snowflake/pipeline.stm",
    "examples/nested-iteration/pipeline.stm",
    "examples/namespaces/ns-platform.stm",
    "examples/metrics-platform/metrics.stm",
  ]) {
    const source = readFileSync(join(repoRoot, relative), "utf8");
    const model = projectSpec(getParser().parse(source).rootNode);
    const yaml = emitYaml(model);
    assert.doesNotThrow(() => assertRoundTrips(model, yaml), `${relative} did not round-trip`);
    assert.doesNotThrow(() => assertFactsPreserved(model, yaml), `${relative} lost a fact`);
  }
});

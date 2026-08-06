/**
 * Tests for the neutral fact model behind Feature 44's arms S, Y and J.
 *
 * The measurement these back is a published number, so the properties that
 * matter are the ones that would silently bias it: a fact the projection drops
 * shrinks the YAML and JSON arms and inflates Satsuma's advantage, and a
 * derived fact the projection keeps inflates them and understates it. Both
 * directions are tested.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser, getParser } from "@satsuma/core";
import { projectSpec, assertTotality, REQUIRED_CONSTRUCTS } from "./static-compactness-model.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

before(async () => {
  await initParser(join(repoRoot, "tooling", "tree-sitter-satsuma", "tree-sitter-satsuma.wasm"));
});

/** Parses a snippet and projects it, so each test states only the Satsuma it needs. */
function project(source) {
  return projectSpec(getParser().parse(source).rootNode);
}

test("strips the parser's positions, so the YAML and JSON arms carry no fact the author never wrote", () => {
  // Row and column numbers are the clearest case of a derived fact. Serialising
  // them would pad the non-Satsuma arms with bookkeeping and manufacture a win.
  const model = project("schema s {\n  a STRING\n}\n");
  const serialised = JSON.stringify(model);
  assert.ok(!serialised.includes("startRow"), "startRow leaked into the projection");
  assert.ok(!serialised.includes("startColumn"), "startColumn leaked into the projection");
  assert.ok(!serialised.includes('"row"'), "row leaked into the projection");
});

test("strips arrowCount, which restates a fact the arrows themselves already carry", () => {
  // Counting the arrows is the parser's convenience, not the author's content.
  // Emitting it would make every arm pay for the same fact twice.
  const model = project(
    "schema a {\n  x STRING\n}\nschema b {\n  y STRING\n}\nmapping m {\n  source { a }\n  target { b }\n  x -> y\n}\n",
  );
  assert.ok(!JSON.stringify(model).includes("arrowCount"));
  assert.equal(model.mappings[0].arrows.length, 1);
});

test("keeps a parameterised type as one fact rather than splitting or dropping its parameters", () => {
  // CURRENCY(18,2) is a single authored fact. Dropping "(18,2)" would lose
  // precision a reader needs to implement the mapping, and the arms would no
  // longer be paired.
  const model = project("schema s {\n  amount CURRENCY(18,2)\n}\n");
  assert.equal(model.schemas[0].fields[0].type, "CURRENCY(18,2)");
});

test("keeps every metadata token kind, since each one changes what a reader would build", () => {
  // pk, required, enum, default and ref are distinct constraints. A projection
  // that kept only some would hand the YAML arm a weaker spec than the .stm.
  const model = project(
    "schema s {\n" +
      "  id ID (pk)\n" +
      "  name STRING (required)\n" +
      "  cur STRING(3) (default USD)\n" +
      "  stage PICKLIST (enum {open, closed})\n" +
      "  owner ID (ref other.Id)\n" +
      "}\n",
  );
  const [id, name, cur, stage, owner] = model.schemas[0].fields;
  assert.deepEqual(id.metadata, [{ kind: "tag", tag: "pk" }]);
  assert.deepEqual(name.metadata, [{ kind: "tag", tag: "required" }]);
  assert.deepEqual(cur.metadata, [{ kind: "kv", key: "default", value: "USD" }]);
  assert.deepEqual(stage.metadata, [{ kind: "enum", values: ["open", "closed"] }]);
  assert.deepEqual(owner.metadata, [{ kind: "kv", key: "ref", value: "other.Id" }]);
});

test("recurses into record bodies so nested fields are not silently flattened away", () => {
  // A nested record's leaves are where most of a real spec's content lives.
  // Keeping only the container would shrink the non-Satsuma arms dramatically.
  const model = project(
    "schema s {\n  addr record {\n    city STRING\n    postcode STRING\n  }\n}\n",
  );
  const [addr] = model.schemas[0].fields;
  assert.equal(addr.type, "record");
  assert.deepEqual(
    addr.children.map((c) => c.name),
    ["city", "postcode"],
  );
});

test("omits absent facts entirely rather than emitting empty containers", () => {
  // An explicit "metadata: []" costs bytes in YAML and JSON that the .stm never
  // spends. Absent must mean absent in all three arms.
  const model = project("schema s {\n  a STRING\n}\n");
  assert.ok(!("metadata" in model.schemas[0].fields[0]));
  assert.ok(!("fragments" in model), "an empty construct list should not appear at all");
});

test("keeps a //! warning comment, which carries reviewer intent nothing else records", () => {
  // Warnings are authored prose that a reader acts on. Dropping them would
  // remove content from the YAML arm that the .stm reader still gets.
  const model = project("schema s {\n  a STRING //! finance overrides this by hand\n}\n");
  assert.equal(model.warnings[0].text, "finance overrides this by hand");
  assert.equal(model.warnings[0].parent, "s");
});

test("keeps a natural-language transform body verbatim, including its @refs", () => {
  // The NL body is the implementable content of the arrow. Summarising or
  // dropping it is exactly the "summary drift" failure the PRD documents for
  // the markdown arm, and it would bias this measurement the same way.
  const model = project(
    'schema a {\n  x STRING\n}\nschema b {\n  y STRING\n}\nmapping m {\n  source { a }\n  target { b }\n  x -> y {\n    "Use @x unless it is null"\n    | trim\n  }\n}\n',
  );
  const [arrow] = model.mappings[0].arrows;
  assert.match(arrow.transform, /Use @x unless it is null/);
  assert.match(arrow.transform, /trim/);
});

test("keeps every value-map case including the _ wildcard", () => {
  // The wildcard is the default branch. A YAML rendering without it would be
  // ambiguous about unmatched input, so the arms would not be paired.
  const model = project(
    'schema a {\n  x STRING\n}\nschema b {\n  y STRING\n}\nmapping m {\n  source { a }\n  target { b }\n  x -> y {\n    map {\n      open: "o"\n      _: "unknown"\n    }\n  }\n}\n',
  );
  const [arrow] = model.mappings[0].arrows;
  assert.match(arrow.transform, /open/);
  assert.match(arrow.transform, /_:/);
});

test("keeps a computed arrow that declares no source field", () => {
  // "-> is_closed { ... }" has an empty source list. A projection that assumed
  // every arrow has a source would drop the whole arrow.
  const model = project(
    'schema a {\n  x STRING\n}\nschema b {\n  y BOOLEAN\n}\nmapping m {\n  source { a }\n  target { b }\n  -> y {\n    "True when @x is set"\n  }\n}\n',
  );
  const [arrow] = model.mappings[0].arrows;
  assert.equal(arrow.target, "y");
  assert.match(arrow.transform, /True when @x is set/);
});

test("keeps imports, so a spec that draws definitions from another file still says so", () => {
  const model = project('import { shared } from "../lib/shared.stm"\n');
  assert.deepEqual(model.imports, [{ names: ["shared"], path: "../lib/shared.stm" }]);
});

test("assertTotality rejects a construct no renderer handles, rather than letting it vanish", () => {
  // This is the negative test that protects the measurement over time: add a
  // language feature, and the projection starts emitting a construct the YAML
  // renderer does not know about. Without this guard the fact would silently
  // drop out of arms Y and J, shrinking them and inflating Satsuma's advantage
  // — a passing suite reporting a wrong number.
  const model = { schemas: [], mappings: [] };
  assert.throws(
    () => assertTotality(model, ["schemas"]),
    /construct\(s\) no renderer handles: mappings/,
  );
});

test("assertTotality passes when the renderer covers every construct the projection can emit", () => {
  // The complement of the case above: the guard must not fire spuriously, or
  // it would be disabled and stop protecting anything.
  const model = Object.fromEntries(REQUIRED_CONSTRUCTS.map((key) => [key, []]));
  assert.doesNotThrow(() => assertTotality(model, REQUIRED_CONSTRUCTS));
});

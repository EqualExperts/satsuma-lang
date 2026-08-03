/**
 * lint-lineage-cycle.test.js — semantics of the `lineage-cycle` rule.
 *
 * This suite owns what the rule *means*: which edges the schema graph has, the
 * self-mapping exemption, that a tangle is reported once rather than once per
 * rotation through it, and that the representative path is canonical. The CLI's
 * suite covers only registration and the `--json` shape.
 *
 * Snippets are parsed with the real grammar and fed through core's own
 * extraction, so the graph under test is built from the same mapping records a
 * consumer supplies.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initParser,
  getParser,
  canonicalizeEntityRef,
  detectLineageCycles,
  extractMappings,
  extractSchemas,
  LINEAGE_CYCLE_RULE_ID,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

const TEST_FILE = "/w/test.stm";

before(async () => {
  await initParser(WASM_PATH);
});

// ── Harness ─────────────────────────────────────────────────────────────────

/** Index key convention shared by core and the CLI: `ns::name`, or the bare name. */
function indexKey(namespace, name, row) {
  const label = name ?? `<anon>@${TEST_FILE}:${row}`;
  return namespace ? `${namespace}::${label}` : label;
}

/**
 * Build a {@link LineageCycleInput} from Satsuma source.
 *
 * `order` optionally permutes the mapping records before they are indexed, which
 * is how the determinism cases simulate a different file-load order without
 * rewriting the snippet.
 */
function inputFor(source, order = (records) => records) {
  const root = getParser().parse(source).rootNode;

  const schemas = new Map();
  for (const schema of extractSchemas(root)) {
    if (schema.name) {
      schemas.set(schema.namespace ? `${schema.namespace}::${schema.name}` : schema.name, schema);
    }
  }

  const mappings = new Map();
  for (const mapping of order([...extractMappings(root)])) {
    mappings.set(indexKey(mapping.namespace, mapping.name, mapping.row), {
      ...mapping,
      file: TEST_FILE,
    });
  }

  const resolveSchemaId = (writtenRef, mappingNamespace) => {
    const canonicalRef = canonicalizeEntityRef(writtenRef, mappingNamespace, schemas);
    if (!canonicalRef) return null;
    return canonicalRef.startsWith("::") ? canonicalRef.slice(2) : canonicalRef;
  };

  return { mappings, resolveSchemaId };
}

/** Findings for a snippet. */
function findingsFor(source, order) {
  return detectLineageCycles(inputFor(source, order));
}

/** Declare `names` as empty schemas — the graph only cares that they resolve. */
function schemas(...names) {
  return names.map((name) => `schema ${name} { id INT }`).join("\n");
}

/** A mapping named `name` moving data from `from` to `to`. */
function mapping(name, from, to) {
  return `
mapping ${name} {
  source { ${from} }
  target { ${to} }
  id -> id
}
`;
}

// ── The two-schema cycle ────────────────────────────────────────────────────

describe("a cycle between two schemas", () => {
  const TWO_SCHEMA_CYCLE = [
    schemas("a", "b"),
    mapping("a_to_b", "a", "b"),
    mapping("b_to_a", "b", "a"),
  ].join("\n");

  it("reports exactly one warning for the pair, not one per mapping", () => {
    // Two mappings participate but there is one tangle to untangle. Reporting per
    // mapping would double the noise for every cycle in the workspace.
    const findings = findingsFor(TWO_SCHEMA_CYCLE);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, LINEAGE_CYCLE_RULE_ID);
    assert.equal(findings[0].severity, "warning");
    assert.equal(findings[0].column, 1);
  });

  it("shows the cycle as a path that returns to where it started", () => {
    // The path is the finding's whole value: a reviewer needs to see the loop,
    // not a set of schema names. It is entered at the smallest id, so `a` first.
    assert.match(findingsFor(TWO_SCHEMA_CYCLE)[0].message, /Lineage cycle: a -> b -> a\./);
  });

  it("names the mapping responsible for each hop", () => {
    // The reviewer's next question is always "which mapping do I look at?" — a
    // path of schema names alone does not answer it.
    const { message } = findingsFor(TWO_SCHEMA_CYCLE)[0];

    assert.match(message, /a -> b \(mapping 'a_to_b'\)/);
    assert.match(message, /b -> a \(mapping 'b_to_a'\)/);
  });

  it("anchors the finding on the mapping declaring the path's first hop", () => {
    // So an editor jump lands on a mapping the reader can change, rather than on
    // a schema declaration that is not the problem.
    const firstHopLine =
      TWO_SCHEMA_CYCLE.split("\n").findIndex((l) => l.includes("mapping a_to_b")) + 1;
    const finding = findingsFor(TWO_SCHEMA_CYCLE)[0];

    assert.equal(finding.file, TEST_FILE);
    assert.equal(finding.line, firstHopLine);
  });

  it("names every mapping declaring one edge, not just the first", () => {
    // Two mappings can both read `a` and write `b`. Naming one would send the
    // reviewer to fix a single arrow and leave the cycle standing.
    const { message } = findingsFor(
      [
        schemas("a", "b"),
        mapping("first_a_to_b", "a", "b"),
        mapping("second_a_to_b", "a", "b"),
        mapping("b_to_a", "b", "a"),
      ].join("\n"),
    )[0];

    assert.match(message, /a -> b \(mapping 'first_a_to_b' and 'second_a_to_b'\)/);
  });
});

// ── The self-mapping exemption ──────────────────────────────────────────────

describe("self-mappings", () => {
  it("reports nothing for a mapping whose source and target are the same schema", () => {
    // Regression-locks the recorded product decision: "self-mappings (same source
    // and target schema) are OK — we can use that to represent things like
    // increments, and DON'T cause graph cycles" (docs/product-owner/ROADMAP.md).
    assert.deepEqual(findingsFor([schemas("a"), mapping("increment", "a", "a")].join("\n")), []);
  });

  it("still records the other edges of a mapping that also maps a schema to itself", () => {
    // The exemption is per-*edge*, not per-mapping: `source { a } target { a, b }`
    // drops `a -> a` but keeps `a -> b`, so a cycle running through `b` is real.
    const findings = findingsFor(
      [
        schemas("a", "b"),
        mapping("increment_and_load", "a", "a, b"),
        mapping("b_to_a", "b", "a"),
      ].join("\n"),
    );

    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /Lineage cycle: a -> b -> a\./);
  });
});

// ── One finding per component ───────────────────────────────────────────────

describe("one finding per strongly-connected component", () => {
  it("reports a three-schema cycle once", () => {
    // `a -> b -> c -> a` is one tangle however many mappings draw it.
    const findings = findingsFor(
      [
        schemas("a", "b", "c"),
        mapping("a_to_b", "a", "b"),
        mapping("b_to_c", "b", "c"),
        mapping("c_to_a", "c", "a"),
      ].join("\n"),
    );

    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /Lineage cycle: a -> b -> c -> a\./);
  });

  it("reports a densely tangled component once, however many rotations it holds", () => {
    // A component holding several elementary cycles (a-b-a, a-c-a, b-c-b, a-b-c-a …)
    // is one tangle. Enumerating elementary cycles is output-exponential, which is
    // why SCC-per-finding replaced the truncation cap the rule was first specified
    // with (doc review 2026-07-31).
    const findings = findingsFor(
      [
        schemas("a", "b", "c"),
        mapping("a_to_b", "a", "b"),
        mapping("b_to_a", "b", "a"),
        mapping("a_to_c", "a", "c"),
        mapping("c_to_a", "c", "a"),
        mapping("b_to_c", "b", "c"),
        mapping("c_to_b", "c", "b"),
      ].join("\n"),
    );

    assert.equal(findings.length, 1);
  });

  it("names the component members the representative path does not visit", () => {
    // The shortest cycle through a large component can be two hops long, which on
    // its own would read as a two-schema problem. The remaining members are named
    // so nothing in the tangle is hidden.
    const { message } = findingsFor(
      [
        schemas("a", "b", "c", "d"),
        mapping("a_to_b", "a", "b"),
        mapping("b_to_a", "b", "a"),
        mapping("b_to_c", "b", "c"),
        mapping("c_to_d", "c", "d"),
        mapping("d_to_a", "d", "a"),
      ].join("\n"),
    )[0];

    assert.match(message, /Lineage cycle: a -> b -> a\./);
    assert.match(message, /Component also includes c, d\./);
  });

  it("reports two independent cycles separately", () => {
    // Two disjoint components are two unrelated problems, and collapsing them into
    // one finding would hide one of them.
    const findings = findingsFor(
      [
        schemas("a", "b", "y", "z"),
        mapping("a_to_b", "a", "b"),
        mapping("b_to_a", "b", "a"),
        mapping("y_to_z", "y", "z"),
        mapping("z_to_y", "z", "y"),
      ].join("\n"),
    );

    assert.equal(findings.length, 2);
    assert.deepEqual(
      findings.map((f) => f.message.match(/Lineage cycle: ([^.]+)\./)[1]),
      ["a -> b -> a", "y -> z -> y"],
    );
  });

  it("reports nothing for an acyclic chain", () => {
    // A layered pipeline is the normal case; the rule must be silent on it or it
    // is unusable. Also guards against a bug where every node became its own
    // one-member component finding.
    assert.deepEqual(
      findingsFor(
        [
          schemas("raw", "clean", "mart"),
          mapping("stage", "raw", "clean"),
          mapping("publish", "clean", "mart"),
        ].join("\n"),
      ),
      [],
    );
  });
});

// ── Determinism ─────────────────────────────────────────────────────────────

describe("stability of the representative path", () => {
  const THREE_SCHEMA_CYCLE = [
    schemas("a", "b", "c"),
    mapping("a_to_b", "a", "b"),
    mapping("b_to_c", "b", "c"),
    mapping("c_to_a", "c", "a"),
  ].join("\n");

  it("describes the same cycle whatever order the mappings were indexed in", () => {
    // A CI diff of lint output must not change because a file loaded in a
    // different order. Entry at the smallest id plus a breadth-first walk over
    // sorted adjacency is what guarantees it.
    const declared = findingsFor(THREE_SCHEMA_CYCLE);
    const reversed = findingsFor(THREE_SCHEMA_CYCLE, (records) => [...records].reverse());
    const rotated = findingsFor(THREE_SCHEMA_CYCLE, (records) => [
      records[2],
      records[0],
      records[1],
    ]);

    assert.equal(declared.length, 1);
    assert.deepEqual(reversed, declared);
    assert.deepEqual(rotated, declared);
  });

  it("enters the cycle at its lexicographically smallest schema", () => {
    // Canonical entry is what makes the path a *representative* rather than an
    // artefact of which mapping happened to be visited first.
    const { message } = findingsFor(
      [schemas("m", "z"), mapping("z_to_m", "z", "m"), mapping("m_to_z", "m", "z")].join("\n"),
    )[0];

    assert.match(message, /Lineage cycle: m -> z -> m\./);
  });

  it("picks the shortest cycle through the entry schema", () => {
    // `a -> b -> a` and `a -> b -> c -> a` both pass through `a`; the shorter one
    // is the more readable representative, and choosing by length keeps the choice
    // independent of edge insertion order.
    const { message } = findingsFor(
      [
        schemas("a", "b", "c"),
        mapping("a_to_b", "a", "b"),
        mapping("b_to_c", "b", "c"),
        mapping("c_to_a", "c", "a"),
        mapping("b_to_a", "b", "a"),
      ].join("\n"),
    )[0];

    assert.match(message, /Lineage cycle: a -> b -> a\./);
  });
});

// ── Graph construction edge cases ───────────────────────────────────────────

describe("building the schema graph", () => {
  it("treats a schema referred to by two spellings as one node", () => {
    // Inside `namespace crm` a mapping writes `orders`; from outside it writes
    // `crm::orders`. Resolving to one id is what makes the cycle between them
    // visible — two nodes would hide it entirely.
    const findings = findingsFor(`
namespace crm {
  schema orders { id INT }
  schema invoices { id INT }

  mapping orders_to_invoices {
    source { orders }
    target { invoices }
    id -> id
  }
}

mapping invoices_to_orders {
  source { crm::invoices }
  target { crm::orders }
  id -> id
}
`);

    assert.equal(findings.length, 1);
    assert.match(
      findings[0].message,
      /Lineage cycle: crm::invoices -> crm::orders -> crm::invoices\./,
    );
  });

  it("drops an edge whose schema the workspace does not declare", () => {
    // An undeclared reference is `validate`'s finding. Inventing a node for it
    // could only ever produce a cycle that does not exist.
    assert.deepEqual(
      findingsFor(
        [
          schemas("a"),
          mapping("a_to_ghost", "a", "ghost"),
          mapping("ghost_to_a", "ghost", "a"),
        ].join("\n"),
      ),
      [],
    );
  });

  it("names an anonymous mapping by its position", () => {
    // An anonymous `mapping { … }` block has no label, and a finding that omitted
    // it would leave one hop of the cycle unattributed.
    const source = `
${schemas("a", "b")}
mapping {
  source { a }
  target { b }
  id -> id
}
${mapping("b_to_a", "b", "a")}
`;
    const anonLine = source.split("\n").findIndex((l) => l.trim() === "mapping {") + 1;

    assert.match(
      findingsFor(source)[0].message,
      new RegExp(`anonymous mapping at line ${anonLine}`),
    );
  });
});

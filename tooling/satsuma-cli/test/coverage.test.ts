/**
 * coverage.test.ts — End-to-end behaviour of `satsuma coverage`.
 *
 * Coverage *semantics* are tested in satsuma-core (coverage.test.js and
 * coverage-rollup.test.js) and are deliberately not re-tested here. What can only
 * break at this level is the CLI's own surface: index adaptation (resolving
 * namespaced schema references, expanding spreads, attaching positions), the
 * scoping flags, the JSON contract, exit codes, and the rendered report.
 *
 * The last test in this file is the load-bearing one: it locks `coverage` and
 * `fields --unmapped-by` to the same answer. Those two commands answered the same
 * question from independently maintained code before sl-oqsj, which is the drift
 * feature 35 exists to prevent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run as _run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const WORKSPACE = resolve(__dirname, "fixtures/coverage-workspace.stm");
const NESTED = resolve(__dirname, "fixtures/unmapped-nested.stm");

const run = (...args: string[]) => _run(CLI, ...args);

/** Parse `--json` output, failing with the raw text when it is not JSON. */
function parseJson(stdout: string): any {
  try {
    return JSON.parse(stdout);
  } catch {
    assert.fail(`expected JSON output, got:\n${stdout}`);
  }
}

/** The JSON entry for one mapping. */
function mappingEntry(data: any, mapping: string): any {
  const found = data.mappings.find((m: any) => m.mapping === mapping);
  assert.ok(found, `expected mapping ${mapping} in ${JSON.stringify(data.mappings.map((m: any) => m.mapping))}`);
  return found;
}

/** The JSON entry for one schema in one role of one mapping. */
function schemaEntry(data: any, mapping: string, role: string, schema: string): any {
  const found = mappingEntry(data, mapping).schemas.find(
    (s: any) => s.role === role && s.schema === schema,
  );
  assert.ok(found, `expected ${role} ${schema} in ${mapping}`);
  return found;
}

// ── Default report ──────────────────────────────────────────────────────────

describe("satsuma coverage — default report", () => {
  it("reports every named mapping in the workspace, not just the entry file's first", async () => {
    // The command's reason to exist is a workspace-wide answer; reporting one
    // mapping would leave the caller composing the rest by hand.
    const { stdout, code } = await run("coverage", WORKSPACE, "--json");
    assert.equal(code, 0);
    assert.deepEqual(
      parseJson(stdout).mappings.map((m: any) => m.mapping).sort(),
      ["billing::flatten invoices", "crm::annotate contacts", "crm::load contacts"],
    );
  });

  it("labels the report as per-mapping so aggregate figures are not assumed", async () => {
    // "Uncovered by this mapping" is a weaker claim than "uncovered by every
    // mapping". A reviewer acting on the wrong one deletes a live field.
    const { stdout } = await run("coverage", WORKSPACE);
    assert.match(stdout, /per mapping/);
  });

  it("names the uncovered fields, not just how many there are", async () => {
    // A count alone is not actionable; the point of the report is the queue of
    // paths to go and map.
    const { stdout, code } = await run("coverage", WORKSPACE, "--mapping", "load contacts");
    assert.equal(code, 0);
    assert.match(stdout, /uncovered in crm::contacts \(target\)/);
    assert.match(stdout, /memo/);
  });
});

// ── Index adaptation ────────────────────────────────────────────────────────

describe("satsuma coverage — resolving the workspace index", () => {
  it("resolves namespaced schema references to their canonical keys", async () => {
    // A mapping inside `namespace crm` may write `crm::customers` or bare
    // `customers` for the same schema. Reporting the written form would split one
    // schema across two keys when results are rolled up.
    const { stdout, code } = await run("coverage", WORKSPACE, "--json");
    assert.equal(code, 0);
    const schemas = parseJson(stdout).mappings.flatMap((m: any) => m.schemas.map((s: any) => s.schema));
    for (const schema of schemas) {
      assert.match(schema, /^(crm|billing)::/, `expected a namespace-qualified key, got ${schema}`);
    }
  });

  it("counts a nested leaf independently of its sibling and its parent record", async () => {
    // The PRD's headline nested case. `address.city -> city` must not vouch for
    // `address.line1`, and `address` itself must not be counted as data.
    const { stdout } = await run("coverage", WORKSPACE, "--mapping", "load contacts", "--json");
    const source = schemaEntry(parseJson(stdout), "crm::load contacts", "source", "crm::customers");
    assert.deepEqual(
      source.fields.map((f: any) => [f.path, f.mapped]),
      [["id", true], ["address.city", true], ["address.line1", false], ["nickname", false]],
    );
    assert.deepEqual(
      { covered: source.covered, total: source.total, pct: source.pct },
      { covered: 2, total: 4, pct: 50 },
    );
  });

  it("resolves element-relative arrows inside an each block against the list", async () => {
    // `.sku -> .code` under `each lines -> rows` covers lines.sku and rows.code.
    // Failing to strip the leading dot reported both as gaps (sc-xnxp).
    const { stdout } = await run("coverage", WORKSPACE, "--mapping", "flatten invoices", "--json");
    const data = parseJson(stdout);
    const source = schemaEntry(data, "billing::flatten invoices", "source", "billing::invoices");
    assert.deepEqual(
      source.fields.map((f: any) => [f.path, f.mapped]),
      [["id", true], ["lines.sku", true], ["lines.qty", false]],
    );
    const target = schemaEntry(data, "billing::flatten invoices", "target", "billing::invoice_rows");
    assert.deepEqual(target.fields.map((f: any) => [f.path, f.mapped]), [["id", true], ["rows.code", true]]);
  });

  it("reports a schema written by one mapping and read by another under both roles", async () => {
    // A staging schema's two questions — is it populated, is it consumed — are
    // different, and blending them would answer neither.
    const { stdout } = await run("coverage", WORKSPACE, "--schema", "contacts", "--json");
    const roles = parseJson(stdout).mappings.flatMap((m: any) =>
      m.schemas.map((s: any) => [m.mapping, s.role]),
    );
    assert.deepEqual(roles.sort(), [
      ["crm::annotate contacts", "target"],
      ["crm::load contacts", "target"],
    ]);
  });
});

// ── Scoping flags ───────────────────────────────────────────────────────────

describe("satsuma coverage — scoping flags", () => {
  it("--mapping restricts the report to one mapping", async () => {
    const { stdout, code } = await run("coverage", WORKSPACE, "--mapping", "load contacts", "--json");
    assert.equal(code, 0);
    assert.deepEqual(parseJson(stdout).mappings.map((m: any) => m.mapping), ["crm::load contacts"]);
  });

  it("--schema keeps only that schema, across every mapping using it", async () => {
    // The single-schema view a reviewer wants when auditing one target table.
    const { stdout, code } = await run("coverage", WORKSPACE, "--schema", "crm::customers", "--json");
    assert.equal(code, 0);
    const data = parseJson(stdout);
    assert.deepEqual(data.mappings.map((m: any) => m.mapping).sort(), ["crm::annotate contacts", "crm::load contacts"]);
    for (const mapping of data.mappings) {
      assert.deepEqual(mapping.schemas.map((s: any) => s.schema), ["crm::customers"]);
    }
  });

  it("--role target drops the source-side entries", async () => {
    const { stdout, code } = await run("coverage", WORKSPACE, "--role", "target", "--json");
    assert.equal(code, 0);
    const roles = parseJson(stdout).mappings.flatMap((m: any) => m.schemas.map((s: any) => s.role));
    assert.deepEqual([...new Set(roles)], ["target"]);
  });

  it("composes --schema with --role to a single entry", async () => {
    // Filters have to intersect, not override: this is how --fail-under will
    // later gate one specific figure (sl-268g).
    const { stdout, code } = await run(
      "coverage", WORKSPACE, "--schema", "crm::customers", "--role", "target", "--json",
    );
    // crm::customers is never a target, so the intersection is empty.
    assert.equal(code, 1);
    assert.match(stdout, /No coverage matches .*schema 'crm::customers'.*role 'target'/);
  });

  it("--uncovered drops the covered fields and the schemas with no gaps", async () => {
    // The review-queue view: everything left on screen is work to do.
    const { stdout, code } = await run(
      "coverage", WORKSPACE, "--mapping", "flatten invoices", "--uncovered", "--json",
    );
    assert.equal(code, 0);
    const data = parseJson(stdout);
    const target = schemaEntry(data, "billing::flatten invoices", "target", "billing::invoice_rows");
    assert.deepEqual(target.fields, [], "invoice_rows is fully populated, so it has no uncovered fields");
    const source = schemaEntry(data, "billing::flatten invoices", "source", "billing::invoices");
    assert.deepEqual(source.fields.map((f: any) => f.path), ["lines.qty"]);
  });

  it("--uncovered leaves the counts as the full denominator", async () => {
    // "1 of 3" is the useful figure; recomputing counts over the filtered list
    // would report "0 of 1" and lose the scale of the gap.
    const { stdout } = await run(
      "coverage", WORKSPACE, "--mapping", "flatten invoices", "--uncovered", "--json",
    );
    const source = schemaEntry(parseJson(stdout), "billing::flatten invoices", "source", "billing::invoices");
    assert.deepEqual({ covered: source.covered, total: source.total }, { covered: 2, total: 3 });
  });
});

// ── JSON contract ───────────────────────────────────────────────────────────

describe("satsuma coverage — JSON contract", () => {
  it("emits the documented top-level shape", async () => {
    // Feature 36's overlay renders from this shape, so its keys are a contract.
    const { stdout } = await run("coverage", WORKSPACE, "--mapping", "load contacts", "--json");
    const mapping = mappingEntry(parseJson(stdout), "crm::load contacts");
    assert.deepEqual(Object.keys(mapping), ["mapping", "file", "schemas"]);
    assert.equal(mapping.file, WORKSPACE);
    assert.deepEqual(
      Object.keys(mapping.schemas[0]),
      ["schema", "role", "covered", "total", "pct", "fields"],
    );
  });

  it("reports field lines 1-indexed, matching every other command's JSON", async () => {
    // Row numbering drifted between commands before cbh-7rvo; JSON and human
    // output must agree so a jump link built from either lands in the same place.
    const { stdout } = await run("coverage", WORKSPACE, "--mapping", "load contacts", "--json");
    const source = schemaEntry(parseJson(stdout), "crm::load contacts", "source", "crm::customers");
    const nickname = source.fields.find((f: any) => f.path === "nickname");
    // `nickname STRING` is on line 17 of the fixture, counting from 1.
    assert.equal(nickname.line, 17);
    assert.equal(nickname.file, WORKSPACE);
  });

  it("lists leaf fields only, so the list and the counts are one population", async () => {
    // A three-path list under a count of two would be a report contradicting
    // itself. Records are excluded from both.
    const { stdout } = await run("coverage", WORKSPACE, "--mapping", "load contacts", "--json");
    const source = schemaEntry(parseJson(stdout), "crm::load contacts", "source", "crm::customers");
    assert.equal(source.fields.length, source.total);
    assert.ok(!source.fields.some((f: any) => f.path === "address"), "the 'address' record must not be listed");
  });
});

// ── Exit codes ──────────────────────────────────────────────────────────────

describe("satsuma coverage — exit codes", () => {
  it("exits 1 with a suggestion when --mapping names nothing", async () => {
    // Must stay distinct from a coverage-threshold failure (sl-268g): CI has to
    // tell "the spec is incomplete" from "the invocation is broken".
    const { stderr, code } = await run("coverage", WORKSPACE, "--mapping", "load contact");
    assert.equal(code, 1);
    assert.match(stderr, /Mapping 'load contact' not found/);
  });

  it("exits 1 when --schema names nothing", async () => {
    const { stderr, code } = await run("coverage", WORKSPACE, "--schema", "custmers");
    assert.equal(code, 1);
    assert.match(stderr, /Schema 'custmers' not found/);
  });

  it("exits 2 for an unreadable entry file", async () => {
    const { code } = await run("coverage", resolve(__dirname, "fixtures/does-not-exist.stm"));
    assert.equal(code, 2);
  });

  it("rejects an invalid --role rather than silently reporting both", async () => {
    // Ignoring the flag would look like a bug in the numbers, not the command line.
    const { stderr, code } = await run("coverage", WORKSPACE, "--role", "sources");
    assert.equal(code, 2);
    assert.match(stderr, /Invalid --role 'sources'/);
  });
});

// ── Agreement with `fields --unmapped-by` ───────────────────────────────────

describe("satsuma coverage vs fields --unmapped-by", () => {
  /** Leaf paths from a `fields --json` tree, dotted from the schema root. */
  function leafPaths(fields: any[], prefix = ""): string[] {
    return fields.flatMap((f: any) => {
      const path = prefix ? `${prefix}.${f.name}` : f.name;
      return f.children?.length ? leafPaths(f.children, path) : [path];
    });
  }

  it("reports the identical uncovered field set for one schema and one mapping", async () => {
    // The lock that keeps the two surfaces from drifting. They are now the same
    // computation; if this ever fails, one of them has grown its own copy again.
    const [viaFields, viaCoverage] = await Promise.all([
      run("fields", "nested_tgt", "--unmapped-by", "partial_map", "--json", NESTED),
      run("coverage", NESTED, "--uncovered", "--mapping", "partial_map", "--schema", "nested_tgt", "--json"),
    ]);
    assert.equal(viaFields.code, 0);
    assert.equal(viaCoverage.code, 0);

    const fromFields = leafPaths(parseJson(viaFields.stdout)).sort();
    const fromCoverage = schemaEntry(parseJson(viaCoverage.stdout), "::partial_map", "target", "::nested_tgt")
      .fields.map((f: any) => f.path)
      .sort();
    assert.deepEqual(fromCoverage, fromFields);
    assert.ok(fromFields.length > 0, "the fixture must actually have gaps for this to prove anything");
  });

  it("agrees that a fully-mapped schema has no uncovered fields", async () => {
    // The other end of the range: both surfaces must report empty, not one
    // reporting the record shell it pruned differently.
    const [viaFields, viaCoverage] = await Promise.all([
      run("fields", "nested_tgt", "--unmapped-by", "full_map", "--json", NESTED),
      run("coverage", NESTED, "--uncovered", "--mapping", "full_map", "--schema", "nested_tgt", "--json"),
    ]);
    assert.deepEqual(parseJson(viaFields.stdout), []);
    assert.deepEqual(
      schemaEntry(parseJson(viaCoverage.stdout), "::full_map", "target", "::nested_tgt").fields,
      [],
    );
  });
});

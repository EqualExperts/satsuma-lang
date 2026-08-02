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
// The repo's canonical nested-iteration example: two levels of `each` with a
// `flatten` inside them. Fully mapped apart from one deliberately unread field,
// which makes it the reference case for nested container coverage (sl-qzy3).
const NESTED_ITERATION = resolve(__dirname, "../../../examples/nested-iteration/pipeline.stm");
const NESTED_ARROW = resolve(__dirname, "fixtures/nested-arrow-lookup.stm");
// Two source schemas declaring the same field names, arrows qualified by schema
// and written inside a namespace — the pairing that exercises prefix resolution
// against the canonical index key (sl-joeq).
const MULTI_SOURCE = resolve(__dirname, "fixtures/coverage-multi-source.stm");

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
  assert.ok(
    found,
    `expected mapping ${mapping} in ${JSON.stringify(data.mappings.map((m: any) => m.mapping))}`,
  );
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
      parseJson(stdout)
        .mappings.map((m: any) => m.mapping)
        .sort(),
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
    const schemas = parseJson(stdout).mappings.flatMap((m: any) =>
      m.schemas.map((s: any) => s.schema),
    );
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
      [
        ["id", true],
        ["address.city", true],
        ["address.line1", false],
        ["nickname", false],
      ],
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
      [
        ["id", true],
        ["lines.sku", true],
        ["lines.qty", false],
      ],
    );
    const target = schemaEntry(
      data,
      "billing::flatten invoices",
      "target",
      "billing::invoice_rows",
    );
    assert.deepEqual(
      target.fields.map((f: any) => [f.path, f.mapped]),
      [
        ["id", true],
        ["rows.code", true],
      ],
    );
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

  it("resolves a bare schema prefix on an arrow against the canonical namespaced key", async () => {
    // Multi-source mappings qualify their arrows by schema, and inside a
    // namespace they write the bare name (`crm.email`) while the index reports
    // `warehouse::crm`. The CLI owns that canonicalisation, so this pairing can
    // only break here — and it must resolve onto nested declared paths too
    // (`crm.consent.email_marketing` -> `consent.email_marketing`), which the
    // qualified form silently failed to do before sl-joeq.
    const { stdout, code } = await run("coverage", MULTI_SOURCE, "--json");
    assert.equal(code, 0);
    const crm = schemaEntry(parseJson(stdout), "warehouse::assemble", "source", "warehouse::crm");
    assert.deepEqual(
      crm.fields.map((f: any) => [f.path, f.mapped]),
      [
        ["customer_id", true],
        ["email", true],
        ["consent.email_marketing", true],
        ["consent.sms_marketing", false],
      ],
    );
  });

  it("does not credit a joined-but-unread source schema that shares field names", async () => {
    // `ledger` declares customer_id and email exactly as `crm` does but no arrow
    // reads it. Matching by leaf name reported it as fully mapped — a silent
    // over-count that makes a source nobody reads look consumed (sl-joeq).
    const { stdout } = await run("coverage", MULTI_SOURCE, "--json");
    const ledger = schemaEntry(
      parseJson(stdout),
      "warehouse::assemble",
      "source",
      "warehouse::ledger",
    );
    assert.deepEqual(
      { covered: ledger.covered, total: ledger.total, pct: ledger.pct },
      { covered: 0, total: 2, pct: 0 },
    );
  });
});

// ── Scoping flags ───────────────────────────────────────────────────────────

describe("satsuma coverage — scoping flags", () => {
  it("--mapping restricts the report to one mapping", async () => {
    const { stdout, code } = await run(
      "coverage",
      WORKSPACE,
      "--mapping",
      "load contacts",
      "--json",
    );
    assert.equal(code, 0);
    assert.deepEqual(
      parseJson(stdout).mappings.map((m: any) => m.mapping),
      ["crm::load contacts"],
    );
  });

  it("--schema keeps only that schema, across every mapping using it", async () => {
    // The single-schema view a reviewer wants when auditing one target table.
    const { stdout, code } = await run(
      "coverage",
      WORKSPACE,
      "--schema",
      "crm::customers",
      "--json",
    );
    assert.equal(code, 0);
    const data = parseJson(stdout);
    assert.deepEqual(data.mappings.map((m: any) => m.mapping).sort(), [
      "crm::annotate contacts",
      "crm::load contacts",
    ]);
    for (const mapping of data.mappings) {
      assert.deepEqual(
        mapping.schemas.map((s: any) => s.schema),
        ["crm::customers"],
      );
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
      "coverage",
      WORKSPACE,
      "--schema",
      "crm::customers",
      "--role",
      "target",
      "--json",
    );
    // crm::customers is never a target, so the intersection is empty.
    assert.equal(code, 1);
    assert.match(stdout, /No coverage matches .*schema 'crm::customers'.*role 'target'/);
  });

  it("--uncovered drops the covered fields and the schemas with no gaps", async () => {
    // The review-queue view: everything left on screen is work to do.
    const { stdout, code } = await run(
      "coverage",
      WORKSPACE,
      "--mapping",
      "flatten invoices",
      "--uncovered",
      "--json",
    );
    assert.equal(code, 0);
    const data = parseJson(stdout);
    const target = schemaEntry(
      data,
      "billing::flatten invoices",
      "target",
      "billing::invoice_rows",
    );
    assert.deepEqual(
      target.fields,
      [],
      "invoice_rows is fully populated, so it has no uncovered fields",
    );
    const source = schemaEntry(data, "billing::flatten invoices", "source", "billing::invoices");
    assert.deepEqual(
      source.fields.map((f: any) => f.path),
      ["lines.qty"],
    );
  });

  it("--uncovered leaves the counts as the full denominator", async () => {
    // "1 of 3" is the useful figure; recomputing counts over the filtered list
    // would report "0 of 1" and lose the scale of the gap.
    const { stdout } = await run(
      "coverage",
      WORKSPACE,
      "--mapping",
      "flatten invoices",
      "--uncovered",
      "--json",
    );
    const source = schemaEntry(
      parseJson(stdout),
      "billing::flatten invoices",
      "source",
      "billing::invoices",
    );
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
    assert.deepEqual(Object.keys(mapping.schemas[0]), [
      "schema",
      "role",
      "covered",
      "covered_declared",
      "covered_nl",
      "total",
      "pct",
      "fields",
    ]);
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
    assert.ok(
      !source.fields.some((f: any) => f.path === "address"),
      "the 'address' record must not be listed",
    );
  });
});

// ── Aggregate rollups ───────────────────────────────────────────────────────

describe("satsuma coverage — aggregate rollups", () => {
  /** The aggregate entry for one schema and role. */
  function aggregateEntry(data: any, role: string, schema: string): any {
    const found = data.aggregate.schemas.find((s: any) => s.role === role && s.schema === schema);
    assert.ok(
      found,
      `expected aggregate ${role} ${schema} in ${JSON.stringify(data.aggregate.schemas.map((s: any) => [s.role, s.schema]))}`,
    );
    return found;
  }

  it("counts a field covered when any one mapping covers it", async () => {
    // crm::contacts.memo is written by 'annotate contacts' and ignored by
    // 'load contacts'. The aggregate is the only figure that says so.
    const { stdout, code } = await run("coverage", WORKSPACE, "--json");
    assert.equal(code, 0);
    const contacts = aggregateEntry(parseJson(stdout), "target", "crm::contacts");
    assert.deepEqual(
      { covered: contacts.covered, total: contacts.total, pct: contacts.pct },
      { covered: 3, total: 3, pct: 100 },
    );
  });

  it("keeps the per-mapping and aggregate figures for one field distinguishable", async () => {
    // The confusion the two sections exist to prevent, asserted end to end:
    // 'memo' is a gap under 'load contacts' and covered in the aggregate. A
    // reviewer who reads the wrong one deletes a field another mapping populates.
    const { stdout } = await run("coverage", WORKSPACE, "--json");
    const data = parseJson(stdout);
    const perMapping = schemaEntry(
      data,
      "crm::load contacts",
      "target",
      "crm::contacts",
    ).fields.find((f: any) => f.path === "memo");
    assert.equal(perMapping.mapped, false);
    const aggregated = aggregateEntry(data, "target", "crm::contacts").fields.find(
      (f: any) => f.path === "memo",
    );
    assert.equal(aggregated.mapped, true);
  });

  it("names the mappings behind each aggregate figure", async () => {
    // Without them an aggregate gap is not actionable — the reviewer cannot tell
    // which mapping to go and edit.
    const { stdout } = await run("coverage", WORKSPACE, "--json");
    assert.deepEqual(aggregateEntry(parseJson(stdout), "target", "crm::contacts").mappings.sort(), [
      "crm::annotate contacts",
      "crm::load contacts",
    ]);
  });

  it("counts a schema once however many mappings reference it", async () => {
    // crm::customers is a source of two mappings; counting it twice would halve
    // the workspace percentage for no reason.
    const { stdout } = await run("coverage", WORKSPACE, "--json");
    const data = parseJson(stdout);
    const sources = data.aggregate.schemas.filter((s: any) => s.role === "source");
    assert.equal(sources.filter((s: any) => s.schema === "crm::customers").length, 1);
    // customers 3/4 + invoices 2/3 = 5/7 source leaves across the workspace, all
    // via declared arrows — this fixture uses no @refs, so the nl tier is empty
    // and the split must say so rather than omitting the keys (ADR-036).
    assert.deepEqual(data.aggregate.workspace.source, {
      covered: 5,
      covered_declared: 5,
      covered_nl: 0,
      total: 7,
      pct: 71,
    });
  });

  it("reports per-namespace subtotals that sum to the workspace total", async () => {
    // Two numbers that can disagree means one of them is a lie.
    const { stdout } = await run("coverage", WORKSPACE, "--json");
    const { namespaces, workspace } = parseJson(stdout).aggregate;
    assert.deepEqual(namespaces.map((n: any) => n.namespace).sort(), ["billing", "crm"]);
    const summed = namespaces.reduce(
      (acc: any, ns: any) => ({
        covered: acc.covered + ns.source.covered,
        total: acc.total + ns.source.total,
      }),
      { covered: 0, total: 0 },
    );
    assert.deepEqual(summed, { covered: workspace.source.covered, total: workspace.source.total });
  });

  it("aggregates over the scoped mappings, not the whole workspace", async () => {
    // --fail-under will gate whatever scope is active (sl-268g), so scope has to
    // reach the aggregate. Restricted to 'load contacts' alone, memo is a gap.
    const { stdout } = await run("coverage", WORKSPACE, "--mapping", "load contacts", "--json");
    const data = parseJson(stdout);
    const contacts = aggregateEntry(data, "target", "crm::contacts");
    assert.deepEqual(
      { covered: contacts.covered, total: contacts.total },
      { covered: 2, total: 3 },
    );
    assert.deepEqual(
      data.aggregate.namespaces.map((n: any) => n.namespace),
      ["crm"],
    );
  });

  it("labels the human aggregate section with the claim it is making", async () => {
    // A section title alone is too easy to skim past; the stronger claim has to
    // be stated where the numbers are read.
    const { stdout } = await run("coverage", WORKSPACE);
    assert.match(
      stdout,
      /Aggregate — a field is uncovered here only when NO mapping in scope covers it/,
    );
    assert.match(stdout, /covered by no mapping — crm::customers \(source\)/);
  });

  it("prints namespace subtotals and a workspace total in human output", async () => {
    const { stdout } = await run("coverage", WORKSPACE);
    assert.match(stdout, /^ {2}crm\s+source\s+3\/4\s+75%\s+target\s+3\/3\s+100%$/m);
    assert.match(stdout, /^ {2}workspace\s+source\s+5\/7\s+71%\s+target\s+5\/5\s+100%$/m);
  });

  it("omits the namespace rows when there is only one group to subtotal", async () => {
    // The row would be identical to the workspace row, inviting the reader to
    // look for a difference that cannot exist.
    const { stdout } = await run("coverage", NESTED);
    assert.match(stdout, /^ {2}workspace\s+source/m);
    assert.ok(
      !/\(file scope\)/.test(stdout),
      `single-group subtotal row should be suppressed:\n${stdout}`,
    );
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

  it("rejects an invalid --role as a usage error rather than reporting both roles", async () => {
    // Silently ignoring the flag would surface as a bug in the coverage numbers
    // rather than in the command line. Exit 1 + help is the CLI's convention for
    // every other bad flag value, so --role must not invent a second one.
    const { stderr, code } = await run("coverage", WORKSPACE, "--role", "sources");
    assert.equal(code, 1);
    assert.match(stderr, /--role <role>' argument 'sources' is invalid/);
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
      run(
        "coverage",
        NESTED,
        "--uncovered",
        "--mapping",
        "partial_map",
        "--schema",
        "nested_tgt",
        "--json",
      ),
    ]);
    assert.equal(viaFields.code, 0);
    assert.equal(viaCoverage.code, 0);

    const fromFields = leafPaths(parseJson(viaFields.stdout)).sort();
    const fromCoverage = schemaEntry(
      parseJson(viaCoverage.stdout),
      "::partial_map",
      "target",
      "::nested_tgt",
    )
      .fields.map((f: any) => f.path)
      .sort();
    assert.deepEqual(fromCoverage, fromFields);
    assert.ok(
      fromFields.length > 0,
      "the fixture must actually have gaps for this to prove anything",
    );
  });

  it("agrees that a fully-mapped schema has no uncovered fields", async () => {
    // The other end of the range: both surfaces must report empty, not one
    // reporting the record shell it pruned differently.
    const [viaFields, viaCoverage] = await Promise.all([
      run("fields", "nested_tgt", "--unmapped-by", "full_map", "--json", NESTED),
      run(
        "coverage",
        NESTED,
        "--uncovered",
        "--mapping",
        "full_map",
        "--schema",
        "nested_tgt",
        "--json",
      ),
    ]);
    assert.deepEqual(parseJson(viaFields.stdout), []);
    assert.deepEqual(
      schemaEntry(parseJson(viaCoverage.stdout), "::full_map", "target", "::nested_tgt").fields,
      [],
    );
  });
});

// ── --fail-under CI gate ────────────────────────────────────────────────────

describe("satsuma coverage --fail-under", () => {
  it("exits 0 when the gated coverage meets the threshold", async () => {
    // Target coverage across the fixture's mappings is 100%, so any threshold
    // passes — the gate must not fail on the per-mapping figures beneath it.
    const { code } = await run("coverage", WORKSPACE, "--fail-under", "100");
    assert.equal(code, 0);
  });

  it("exits 3 when the gated coverage is below the threshold", async () => {
    // The distinct code is the whole point: CI has to tell an incomplete spec
    // from a broken invocation.
    const { code } = await run("coverage", WORKSPACE, "--fail-under", "90", "--role", "source");
    assert.equal(code, 3);
  });

  it("exits 1, not 3, when --mapping names something that does not exist", async () => {
    // The case that motivated a separate code. If both were 1, a misspelled
    // mapping name and genuine under-coverage would be indistinguishable, and CI
    // could not tell "fix the pipeline" from "finish the mapping".
    const { stderr, code } = await run(
      "coverage",
      WORKSPACE,
      "--fail-under",
      "90",
      "--mapping",
      "typo",
    );
    assert.equal(code, 1);
    assert.match(stderr, /Mapping 'typo' not found/);
  });

  it("exits 2 for a parse or filesystem error, whatever the threshold", async () => {
    const { code } = await run(
      "coverage",
      resolve(__dirname, "fixtures/does-not-exist.stm"),
      "--fail-under",
      "90",
    );
    assert.equal(code, 2);
  });

  it("gates target coverage by default", async () => {
    // Completeness at sign-off is about what the spec produces, so the default
    // measures the target side even though both roles are reported.
    const { stdout, code } = await run("coverage", WORKSPACE, "--fail-under", "100", "--json");
    assert.equal(code, 0);
    const { gate } = parseJson(stdout);
    assert.deepEqual(gate, { role: "target", threshold: 100, pct: 100, met: true });
  });

  it("gates source consumption when combined with --role source", async () => {
    const { stdout, code } = await run(
      "coverage",
      WORKSPACE,
      "--fail-under",
      "90",
      "--role",
      "source",
      "--json",
    );
    assert.equal(code, 3);
    assert.deepEqual(parseJson(stdout).gate, {
      role: "source",
      threshold: 90,
      pct: 71,
      met: false,
    });
  });

  it("gates the scoped percentage when --mapping narrows the report", async () => {
    // 'load contacts' alone leaves memo unwritten, so the same workspace that
    // passes at 100% aggregate fails once the scope is one mapping.
    const { stdout, code } = await run(
      "coverage",
      WORKSPACE,
      "--mapping",
      "load contacts",
      "--fail-under",
      "100",
      "--json",
    );
    assert.equal(code, 3);
    assert.deepEqual(parseJson(stdout).gate, {
      role: "target",
      threshold: 100,
      pct: 67,
      met: false,
    });
  });

  it("still prints the report when the gate fails", async () => {
    // A gate that printed only a verdict would tell CI it failed without telling
    // anyone which fields to go and map.
    const { stdout } = await run("coverage", WORKSPACE, "--fail-under", "90", "--role", "source");
    assert.match(stdout, /covered by no mapping — crm::customers \(source\)/);
    assert.match(stdout, /--fail-under: source coverage 71% vs threshold 90% — NOT met/);
  });

  it("exits 1 when the gated role has nothing in scope to measure", async () => {
    // crm::customers is only ever a source, so gating target coverage measures
    // nothing. Reporting that as 0% would blame the spec for an invocation error.
    const { stderr, code } = await run(
      "coverage",
      WORKSPACE,
      "--schema",
      "crm::customers",
      "--fail-under",
      "90",
    );
    assert.equal(code, 1);
    assert.match(stderr, /No target-role coverage in scope to gate/);
    assert.match(stderr, /use --role source/);
  });

  it("omits the gate from JSON when --fail-under is absent", async () => {
    // A gate key that is always present would push consumers into checking
    // met === false on a check nobody asked for.
    const { stdout } = await run("coverage", WORKSPACE, "--json");
    assert.ok(!("gate" in parseJson(stdout)), "no gate should be reported without --fail-under");
  });

  it("rejects a threshold above 100 as a usage error", async () => {
    // A gate that can never pass is a typo, not a policy.
    const { stderr, code } = await run("coverage", WORKSPACE, "--fail-under", "150");
    assert.equal(code, 1);
    assert.match(stderr, /Expected a whole number between 0 and 100/);
  });

  it("accepts a threshold of 0 as a trivially satisfied gate", async () => {
    // Rejecting 0 would break a pipeline that computes its own threshold and
    // legitimately arrives at zero.
    const { code } = await run("coverage", WORKSPACE, "--fail-under", "0");
    assert.equal(code, 0);
  });
});

// ── Nested containers on the real corpus (sl-qzy3) ──────────────────────────

describe("satsuma coverage — nested containers", () => {
  // These assert *percentages*, not just per-field booleans, because the
  // percentage is what --fail-under gates on. Before sl-qzy3 the walk skipped
  // `flatten` inside `each`, so this fully-mapped example reported 75% on the
  // target and would have failed `--fail-under 90` — blocking correct work.

  it("reports the fully-mapped nested-iteration target as 100%", async () => {
    const { stdout, code } = await run("coverage", NESTED_ITERATION, "--json");
    assert.equal(code, 0);
    const target = schemaEntry(
      parseJson(stdout),
      "::dispatch manifest",
      "target",
      "::dispatch_manifest_json",
    );
    assert.deepEqual(
      { covered: target.covered, total: target.total, pct: target.pct },
      { covered: 8, total: 8, pct: 100 },
    );
  });

  it("reports the one genuinely unread source leaf and nothing else", async () => {
    // orders.parcels.barcode is never referenced by any arrow; every other
    // source leaf is, including those reached only through the nested flatten.
    const { stdout } = await run("coverage", NESTED_ITERATION, "--uncovered", "--json");
    const source = schemaEntry(
      parseJson(stdout),
      "::dispatch manifest",
      "source",
      "::warehouse_dispatch_events",
    );
    assert.deepEqual(
      source.fields.map((f: any) => f.path),
      ["orders.parcels.barcode"],
    );
    assert.deepEqual(
      { covered: source.covered, total: source.total, pct: source.pct },
      { covered: 8, total: 9, pct: 89 },
    );
  });

  it("keeps fields --unmapped-by agreeing with coverage on the same example", async () => {
    // fields --unmapped-by was correct before sl-oqsj re-based it onto the core
    // walker and wrong afterwards, because the walker missed the nested flatten.
    // This pins the two commands together on a nested fixture, which is where
    // they diverged.
    const { stdout, code } = await run(
      "fields",
      "warehouse_dispatch_events",
      "--unmapped-by",
      "dispatch manifest",
      NESTED_ITERATION,
      "--json",
    );
    assert.equal(code, 0);
    const leaves: string[] = [];
    const walk = (fields: any[], prefix: string) => {
      for (const f of fields) {
        const path = prefix ? `${prefix}.${f.name}` : f.name;
        if (f.children?.length) walk(f.children, path);
        else leaves.push(path);
      }
    };
    walk(parseJson(stdout), "");
    assert.deepEqual(leaves, ["orders.parcels.barcode"]);
  });

  it("covers both sides of a braced src -> tgt arrow", async () => {
    // nested_arrow was absent from the walk, so this fixture reported 0% on
    // both sides despite every field being explicitly mapped.
    const { stdout, code } = await run("coverage", NESTED_ARROW, "--json");
    assert.equal(code, 0);
    const data = parseJson(stdout);
    for (const [role, schema] of [
      ["source", "::src_sys"],
      ["target", "::tgt_sys"],
    ] as const) {
      const entry = schemaEntry(data, "::addr_map", role, schema);
      assert.equal(entry.pct, 100, `${role} ${schema} should be fully covered`);
    }
  });
});

// ── Human vs JSON key spelling ──────────────────────────────────────────────

describe("satsuma coverage — key spelling", () => {
  // Human output and --json deliberately spell a non-namespaced entity
  // differently: `::` marks the global namespace unambiguously for a machine
  // matching keys across commands, but it is not valid Satsuma syntax and is
  // pure noise in a workspace that declares no namespaces. Namespaced entities
  // read identically in both.

  it("drops the empty namespace prefix from human output", async () => {
    const { stdout, code } = await run("coverage", NESTED_ITERATION);
    assert.equal(code, 0);
    assert.match(stdout, /^mapping dispatch manifest {2}\(/m);
    assert.match(stdout, /^ {2}target {2}dispatch_manifest_json/m);
    assert.ok(!stdout.includes("::"), `human output should carry no "::"; got:\n${stdout}`);
  });

  it("keeps the canonical prefix in --json so consumers have one spelling", async () => {
    const { stdout } = await run("coverage", NESTED_ITERATION, "--json");
    const data = parseJson(stdout);
    assert.equal(data.mappings[0].mapping, "::dispatch manifest");
    assert.ok(
      data.mappings[0].schemas.every((s: any) => s.schema.startsWith("::")),
      "every schema key in --json should be canonical",
    );
  });

  it("leaves a real namespace intact in both forms", async () => {
    // The prefix is only dropped when it is empty; `crm::` is information.
    const human = await run("coverage", WORKSPACE, "--mapping", "load contacts");
    assert.match(human.stdout, /^mapping crm::load contacts/m);
    const json = await run("coverage", WORKSPACE, "--mapping", "load contacts", "--json");
    assert.equal(parseJson(json.stdout).mappings[0].mapping, "crm::load contacts");
  });
});

// ── Fragment spreads (sl-5nsv) ──────────────────────────────────────────────
//
// A spread is an authoring shorthand: `...address_fields` inside a record body
// declares that record's fields as surely as writing them out, so coverage must
// count them. These two fixtures are the cross-consumer parity cases — the LSP
// suite (satsuma-lsp/test/coverage.test.js) and the viz-backend suite read the
// same two files and must produce the same leaves, states and totals stated
// here. If you change a figure in one place, the other two are wrong.

describe("satsuma coverage — fragment spreads", () => {
  const NESTED_SPREAD = resolve(__dirname, "fixtures/nested-record-spread.stm");
  const LIST_OF_SPREAD = resolve(__dirname, "fixtures/list-of-record-spread.stm");

  it("counts the leaves a spread materialises inside a record body", async () => {
    // `address record { ...address_fields }` declares three leaves. Counting the
    // record as one opaque field instead reports the schema 1/3 covered where it
    // is 2/5 — and reports a mapped record where two of its leaves are gaps.
    const { stdout } = await run("coverage", NESTED_SPREAD, "--json");
    const target = schemaEntry(parseJson(stdout), "::customer_map", "target", "::customer");
    assert.deepEqual(
      target.fields.map((f: any) => [f.path, f.mapped]),
      [
        ["id", false],
        ["name", false],
        ["address.street", true],
        ["address.city", true],
        ["address.zip", false],
      ],
    );
    assert.equal(target.covered, 2);
    assert.equal(target.total, 5);
    assert.equal(target.pct, 40);
  });

  it("counts them the same way inside a list_of record body", async () => {
    // A list_of record is a container like any other, and a spread inside one
    // must materialise leaves the same way — the shape that existed nowhere in
    // the repo before this fixture. One of three line fields is mapped, so the
    // schema is 2/4 with `lines` partly covered.
    const { stdout } = await run("coverage", LIST_OF_SPREAD, "--json");
    const target = schemaEntry(parseJson(stdout), "::invoice_load", "target", "::invoice");
    assert.deepEqual(
      target.fields.map((f: any) => [f.path, f.mapped]),
      [
        ["invoice_no", true],
        ["lines.sku", true],
        ["lines.qty", false],
        ["lines.unit_price", false],
      ],
    );
    assert.equal(target.covered, 2);
    assert.equal(target.total, 4);
    assert.equal(target.pct, 50);
  });
});

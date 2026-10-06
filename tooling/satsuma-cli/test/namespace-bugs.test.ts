import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run as _run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const FIXTURE = resolve(__dirname, "fixtures/namespace-collision.stm");
// Fixture with namespace blocks used to verify output canonicalization bugs.
const OUTPUT_BUGS_FIXTURE = resolve(__dirname, "fixtures/namespace-output-bugs.stm");

const run = (...args: string[]) => _run(CLI, ...args);

describe("namespace collision regressions", () => {
  it("validate keeps namespace-local mappings isolated", async () => {
    const { stdout, code } = await run("validate", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /no issues found/i);
    assert.doesNotMatch(stdout, /field-not-in-schema/i);
  });

  it("schema renders the correct namespaced field body", async () => {
    const { stdout, code } = await run("schema", "beta::customer", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /beta_score/);
    assert.doesNotMatch(stdout, /alpha_flag/);
  });

  it("mapping renders the correct namespaced arrows", async () => {
    const { stdout, code } = await run("mapping", "beta::load_customer", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /beta_score\s+->\s+beta_score/);
    assert.match(stdout, /round\(0\)/);
    assert.doesNotMatch(stdout, /alpha_flag/);
  });

  it("metric renders the correct namespaced metadata and body", async () => {
    const { stdout, code } = await run("metric", "beta::customer_health", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /grain weekly/);
    assert.match(stdout, /measure non_additive/);
    assert.doesNotMatch(stdout, /grain daily/);
    assert.doesNotMatch(stdout, /measure additive/);
  });

  it("nl returns only the requested namespaced mapping notes", async () => {
    const { stdout, code } = await run("nl", "beta::load_customer", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.length, 1);
    assert.match(data[0].text, /Beta mapping/);
  });

  it("find reports namespaced field matches on the correct rows", async () => {
    const { stdout, code } = await run("find", "--tag", "default", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const alpha = data.find((m: any) => m.block === "alpha::customer" && m.field === "alpha_flag");
    const beta = data.find((m: any) => m.block === "beta::customer" && m.field === "beta_score");
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(alpha.line, 4);
    assert.equal(beta.line, 33);
  });

  it("lineage follows namespace-qualified downstream edges", async () => {
    const { stdout, code } = await run("lineage", "--from", "beta::customer", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const nodeNames = new Set(data.nodes.map((n: any) => n.name));
    assert.ok(nodeNames.has("beta::customer"));
    assert.ok(nodeNames.has("beta::load_customer"));
    assert.ok(nodeNames.has("beta::customer_out"));
  });

  it("graph exports namespace-qualified schema edges", async () => {
    const { stdout, code } = await run("graph", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(
      data.schema_edges.some(
        (e: any) =>
          e.from === "beta::customer" && e.to === "beta::load_customer" && e.role === "source",
      ),
    );
    assert.ok(
      data.schema_edges.some(
        (e: any) =>
          e.from === "beta::load_customer" && e.to === "beta::customer_out" && e.role === "target",
      ),
    );
    assert.ok(
      data.schema_edges.some(
        (e: any) =>
          e.from === "beta::customer_out" &&
          e.to === "beta::customer_health" &&
          e.role === "metric_source",
      ),
    );
  });
});

// ── Output canonicalization regressions ────────────────────────────────────────
// These tests guard the family of bugs where CLI commands echoed the user's
// raw query string instead of resolving to the namespace-qualified canonical name.

describe("namespace output canonicalization regressions", () => {
  it("sl-b0mq: where-used JSON 'name' field uses canonical name for bare-name queries", async () => {
    // Bare query "customers" should resolve to "crm::customers" in JSON output,
    // not produce a "::customers" (leading :: with no namespace) prefix.
    const { stdout, code } = await run("where-used", "customers", OUTPUT_BUGS_FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(
      data.name,
      "crm::customers",
      "JSON 'name' must be the qualified canonical key, not the bare query string",
    );
  });

  it("sl-ltv6: arrows text header shows correct count for bare-name field queries", async () => {
    // Querying with bare "customers.email" should produce the same arrow count
    // in the header as the fully-qualified "crm::customers.email".
    const { stdout: bareOut, code: bareCode } = await run(
      "arrows",
      "customers.email",
      OUTPUT_BUGS_FIXTURE,
    );
    assert.equal(bareCode, 0);
    const { stdout: qualOut, code: qualCode } = await run(
      "arrows",
      "crm::customers.email",
      OUTPUT_BUGS_FIXTURE,
    );
    assert.equal(qualCode, 0);
    // Both should show the same non-zero arrow count in the header line.
    // The header format is "<field> — N arrow(s) (...)".
    const extractCount = (out: string): string => out.split("\n")[0] ?? "";
    assert.doesNotMatch(
      extractCount(bareOut),
      /— 0 arrows/,
      "bare-name header must not report 0 arrows",
    );
    assert.match(extractCount(bareOut), /1 as source/, "bare-name header must report 1 as source");
    assert.equal(
      extractCount(bareOut).replace("customers.email", "crm::customers.email"),
      extractCount(qualOut),
      "bare-name and qualified arrow counts must match",
    );
  });

  it("sl-pb47: warnings JSON 'block' field carries namespace-qualified name", async () => {
    // A warning inside 'namespace crm { schema customers { //! ... } }' must
    // report "block": "crm::customers", not just "block": "customers".
    const { stdout, code } = await run("warnings", OUTPUT_BUGS_FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const item = data.items[0];
    assert.ok(item, "expected at least one warning item");
    assert.equal(item.block, "crm::customers", "JSON 'block' must include the namespace prefix");
  });

  it("sl-qofc: mapping text output shows namespace-qualified name in header", async () => {
    // The text-mode header must read "mapping 'crm::load dim_customer' {"
    // rather than "mapping 'load dim_customer' {".
    const { stdout, code } = await run("mapping", "crm::load dim_customer", OUTPUT_BUGS_FIXTURE);
    assert.equal(code, 0);
    assert.match(
      stdout,
      /mapping 'crm::load dim_customer'/,
      "mapping text header must include namespace prefix",
    );
  });

  it("sl-qxn5: arrows does not emit a duplicate nl-derived arrow when @ref is the arrow's own source", async () => {
    // email -> email { "Normalize @crm::customers.email" }
    // The @ref resolves to the same field as the explicit source, so only one
    // arrow should appear — no redundant nl-derived duplicate.
    const { stdout, code } = await run("arrows", "crm::customers.email", OUTPUT_BUGS_FIXTURE);
    assert.equal(code, 0);
    const arrowLines = stdout.split("\n").filter((l) => l.includes("->"));
    assert.equal(
      arrowLines.length,
      1,
      "only the explicit arrow should appear; no duplicate nl-derived arrow",
    );
  });

  it("sl-wfgx: nl JSON parent field uses canonical name for bare-name block queries", async () => {
    // Querying with bare "load dim_customer" must produce items with
    // "parent": "crm::load dim_customer", not "parent": "load dim_customer".
    const { stdout, code } = await run("nl", "load dim_customer", OUTPUT_BUGS_FIXTURE, "--json");
    assert.equal(code, 0);
    const items = JSON.parse(stdout);
    assert.ok(items.length > 0, "expected NL items for the mapping");
    for (const item of items) {
      if (item.parent) {
        assert.equal(
          item.parent,
          "crm::load dim_customer",
          "NL item parent must use the canonical qualified name",
        );
      }
    }
  });

  it("sl-wfgx: mapping text output uses canonical name when queried by bare name", async () => {
    // satsuma mapping 'load dim_customer' should show the qualified name in the header.
    const { stdout, code } = await run("mapping", "load dim_customer", OUTPUT_BUGS_FIXTURE);
    assert.equal(code, 0);
    assert.match(
      stdout,
      /mapping 'crm::load dim_customer'/,
      "text header must always show the namespace-qualified name",
    );
  });

  it("sl-wfgx: where-used text header uses canonical name for bare-name queries", async () => {
    // "References to 'crm::customers' (N):" not "References to 'customers' (N):".
    const { stdout, code } = await run("where-used", "customers", OUTPUT_BUGS_FIXTURE);
    assert.equal(code, 0);
    assert.match(
      stdout,
      /References to 'crm::customers'/,
      "text header must show the canonical qualified name",
    );
    assert.doesNotMatch(
      stdout,
      /References to 'customers' /,
      "text header must not echo the bare query string",
    );
  });
});

// A namespaced name that needs quoting is written ns::`name` (bsw-iuzs). The
// fixture uses that form in an import, a spread, a (ref) value and a mapping
// source, all naming declarations in defs.stm.
const BACKTICK_NAME_FIXTURE = resolve(__dirname, "fixtures/namespace-backtick-name/use.stm");

describe("ns::`name` references (bsw-iuzs)", () => {
  it("validate resolves every ns::`name` reference with no parse error or undefined-ref", async () => {
    // The ticket's repro: before the grammar accepted a backtick name after
    // ::, this reported a parse error and undefined-ref for `raw` and the name.
    const { stdout, code } = await run("validate", BACKTICK_NAME_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /no issues found/i);
  });

  it("where-used finds the import and the spread that name a fragment as ns::`name`", async () => {
    // where-used scans imports and spreads itself; both must compare the
    // unquoted name, or the quoted form is invisible to it.
    const { stdout, code } = await run(
      "where-used",
      "raw::audit fields",
      BACKTICK_NAME_FIXTURE,
      "--json",
    );
    assert.equal(code, 0);
    const kinds = JSON.parse(stdout)
      .refs.map((r: { kind: string }) => r.kind)
      .sort();
    assert.deepEqual(kinds, ["fragment_spread", "import"]);
  });

  it("where-used finds the (ref ns::`name`.field) metadata that names a schema", async () => {
    // where-used reads (ref) values itself; it must unquote the schema key the
    // same way validate does, or a ref validate accepts is invisible to it.
    const { stdout, code } = await run(
      "where-used",
      "raw::crm-contacts",
      BACKTICK_NAME_FIXTURE,
      "--json",
    );
    assert.equal(code, 0);
    const refMeta = JSON.parse(stdout).refs.filter(
      (r: { kind: string }) => r.kind === "ref_metadata",
    );
    assert.deepEqual(
      refMeta.map((r: { name: string }) => r.name),
      ["t.id"],
    );
  });

  it("arrows attributes the mapping's arrow to the ns::`name` source schema", async () => {
    // The source ref must key to raw::crm-contacts for its fields to have arrows.
    const { stdout, code } = await run("arrows", "raw::crm-contacts.id", BACKTICK_NAME_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /1 arrow/);
  });
});

// `flatten items -> fact { .sku -> sku }` inside `namespace n` records its child
// target as `fact.sku`: the target schema's bare name, while the index keys the
// schema as `n::fact`. Every arrows step that compared text against `n::fact.`
// missed it (bsw-tzc6).
const NS_FLATTEN_TARGET_FIXTURE = resolve(__dirname, "fixtures/namespace-flatten-target.stm");
const SEABIRD_MART = resolve(__dirname, "../../../examples/seabird-colony-lineage/mart.stm");

describe("arrows on a namespaced flatten-to-schema target (bsw-tzc6)", () => {
  it("finds the flatten child arrow when queried by the namespaced target field", async () => {
    // The ticket's repro: the arrow is stored as `fact.sku`, which no lookup
    // under `n::fact` recognised, so the command reported no arrows.
    const { stdout, code } = await run("arrows", "n::fact.sku", NS_FLATTEN_TARGET_FIXTURE);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /1 arrow \(1 as target\)/);
  });

  it("finds the seabird mart's species_code flatten child (the ticket's acceptance query)", async () => {
    // The canonical example of the shape: `flatten observations -> species_fact`
    // inside `namespace mart`.
    const { stdout, code } = await run("arrows", "mart::species_fact.species_code", SEABIRD_MART);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /species -> species_fact\.species_code/);
  });

  it("--as-target keeps the namespaced flatten child arrow", async () => {
    // The direction filter must apply the same schema-prefix rule as the lookup.
    const { code } = await run("arrows", "n::fact.sku", NS_FLATTEN_TARGET_FIXTURE, "--as-target");
    assert.equal(code, 0);
  });

  it("--json names the declared target field, not a doubled schema prefix", async () => {
    // Queried from either side, the target is `n::fact.sku`. Re-prefixing the
    // bare `fact.sku` with `n::fact` produced `n::fact.fact.sku`, which the
    // workspace does not declare.
    for (const query of ["n::fact.sku", "n::src.items.sku"]) {
      const { stdout, code } = await run("arrows", query, NS_FLATTEN_TARGET_FIXTURE, "--json");
      assert.equal(code, 0, `${query}: ${stdout}`);
      const [arrow] = JSON.parse(stdout);
      assert.equal(arrow.target, "n::fact.sku", query);
      assert.equal(arrow.source, "n::src.items.sku", query);
    }
  });
});

// Schema `n::fact` declares both `sku` and a record field `fact { sku }`, so on
// an arrow `fact.sku` is the nested field `fact.fact.sku`: a declared top-level
// field wins over a prefix that only looks like the schema's bare name
// (bsw-tzc6 review). The fix for the flatten case must not take that field for
// the schema prefix.
const NS_SCHEMA_NAMED_FIELD_FIXTURE = resolve(
  __dirname,
  "fixtures/namespace-schema-named-field.stm",
);

describe("arrows on a namespaced schema with a field of its own name (bsw-tzc6 review)", () => {
  it("--json spells an arrow to the nested field with the field's own prefix", async () => {
    // `a -> fact.sku` writes `n::fact.fact.sku`. Reading `fact.` as the schema
    // prefix gave `n::fact.sku`, which mislabels the nested field as the
    // top-level one — whichever side the arrow is queried from.
    for (const query of ["n::fact.fact.sku", "n::src.a"]) {
      const { stdout, code } = await run("arrows", query, NS_SCHEMA_NAMED_FIELD_FIXTURE, "--json");
      assert.equal(code, 0, `${query}: ${stdout}`);
      const arrows = JSON.parse(stdout);
      assert.deepEqual(
        arrows.map((a: { target: string }) => a.target),
        ["n::fact.fact.sku"],
        query,
      );
    }
  });

  it("--json keeps the top-level field's arrow on the top-level field", async () => {
    // The query for the top-level `sku` must report only `b -> sku`.
    const { stdout, code } = await run(
      "arrows",
      "n::fact.sku",
      NS_SCHEMA_NAMED_FIELD_FIXTURE,
      "--json",
    );
    assert.equal(code, 0, stdout);
    const arrows = JSON.parse(stdout);
    assert.deepEqual(
      arrows.map((a: { source: string; target: string }) => [a.source, a.target]),
      [["n::src.b", "n::fact.sku"]],
    );
  });

  it("field-lineage traces the nested field upstream to its source", async () => {
    // field-lineage resolves endpoints through the same rule; with `fact.`
    // stripped, the nested field had no connections at all.
    const { stdout, code } = await run(
      "field-lineage",
      "n::fact.fact.sku",
      NS_SCHEMA_NAMED_FIELD_FIXTURE,
      "--json",
    );
    assert.equal(code, 0, stdout);
    assert.match(stdout, /n::src\.a/);
  });
});

/**
 * field-lineage.test.js — Tests for `satsuma field-lineage` command.
 *
 * Covers:
 *   sl-nknd  --upstream --downstream together produces empty results
 *   sl-m44v  Anonymous mappings not traced
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run as _run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const FIXTURES = resolve(__dirname, "fixtures");

const run = (...args: string[]) => _run(CLI, ...args);

// ---------------------------------------------------------------------------
// sl-nknd: --upstream --downstream together should trace both directions
// ---------------------------------------------------------------------------
describe("field-lineage --upstream --downstream (sl-nknd)", () => {
  it("produces same result as no direction flags when both are set", async () => {
    // Use the chain fixture: source_a -> intermediate_b -> intermediate_c -> target_d
    // intermediate_b.id has both upstream (source_a.id) and downstream (intermediate_c.id)
    const chainFixture = resolve(FIXTURES, "lineage-chain.stm");
    const { stdout: bothOut, code: bothCode } = await run(
      "field-lineage", "intermediate_b.id", chainFixture, "--json", "--upstream", "--downstream",
    );
    assert.equal(bothCode, 0, `expected exit 0, got ${bothCode}\n${bothOut}`);
    const both = JSON.parse(bothOut);
    assert.ok(both.upstream.length > 0, "upstream should be non-empty when --upstream --downstream");
    assert.ok(both.downstream.length > 0, "downstream should be non-empty when --upstream --downstream");

    // Should match result with no direction flags
    const { stdout: allOut } = await run("field-lineage", "intermediate_b.id", chainFixture, "--json");
    const all = JSON.parse(allOut);
    assert.deepEqual(both.upstream, all.upstream, "upstream should match no-flag result");
    assert.deepEqual(both.downstream, all.downstream, "downstream should match no-flag result");
  });

  it("--upstream alone only returns upstream", async () => {
    const chainFixture = resolve(FIXTURES, "lineage-chain.stm");
    const { stdout, code } = await run("field-lineage", "intermediate_b.id", chainFixture, "--json", "--upstream");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.upstream.length > 0, "upstream should be non-empty");
    assert.equal(data.downstream.length, 0, "downstream should be empty with --upstream only");
  });

  it("--downstream alone only returns downstream", async () => {
    const chainFixture = resolve(FIXTURES, "lineage-chain.stm");
    const { stdout, code } = await run("field-lineage", "intermediate_b.id", chainFixture, "--json", "--downstream");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.upstream.length, 0, "upstream should be empty with --downstream only");
    assert.ok(data.downstream.length > 0, "downstream should be non-empty");
  });
});

// ---------------------------------------------------------------------------
// sl-m44v: anonymous mappings should be traced correctly
// ---------------------------------------------------------------------------
describe("field-lineage anonymous mappings (sl-m44v)", () => {
  it("traces upstream through an anonymous mapping", async () => {
    const fixture = resolve(FIXTURES, "anon-lineage.stm");
    const { stdout, code } = await run("field-lineage", "invoices.total", fixture, "--json");
    assert.equal(code, 0, `expected exit 0, got ${code}\n${stdout}`);
    const data = JSON.parse(stdout);
    assert.ok(data.upstream.length > 0, "upstream should contain orders.amount via anonymous mapping");
    const upstreamFields = data.upstream.map((u: any) => u.field);
    assert.ok(
      upstreamFields.some((f: any) => f.includes("orders") && f.includes("amount")),
      `expected ::orders.amount in upstream, got: ${JSON.stringify(upstreamFields)}`,
    );
  });

  it("traces downstream through an anonymous mapping", async () => {
    const fixture = resolve(FIXTURES, "anon-lineage.stm");
    const { stdout, code } = await run("field-lineage", "orders.amount", fixture, "--json");
    assert.equal(code, 0, `expected exit 0, got ${code}\n${stdout}`);
    const data = JSON.parse(stdout);
    assert.ok(data.downstream.length > 0, "downstream should contain invoices.total via anonymous mapping");
    const downstreamFields = data.downstream.map((d: any) => d.field);
    assert.ok(
      downstreamFields.some((f: any) => f.includes("invoices") && f.includes("total")),
      `expected ::invoices.total in downstream, got: ${JSON.stringify(downstreamFields)}`,
    );
  });

  it("via_mapping references the anonymous mapping key", async () => {
    const fixture = resolve(FIXTURES, "anon-lineage.stm");
    const { stdout, code } = await run("field-lineage", "invoices.total", fixture, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.upstream.length > 0);
    // The via_mapping should reference the anonymous mapping (contains <anon>)
    assert.ok(
      data.upstream.some((u: any) => u.via_mapping.includes("anon")),
      `expected via_mapping to reference anonymous mapping, got: ${JSON.stringify(data.upstream)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Typeless fields (NAME (metadata) without explicit type)
// ---------------------------------------------------------------------------
describe("field-lineage with typeless fields", () => {
  const fixture = resolve(FIXTURES, "typeless-field-lineage.stm");

  it("finds a typeless direct field before spreads in its schema", async () => {
    const { stdout, code, stderr } = await run("field-lineage", "source_schema.PK_ID", fixture, "--json");
    assert.equal(code, 0, `expected exit 0, got ${code}\n${stderr}`);
    const data = JSON.parse(stdout);
    assert.ok(
      data.downstream.some((d: any) => d.field.includes("out_id")),
      `expected out_id in downstream, got: ${JSON.stringify(data.downstream)}`,
    );
  });

  it("resolves the typeless field without 'field not found' error", async () => {
    const { code, stderr } = await run("field-lineage", "source_schema.PK_ID", fixture);
    assert.equal(code, 0, `should not error on typeless field\n${stderr}`);
    assert.ok(!stderr.includes("not found"), `got unexpected error: ${stderr}`);
  });

  it("spread fields are still accessible after typeless direct field", async () => {
    const { stdout, code } = await run("fields", "source_schema", fixture);
    assert.equal(code, 0);
    assert.ok(stdout.includes("PK_ID"), "typeless direct field should appear in fields output");
    assert.ok(stdout.includes("region"), "spread field should appear after typeless field");
    assert.ok(stdout.includes("branch"), "spread field should appear after typeless field");
  });
});

// ---------------------------------------------------------------------------
// sl-201z: same-line arrows sharing a target must not be collapsed
// ---------------------------------------------------------------------------
describe("field-lineage same-line arrows sharing a target (sl-201z)", () => {
  it("reports upstream connections from both arrows on one line", async () => {
    // Bug sl-201z: the field-edge graph deduplicated arrow records by
    // file:line:target, dropping the second of two same-line arrows that
    // target the same field — lineage showed 1 of 2 upstream connections.
    const fixture = resolve(FIXTURES, "same-line-arrows.stm");
    const { stdout, code } = await run("field-lineage", "t.x", fixture, "--json", "--upstream");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const upstreamFields = (data.upstream as any[]).map((e) => e.field).sort();
    assert.deepEqual(upstreamFields, ["::s.a", "::s.b"],
      "both same-line arrows should contribute an upstream connection");
  });
});

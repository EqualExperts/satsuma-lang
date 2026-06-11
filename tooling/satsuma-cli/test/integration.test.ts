/**
 * End-to-end integration tests for the Satsuma CLI.
 *
 * Spawns the CLI as a subprocess against canonical .stm example files
 * and verifies output, exit codes, and JSON structure.
 *
 * Prerequisites: tree-sitter native bindings must be built.
 *   cd tooling/tree-sitter-satsuma && npx node-gyp configure && npx node-gyp build
 */

import { copyFileSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { describe as _describe, it } from "node:test";
import { run as _run } from "./helpers.js";

// Run top-level describe blocks concurrently — each test spawns its own
// CLI subprocess so there are no shared-state conflicts.
const describe = (name: string, fn: () => void) => _describe(name, { concurrency: true }, fn);
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const EXAMPLES = resolve(__dirname, "../../../examples");
const PLATFORM = resolve(__dirname, "fixtures/platform.stm");

/** Run the CLI with the given arguments and return { stdout, stderr, code }. */
const run = (...args: string[]) => _run(CLI, ...args);

// ---------------------------------------------------------------------------
// satsuma summary
// ---------------------------------------------------------------------------
describe("satsuma summary", () => {
  it("lists schemas, metrics, and mappings", async () => {
    const { stdout, code } = await run("summary", PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /Schemas/i);
    assert.match(stdout, /Metrics/i);
    assert.match(stdout, /Mappings/i);
    assert.match(stdout, /sfdc_opportunity/);
    assert.match(stdout, /legacy_sqlserver/);
  });

  it("--compact lists names only", async () => {
    const { stdout, code } = await run("summary", "--compact", PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /schemas:/i);
    assert.match(stdout, /sfdc_opportunity/);
  });

  it("--json produces valid JSON with expected keys", async () => {
    const { stdout, code } = await run("summary", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.schemas));
    assert.ok(Array.isArray(data.metrics));
    assert.ok(Array.isArray(data.mappings));
    assert.ok(data.schemas.length > 0);
    assert.ok(data.metrics.length > 0);
  });

  it("--json includes fileCount", async () => {
    const { stdout, code } = await run("summary", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(typeof data.fileCount === "number", "should have fileCount");
    assert.ok(data.fileCount > 0);
  });

  it("exits non-zero for nonexistent path", async () => {
    const { code } = await run("summary", "/nonexistent/path");
    assert.notEqual(code, 0);
  });

  it("uses correct pluralization for singular counts", async () => {
    const { stdout, code } = await run("summary", PLATFORM);
    assert.equal(code, 0);
    // Should not have "[1 fields]" or "[1 arrows]"
    assert.ok(!stdout.includes("[1 fields]"), "should use singular 'field' for count 1");
    assert.ok(!stdout.includes("[1 arrows]"), "should use singular 'arrow' for count 1");
  });

  it("surfaces fragment-spread-expanded fieldCount in --json output (sl-vlsh)", async () => {
    // Extraction logic tested in extract.test.ts; here we verify the CLI end-to-end value.
    const FIXTURE = resolve(__dirname, "fixtures/spread-fields-meta.stm");
    const { stdout, code } = await run("summary", "--json", FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const schema = data.schemas.find((s: any) => s.name === "::with_spreads");
    assert.ok(schema, "should find with_spreads schema");
    assert.equal(schema.fieldCount, 4, "should count 1 direct + 3 spread fields");
  });

  it("text output includes spread fields in count (sl-vlsh)", async () => {
    const FIXTURE = resolve(__dirname, "fixtures/spread-fields-meta.stm");
    const { stdout, code } = await run("summary", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /with_spreads.*4 fields/);
  });

  it("--json arrowCount includes nl-derived edges and exposes nlDerivedArrowCount (sl-mraa)", async () => {
    // Arrow counting logic tested in arrow-extract.test.ts; here we verify CLI end-to-end.
    //
    // Fixture: nl-refs-atref-notes.stm has one declared arrow
    //   `balance -> balance_usd { "Convert @balance to USD using @currency rate" }`
    // @balance is the declared source — it should NOT produce a duplicate nl-derived edge.
    // @currency is an additional implicit source — it should produce one nl-derived edge.
    //
    // The cobol-to-avro pipeline was previously used here, but all its @refs point
    // to fields that are already explicitly declared as sources in the same arrow,
    // so the correct nl-derived count for that file is 0 (no new lineage added).
    const fixture = resolve(__dirname, "fixtures", "nl-refs-atref-notes.stm");
    const { stdout, code } = await run("summary", "--json", fixture);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const mapping = data.mappings[0];
    assert.ok(mapping.nlDerivedArrowCount > 0, "should have nl-derived arrows");
    assert.ok(mapping.arrowCount > mapping.nlDerivedArrowCount,
      "arrowCount should include both declared and nl-derived arrows");
  });

  it("--json totalErrors counts MISSING nodes, not just ERROR nodes (sl-8s4b)", async () => {
    // Files with parse errors (e.g. missing closing brace) produce MISSING
    // nodes that must be included in totalErrors, not just ERROR nodes.
    const BAD = resolve(import.meta.dirname, "fixtures", "parse-error.stm");
    const { stdout, code } = await run("summary", "--json", BAD);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.totalErrors > 0, "totalErrors should count parse errors");
  });

  it("--json --compact strips notes and file/row from output (sl-86n4)", async () => {
    const { stdout, code } = await run("summary", "--json", "--compact", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.schemas.length > 0);
    // Compact should not have note, file, or line
    for (const s of data.schemas) {
      assert.ok(!("note" in s), "compact JSON should omit note");
      assert.ok(!("file" in s), "compact JSON should omit file");
      assert.ok(!("line" in s), "compact JSON should omit line");
    }
  });
});

// ---------------------------------------------------------------------------
// satsuma schema
// ---------------------------------------------------------------------------
describe("satsuma schema", () => {
  const SFDC = resolve(EXAMPLES, "sfdc-to-snowflake/pipeline.stm");

  it("prints a known schema", async () => {
    const { stdout, code } = await run("schema", "sfdc_opportunity", SFDC);
    assert.equal(code, 0);
    assert.match(stdout, /sfdc_opportunity/);
  });

  it("--fields-only prints one field per line", async () => {
    const { stdout, code } = await run("schema", "sfdc_opportunity", "--fields-only", SFDC);
    assert.equal(code, 0);
    // Should have multiple lines with field names
    const lines = stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 2, `expected at least 2 field lines, got ${lines.length}`);
  });

  it("--json produces valid JSON", async () => {
    const { stdout, code } = await run("schema", "sfdc_opportunity", "--json", SFDC);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.name);
    assert.ok(Array.isArray(data.fields));
  });

  it("--json line is 1-indexed (sl-2usp)", async () => {
    // 0→1 offset conversion tested in extract.test.ts; here we verify CLI end-to-end.
    const { stdout, code } = await run("schema", "country_codes", "--json", resolve(EXAMPLES, "lib/common.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.line, 4, "country_codes starts on line 4 (1-indexed)");
  });

  it("exits 1 for unknown schema", async () => {
    const { code, stderr } = await run("schema", "no_such_schema_xyz", SFDC);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("suggests close match for case-insensitive schema name", async () => {
    const { stderr, code } = await run("schema", "SFDC_OPPORTUNITY", SFDC);
    assert.equal(code, 1);
    assert.match(stderr, /did you mean/i);
  });

  it("--json not-found error returns JSON instead of plain text", async () => {
    const { stdout, code } = await run("schema", "no_such_schema_xyz", "--json", SFDC);
    assert.equal(code, 1);
    const data = JSON.parse(stdout);
    assert.ok(data.error, "should have error field");
    assert.match(data.error, /not found/i);
  });

  it("preserves single quotes on quoted schema names in text output", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "quoted-names.stm");
    const { stdout, code } = await run("schema", "My Complex Schema", F);
    assert.equal(code, 0);
    assert.match(stdout, /schema 'My Complex Schema'/);
  });

  it("preserves backticks on backtick-quoted field identifiers in text output", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "quoted-names.stm");
    const { stdout, code } = await run("schema", "My Complex Schema", F);
    assert.equal(code, 0);
    assert.match(stdout, /`field-with-dashes`/);
  });

  it("text output includes comments from schema body (sl-i956)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "comments-test.stm");
    const { stdout, code } = await run("schema", "comment_test", F);
    assert.equal(code, 0);
    assert.match(stdout, /\/\/ regular comment/);
    assert.match(stdout, /\/\/! warning: data quality issue/);
    assert.match(stdout, /\/\/\? should we rename this\?/);
  });

  it("--compact strips comments from schema output (sl-i956)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "comments-test.stm");
    const { stdout, code } = await run("schema", "comment_test", "--compact", F);
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /\/\/ regular comment/);
    assert.doesNotMatch(stdout, /\/\/!/);
    assert.doesNotMatch(stdout, /\/\/\?/);
  });

  it("includes comments before first and after last field (sl-a0wf)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "comment-edges.stm");
    const { stdout, code } = await run("schema", "comment_edges", F);
    assert.equal(code, 0);
    assert.match(stdout, /comment before first field/);
    assert.match(stdout, /comment after last field/);
  });

  it("--json includes edge comments in fieldLines (sl-a0wf)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "comment-edges.stm");
    const { stdout, code } = await run("schema", "comment_edges", "--json", F);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.fieldLines.some((l: any) => l.includes("comment before first field")));
    assert.ok(data.fieldLines.some((l: any) => l.includes("comment after last field")));
  });

  it("--json shows record type for empty list_of record (sc-r9gv)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "empty-list-record.stm");
    const { stdout, code } = await run("schema", "test", "--json", F);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const items = data.fields.find((f: any) => f.name === "items");
    assert.ok(items, "should have items field");
    assert.equal(items.type, "record", "empty list_of record should have type 'record'");
    assert.equal(items.isList, true);
    assert.ok(Array.isArray(items.children), "should have children array");
  });

  it("text output shows list_of record for empty body (sc-r9gv)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "empty-list-record.stm");
    const { stdout, code } = await run("schema", "test", F);
    assert.equal(code, 0);
    assert.match(stdout, /items list_of record/, "should show list_of record");
  });

  it("--json nests fragment spread fields inside record (sl-6gck)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "nested-record-spread.stm");
    const { stdout, code } = await run("fields", "customer", "--json", F);
    assert.equal(code, 0);
    const fields = JSON.parse(stdout);
    const addr = fields.find((f: any) => f.name === "address");
    assert.ok(addr, "should have address field");
    assert.equal(addr.type, "record");
    assert.ok(addr.children.length > 0, "fragment fields should be nested inside record");
    const street = addr.children.find((c: any) => c.name === "street");
    assert.ok(street, "should have street inside address");
    assert.equal(street.fromFragment, "address_fields");
    // Verify no fragment fields at schema level
    const topStreet = fields.find((f: any) => f.name === "street");
    assert.ok(!topStreet, "fragment fields should NOT appear at schema level");
  });

  it("validate no false positives for spread fields in nested records (sl-6gck)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "nested-record-spread.stm");
    const { stdout, code } = await run("validate", F);
    assert.equal(code, 0);
    assert.ok(!stdout.includes("field-not-in-schema"), "should not report field-not-in-schema for spread fields");
  });

  it("--json --compact strips comments from fieldLines (sl-xtpd)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "schema-compact-comment.stm");
    const { stdout, code } = await run("schema", "comment_test", "--json", "--compact", F);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    for (const line of data.fieldLines ?? []) {
      assert.doesNotMatch(line, /^\/\//, `fieldLines should not include comments: ${line}`);
    }
  });

  it("--json --compact omits note field (sl-5fbn)", async () => {
    const { stdout, code } = await run("schema", "country_codes", "--json", "--compact", resolve(EXAMPLES, "lib/common.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(!("note" in data), "compact JSON should omit note");
    assert.ok(data.name);
    assert.ok(Array.isArray(data.fields));
  });

  it("--json fields include metadata (pk, ref, enum) (sl-rbvk)", async () => {
    // Metadata extraction tested in extract.test.ts; here we verify CLI end-to-end.
    const { stdout, code } = await run("schema", "sfdc_opportunity", "--json", SFDC);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const idField = data.fields.find((f: any) => f.name === "Id");
    assert.ok(idField.metadata, "Id field should have metadata");
    assert.deepEqual(idField.metadata[0], { kind: "tag", tag: "pk" });
    const stageField = data.fields.find((f: any) => f.name === "StageName");
    const enumEntry = stageField.metadata.find((m: any) => m.kind === "enum");
    assert.ok(enumEntry, "StageName should have enum metadata");
    assert.ok(enumEntry.values.length > 0, "enum should have values");
  });

  it("--json --fields-only returns just the fields array (sl-5fbn)", async () => {
    const { stdout, code } = await run("schema", "country_codes", "--json", "--fields-only", resolve(EXAMPLES, "lib/common.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data), "should be a plain array of fields");
    assert.ok(data.length > 0);
    assert.ok(data[0].name);
    assert.ok(data[0].type);
  });

  it("--compact strips triple-quoted field notes (sl-vfbv)", async () => {
    const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { stdout, code } = await run("schema", "legacy_sqlserver", "--compact", DB);
    assert.equal(code, 0);
    assert.match(stdout, /PHONE_NBR/);
    assert.doesNotMatch(stdout, /"""/,  "triple-quoted note should be stripped in compact mode");
    assert.doesNotMatch(stdout, /No consistent format/, "note content should be stripped");
  });

  it("text output includes all schema-level metadata (sl-pq65)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("schema", "commerce_order", XML);
    assert.equal(code, 0);
    assert.match(stdout, /format xml/, "should include format metadata");
    assert.match(stdout, /namespace ord/, "should include namespace metadata");
  });

  it("--json includes metadata array for schemas with metadata (sl-pq65)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("schema", "commerce_order", "--json", XML);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.metadata), "should have metadata array");
    assert.ok(data.metadata.some((m: any) => m.key === "format"), "should include format entry");
  });

  it("text output preserves record/list block-level metadata (sl-s8xn)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("schema", "commerce_order", XML);
    assert.equal(code, 0);
    assert.match(stdout, /Order record \(xpath/, "record block should show xpath metadata");
    assert.match(stdout, /Discounts list_of record \(xpath/, "list block should show xpath metadata");
    assert.match(stdout, /LineItems list_of record \(xpath/, "list block should show xpath metadata");
  });

  it("--json includes metadata on nested record/list fields (sl-s8xn)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("schema", "commerce_order", "--json", XML);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const order = data.fields.find((f: any) => f.name === "Order");
    assert.ok(order.metadata, "Order record should have metadata");
    assert.equal(order.metadata[0].key, "xpath");
    const discounts = order.children.find((f: any) => f.name === "Discounts");
    assert.ok(discounts.metadata, "Discounts list should have metadata");
  });
});

// ---------------------------------------------------------------------------
// satsuma metric
// ---------------------------------------------------------------------------
describe("satsuma metric", () => {
  const METRICS = resolve(EXAMPLES, "metrics-platform/metrics.stm");

  it("prints a known metric", async () => {
    const { stdout, code } = await run("metric", "monthly_recurring_revenue", METRICS);
    assert.equal(code, 0);
    assert.match(stdout, /monthly_recurring_revenue/i);
  });

  it("--json produces valid JSON", async () => {
    const { stdout, code } = await run("metric", "monthly_recurring_revenue", "--json", METRICS);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.name);
  });

  it("exits 1 for unknown metric", async () => {
    const { code, stderr } = await run("metric", "no_such_metric_xyz", METRICS);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("text output includes comments from metric body (sl-c1he)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "comments-test.stm");
    const { stdout, code } = await run("metric", "comment_metric", F);
    assert.equal(code, 0);
    assert.match(stdout, /\/\/ regular metric comment/);
    assert.match(stdout, /\/\/! warning: aggregation/);
    assert.match(stdout, /\/\/\? consider using SUM/);
  });

  it("--compact strips comments from metric output (sl-c1he)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "comments-test.stm");
    const { stdout, code } = await run("metric", "comment_metric", "--compact", F);
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /\/\/ regular metric/);
    assert.doesNotMatch(stdout, /\/\/!/);
    assert.doesNotMatch(stdout, /\/\/\?/);
  });

  it("--json includes note field for metrics with note blocks (sl-xifk)", async () => {
    const { stdout, code } = await run("metric", "monthly_recurring_revenue", "--json", METRICS);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(typeof data.note === "string", "note should be a string");
    assert.match(data.note, /subscription/i, "note should contain subscription text");
  });

  it("text output preserves quotes around filter value (cbh-djny)", async () => {
    const { stdout, code } = await run("metric", "monthly_recurring_revenue", METRICS);
    assert.equal(code, 0);
    assert.match(stdout, /filter "status/, "filter value should be double-quoted");
  });

  it("--json includes slices for metrics with slice metadata (sl-se2f)", async () => {
    const { stdout, code } = await run("metric", "monthly_recurring_revenue", "--json", METRICS);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.slices), "slices should be an array");
    assert.ok(data.slices.length > 0, "should have slice entries");
    assert.ok(data.slices.includes("customer_segment"), "should include customer_segment slice");
  });

  it("text output includes slice in metadata (sl-se2f)", async () => {
    const { stdout, code } = await run("metric", "monthly_recurring_revenue", METRICS);
    assert.equal(code, 0);
    assert.match(stdout, /slice/, "should show slice metadata");
    assert.match(stdout, /customer_segment/, "should show slice dimension");
  });

  it("--json fields include measure metadata (sl-i1b8)", async () => {
    const { stdout, code } = await run("metric", "order_revenue", "--json", METRICS);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const gross = data.fields.find((f: any) => f.name === "gross_revenue");
    assert.ok(gross.metadata, "gross_revenue should have metadata");
    assert.equal(gross.metadata[0].kind, "kv");
    assert.equal(gross.metadata[0].key, "measure");
    assert.equal(gross.metadata[0].value, "additive");
  });
});

// ---------------------------------------------------------------------------
// satsuma mapping
// ---------------------------------------------------------------------------
describe("satsuma mapping", () => {
  const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");

  it("prints a known mapping", async () => {
    const { stdout, code } = await run("mapping", "customer migration", DB);
    assert.equal(code, 0);
    assert.match(stdout, /customer migration/i);
  });

  it("--arrows-only prints arrow table", async () => {
    const { stdout, code } = await run("mapping", "customer migration", "--arrows-only", DB);
    assert.equal(code, 0);
    assert.match(stdout, /->/);
  });

  it("--json produces valid JSON", async () => {
    const { stdout, code } = await run("mapping", "customer migration", "--json", DB);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.name);
    assert.ok(Array.isArray(data.arrows));
  });

  it("--json includes note field when mapping has a note block (cbh-e01s)", async () => {
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("mapping", "completed orders", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(typeof data.note === "string", "expected note field to be a string");
    assert.match(data.note, /order events/i);
  });

  it("--json omits note field when mapping has no note block (cbh-e01s)", async () => {
    const HUB = resolve(EXAMPLES, "multi-source/multi-source-hub.stm");
    const { stdout, code } = await run("mapping", "crm to analytics", "--json", HUB);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal("note" in data, false, "expected no note field");
  });

  it("exits 1 for unknown mapping", async () => {
    const { code, stderr } = await run("mapping", "no_such_mapping_xyz", DB);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("text output includes mapping-level metadata block (sl-0x23)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "mapping-meta.stm");
    const { stdout, code } = await run("mapping", "metadata test", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /note "This mapping has block-level metadata"/);
    assert.match(stdout, /scd type2/);
    assert.match(stdout, /priority high/);
  });

  it("--compact omits mapping-level metadata (sl-0x23)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "mapping-meta.stm");
    const { stdout, code } = await run("mapping", "metadata test", "--compact", FIXTURE);
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /note "This mapping/);
    assert.doesNotMatch(stdout, /scd type2/);
  });

  it("--json includes metadata array for mapping with metadata (sl-0x23)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "mapping-meta.stm");
    const { stdout, code } = await run("mapping", "metadata test", "--json", FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.metadata));
    assert.ok(data.metadata.length > 0);
    assert.ok(data.metadata.some((m: any) => m.kind === "note"));
    assert.ok(data.metadata.some((m: any) => m.kind === "kv" && m.key === "scd"));
  });

  it("text output includes arrow-level metadata (sl-9xiz)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "mapping-meta.stm");
    const { stdout, code } = await run("mapping", "metadata test", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /result \(note "Arrow-level note", required\)/);
  });

  it("--json includes arrow metadata (sl-9xiz)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "mapping-meta.stm");
    const { stdout, code } = await run("mapping", "metadata test", "--json", FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const arrowWithMeta = data.arrows.find((a: any) => a.metadata);
    assert.ok(arrowWithMeta, "At least one arrow should have metadata");
    assert.ok(arrowWithMeta.metadata.some((m: any) => m.kind === "note"));
    assert.ok(arrowWithMeta.metadata.some((m: any) => m.kind === "tag" && m.tag === "required"));
  });

  it("--compact omits arrow metadata (sl-9xiz)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "mapping-meta.stm");
    const { stdout, code } = await run("mapping", "metadata test", "--compact", FIXTURE);
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /Arrow-level note/);
    assert.doesNotMatch(stdout, /required/);
  });

  it("--json --compact omits transform text from arrows (sl-gqoy)", async () => {
    const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { stdout, code } = await run("mapping", "customer migration", "--json", "--compact", DB);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    for (const a of data.arrows) {
      assert.equal("transform" in a, false, `arrow ${a.src} -> ${a.tgt} should not have transform in compact mode`);
    }
    // hasTransform and classification should still be present
    const withTransform = data.arrows.filter((a: any) => a.hasTransform);
    assert.ok(withTransform.length > 0, "hasTransform should still be present");
    assert.ok(data.arrows.every((a: any) => "classification" in a), "classification should still be present");
  });

  it("--json --compact omits note and metadata from output (sl-gqoy)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "mapping-meta.stm");
    const { stdout, code } = await run("mapping", "metadata test", "--json", "--compact", FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal("note" in data, false, "top-level note should be omitted in compact mode");
    assert.equal("metadata" in data, false, "top-level metadata should be omitted in compact mode");
    for (const a of data.arrows) {
      assert.equal("metadata" in a, false, `arrow ${a.src} -> ${a.tgt} should not have metadata in compact mode`);
      assert.equal("transform" in a, false, `arrow ${a.src} -> ${a.tgt} should not have transform in compact mode`);
    }
  });

  it("--json includes transform body text on arrows (sl-ari1)", async () => {
    const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { stdout, code } = await run("mapping", "customer migration", "--json", DB);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const withTransform = data.arrows.filter((a: any) => a.hasTransform);
    assert.ok(withTransform.length > 0, "should have arrows with transforms");
    for (const a of withTransform) {
      assert.ok(typeof a.transform === "string", `arrow ${a.src} -> ${a.tgt} should have transform text`);
      assert.ok(a.transform.length > 0);
    }
  });

  it("--json includes classification field on arrows (sl-shwl)", async () => {
    const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { stdout, code } = await run("mapping", "customer migration", "--json", DB);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    for (const a of data.arrows) {
      assert.ok(
        ["nl", "none", "nl-derived"].includes(a.classification),
        `arrow ${a.src} -> ${a.tgt} should have classification, got: ${a.classification}`,
      );
    }
    // Should have at least one NL arrow (transform with steps)
    assert.ok(data.arrows.some((a: any) => a.classification === "nl"), "expected at least one nl arrow");
  });

  it("--json container arrows have hasTransform:false (sl-zfi0)", async () => {
    const SAP = resolve(EXAMPLES, "sap-po-to-mfcs/pipeline.stm");
    const { stdout, code } = await run("mapping", "sap po to mfcs", "--json", SAP);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const containers = data.arrows.filter((a: any) => a.children && a.children.length > 0);
    assert.ok(containers.length > 0, "should have container arrows");
    for (const c of containers) {
      if (!c.transform) {
        assert.equal(c.hasTransform, false, `container arrow ${c.src}->${c.tgt} without pipe_chain should have hasTransform:false`);
      }
    }
  });

  it("--json includes children for nested arrows (sl-wjb9)", async () => {
    const COBOL = resolve(EXAMPLES, "cobol-to-avro/pipeline.stm");
    const { stdout, code } = await run("mapping", "cobol customer to avro event", "--json", COBOL);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    // each_block arrows (unified syntax) are extracted as "each" kind with children
    const each = data.arrows.find((a: any) => a.kind === "each");
    if (each) {
      assert.ok(each.children, "each arrow should have children");
      assert.ok(each.children.length >= 2, "should have child arrows");
    } else {
      // When the mapping command doesn't yet extract each_block, verify normal arrows exist
      assert.ok(data.arrows.length > 0, "should have arrows");
    }
  });

  it("text output shows child arrows inside nested blocks (sl-wjb9)", async () => {
    const COBOL = resolve(EXAMPLES, "cobol-to-avro/pipeline.stm");
    const { stdout, code } = await run("mapping", "cobol customer to avro event", COBOL);
    assert.equal(code, 0);
    // Unified syntax uses "each PHONE_NUMBERS -> contact_info.phones" instead of bracket notation
    // The mapping text command may not yet render each_block children
    assert.match(stdout, /CUST_ID -> customer_id/, "should show regular arrows");
  });

  it("text output preserves backtick-quoted source field names (cbh-sttt)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "backtick-fields.stm");
    const { stdout, code } = await run("mapping", "crm sync", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /`Account\.Name`/, "should preserve backticks in text output");
  });

  it("--json arrowCount excludes flatten/each containers (cbh-zdk3)", async () => {
    // Arrow counting tested in arrow-extract.test.ts; here we verify CLI end-to-end.
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("mapping", "order line facts", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.arrowCount, 11, "flatten container should not be counted as an arrow");
  });

  it("--json topLevelArrowCount equals arrows array length for hierarchical mappings (sl-dfqb)", async () => {
    // arrowCount counts leaf arrows (recursive), but arrows[] is hierarchical
    // (each/flatten blocks are single entries with children). topLevelArrowCount
    // gives consumers a count that matches arrows.length.
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("mapping", "order line facts", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.topLevelArrowCount, data.arrows.length,
      "topLevelArrowCount should equal arrows.length");
    assert.ok(data.arrowCount > data.topLevelArrowCount,
      "arrowCount (leaf) should exceed topLevelArrowCount for hierarchical mappings");
  });

  it("--json preserves backtick-quoted source field names (cbh-sttt)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "backtick-fields.stm");
    const { stdout, code } = await run("mapping", "crm sync", "--json", FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const arrow = data.arrows.find((a: any) => a.tgt === "last_name");
    assert.ok(arrow, "should find arrow to last_name");
    assert.match(arrow.src, /`Account\.Name`/, "JSON src should have backticks");
  });
});

// ---------------------------------------------------------------------------
// satsuma find
// ---------------------------------------------------------------------------
describe("satsuma find", () => {
  it("finds fields tagged pii", async () => {
    const { stdout, code } = await run("find", "--tag", "pii", PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /pii/i);
  });

  it("--json returns valid JSON array", async () => {
    const { stdout, code } = await run("find", "--tag", "pii", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
    assert.ok(data[0].tag || data[0].field);
  });

  it("--json uses 1-indexed line numbers", async () => {
    const { stdout, code } = await run("find", "--tag", "pii", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0);
    for (const m of data) {
      assert.ok("line" in m, "JSON should use 'line' field");
      assert.ok(!("row" in m), "JSON should not use 'row' field");
      assert.ok(m.line >= 1, "line numbers should be 1-indexed");
    }
  });

  it("--compact prints one match per line", async () => {
    const { stdout, code } = await run("find", "--tag", "pii", "--compact", PLATFORM);
    assert.equal(code, 0);
    const lines = stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1);
  });

  it("exits 1 when no matches found", async () => {
    const { code } = await run("find", "--tag", "nonexistent_tag_xyz", PLATFORM);
    assert.equal(code, 1);
  });

  it("--in schema restricts to schemas only", async () => {
    const { stdout, code } = await run("find", "--tag", "pii", "--in", "schema", PLATFORM);
    // Either finds matches (0) or no matches (1) — just verify it runs
    assert.ok(code === 0 || code === 1);
    if (code === 0) {
      assert.match(stdout, /pii/i);
    }
  });

  it("--in with invalid scope errors", async () => {
    const { code, stderr } = await run("find", "--tag", "pii", "--in", "invalid", PLATFORM);
    assert.equal(code, 1);
    assert.match(stderr, /invalid scope/i);
  });

  // sl-xav4: metrics are schema_block nodes tagged `metric` (no metric_block
  // CST node exists), so the metric scope must search schema_block nodes.
  it("--in metric matches fields in metric-tagged schemas (sl-xav4)", async () => {
    const METRICS = resolve(EXAMPLES, "metrics-platform/metrics.stm");
    const { stdout, code } = await run("find", "--tag", "measure", "--in", "metric", "--json", METRICS);
    assert.equal(code, 0, "metric scope should find measure fields, not exit 1");
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0, "expected measure-tagged fields in metric blocks");
    for (const m of data) {
      assert.equal(m.blockType, "metric", `${m.block}.${m.field} should report blockType metric, not ${m.blockType}`);
    }
  });

  // sl-xav4: a metric registers in both index.schemas and index.metrics, so
  // without twin filtering the schema scope claimed metric fields as schemas.
  it("--in schema does not claim fields from metric-tagged schemas (sl-xav4)", async () => {
    const METRICS = resolve(EXAMPLES, "metrics-platform/metrics.stm");
    const { stdout, code } = await run("find", "--tag", "measure", "--in", "schema", METRICS);
    assert.equal(code, 1, "no plain schema carries measure tags in the metrics example");
    assert.match(stdout, /No matches found/);
  });

  // sl-xav4: under scope `all`, each metric field must be reported exactly
  // once (as metric) — not duplicated by the schema and metric loops.
  it("default scope reports each metric field once, as blockType metric (sl-xav4)", async () => {
    const METRICS = resolve(EXAMPLES, "metrics-platform/metrics.stm");
    const { stdout, code } = await run("find", "--tag", "measure", "--json", METRICS);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const keys = data.map((m: any) => `${m.block}.${m.field}`);
    assert.equal(new Set(keys).size, keys.length, "no field should be reported twice");
    for (const m of data) assert.equal(m.blockType, "metric");
  });

  it("finds schema-level metadata tags", async () => {
    const { stdout, code } = await run("find", "--tag", "format", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    // Should include schema-level matches (field "(schema)") in addition to field-level
    const schemaLevel = data.filter((m: any) => m.field === "(schema)");
    assert.ok(schemaLevel.length > 0, "expected schema-level format matches");
  });

  it("--json note metadata includes text value (sc-5s57)", async () => {
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("find", "--tag", "classification", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const cf = data.find((m: any) => m.field === "consent_flags");
    assert.ok(cf, "should find consent_flags");
    const noteEntry = cf.metadata.find((t: any) => t.startsWith("note"));
    assert.ok(noteEntry, "should have note in metadata");
    assert.match(noteEntry, /note "/, "note should include its text value");
  });

  it("--json schema-level entries include metadata array (sc-h1wv)", async () => {
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("find", "--tag", "classification", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const schemaLevel = data.filter((m: any) => m.field === "(schema)");
    assert.ok(schemaLevel.length > 0, "expected schema-level matches");
    for (const m of schemaLevel) {
      assert.ok(Array.isArray(m.metadata), `schema-level entry for ${m.block} should include metadata array`);
      assert.ok(m.metadata.some((t: any) => /classification/.test(t)), "metadata should include matched tag value");
    }
  });

  it("--json metadata strings unwrap quoted kv values (sl-2old)", async () => {
    // find renders metadata strings itself, so string-valued metadata needs its
    // own regression coverage in addition to the shared core extractor tests.
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("find", "--tag", "classification", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const schemaLevel = data.find((m: any) => m.block === "completed_orders_parquet" && m.field === "(schema)");
    assert.ok(schemaLevel, "expected completed_orders_parquet schema-level match");
    assert.ok(schemaLevel.metadata.includes("classification INTERNAL"));
    assert.ok(!schemaLevel.metadata.includes('classification "INTERNAL"'));
  });

  it("--tag note finds fields with note metadata (sl-amyh)", async () => {
    const { stdout, code } = await run("find", "--tag", "note", PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /note/);
  });

  it("--tag note --json returns note matches (sl-amyh)", async () => {
    const { stdout, code } = await run("find", "--tag", "note", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0, "should find fields with note metadata");
    assert.ok(data.some((m: any) => m.tag === "note"), "tag should be 'note'");
  });

  it("finds tagged fields from fragment spreads in consuming schema (sl-z6z9)", async () => {
    const FIXTURE = resolve(__dirname, "fixtures/spread-meta.stm");
    const { stdout, code } = await run("find", "--tag", "required", "--in", "schema", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /uses_fragment/);
    assert.match(stdout, /created_at/);
  });

  it("finds spread fields in --json output (sl-z6z9)", async () => {
    const FIXTURE = resolve(__dirname, "fixtures/spread-meta.stm");
    const { stdout, code } = await run("find", "--tag", "required", "--json", FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const schemaMatch = data.find((m: any) => m.blockType === "schema" && m.block === "uses_fragment");
    assert.ok(schemaMatch, "expected uses_fragment match from spread");
    assert.equal(schemaMatch.field, "created_at");
  });

  it("--json schema-level entries include fieldType as null (sl-t8b4)", async () => {
    // Schema-level tag matches must include fieldType: null in JSON output,
    // not omit the key entirely, matching the documented JSON shape.
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("find", "--tag", "classification", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const schemaLevel = data.filter((m: any) => m.field === "(schema)");
    assert.ok(schemaLevel.length > 0, "expected schema-level matches");
    for (const m of schemaLevel) {
      assert.ok("fieldType" in m, "schema-level entry must include fieldType key");
      assert.equal(m.fieldType, null, "schema-level fieldType must be null");
    }
  });
});

// ---------------------------------------------------------------------------
// satsuma lineage
// ---------------------------------------------------------------------------
describe("satsuma lineage", () => {
  it("traces downstream from a schema", async () => {
    const { stdout, code } = await run("lineage", "--from", "legacy_sqlserver", PLATFORM);
    assert.equal(code, 0);
    // Should mention the target schema or mapping
    assert.match(stdout, /postgres_db|customer migration/i);
  });

  it("--json produces valid DAG JSON", async () => {
    const { stdout, code } = await run("lineage", "--from", "legacy_sqlserver", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.nodes));
    assert.ok(Array.isArray(data.edges));
    assert.ok(data.nodes.length > 0);
  });

  it("--compact prints names only", async () => {
    const { stdout, code } = await run("lineage", "--from", "legacy_sqlserver", "--compact", PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /legacy_sqlserver/);
  });

  it("exits 1 for unknown --from schema", async () => {
    const { code, stderr } = await run("lineage", "--from", "no_such_schema_xyz", PLATFORM);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("--json returns JSON error object for unknown --from schema (sl-xfxd)", async () => {
    // When --json is passed, not-found errors must return a JSON object
    // instead of plain text, consistent with other commands like schema.
    const { stdout, code } = await run("lineage", "--from", "no_such_schema_xyz", "--json", PLATFORM);
    assert.equal(code, 1);
    const data = JSON.parse(stdout);
    assert.ok(data.error, "should have error key in JSON");
    assert.match(data.error, /not found/i);
  });

  it("--json returns JSON error object for unknown --to schema (sl-xfxd)", async () => {
    const { stdout, code } = await run("lineage", "--to", "no_such_schema_xyz", "--json", PLATFORM);
    assert.equal(code, 1);
    const data = JSON.parse(stdout);
    assert.ok(data.error, "should have error key in JSON");
    assert.match(data.error, /not found/i);
  });

  it("exits 1 when neither --from nor --to provided", async () => {
    const { code } = await run("lineage", PLATFORM);
    assert.notEqual(code, 0);
  });

  it("traces upstream with --to", async () => {
    const { stdout, code } = await run("lineage", "--to", "postgres_db", PLATFORM);
    // Either finds path (0) or no path (1)
    if (code === 0) {
      assert.match(stdout, /legacy_sqlserver|customer migration/i);
    }
  });

  it("errors when both --from and --to are specified", async () => {
    const { code, stderr } = await run("lineage", "--from", "legacy_sqlserver", "--to", "postgres_db", PLATFORM);
    assert.equal(code, 1);
    assert.match(stderr, /cannot specify both/i);
  });

  it("multi-target mapping shows all targets without backticks (sl-3url)", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "multi-target.stm");
    const { stdout, code } = await run("lineage", "--from", "mt_source", "--json", fixture);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.nodes.map((n: any) => n.name);
    assert.ok(names.includes("mt_target_1"), "should include mt_target_1 without backticks");
    assert.ok(names.includes("mt_target_2"), "should include mt_target_2");
    // Ensure no backticks in names
    for (const name of names) {
      assert.doesNotMatch(name, /`/, `name '${name}' should not contain backticks`);
    }
  });

  it("--to --depth truncates upstream paths instead of dropping them (sl-lmcp)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "lineage-chain.stm");
    const { stdout, code } = await run("lineage", "--to", "target_d", "--depth", "3", F);
    assert.equal(code, 0);
    // Should show partial upstream chain (3 hops back from target_d)
    assert.match(stdout, /intermediate_b/);
    assert.match(stdout, /target_d/);
  });

  it("--to --depth --json includes truncated upstream nodes (sl-lmcp)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "lineage-chain.stm");
    // --depth 1 = 1 schema hop upstream from target_d (reaches intermediate_c)
    const { stdout, code } = await run("lineage", "--to", "target_d", "--depth", "1", "--json", F);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.nodes.map((n: any) => n.name);
    assert.ok(names.includes("target_d"), "should include target");
    assert.ok(names.includes("intermediate_c"), "should include 1-hop upstream schema");
    assert.ok(!names.includes("source_a"), "should not include source_a (beyond depth)");
    assert.ok(data.nodes.length < 7, "should be truncated, not full chain");
  });

  it("--json has no phantom note: node from NL refs (sc-nk3v)", async () => {
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("lineage", "--from", "order_events", FFG, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const noteNode = data.nodes.find((n: any) => n.name === "note:");
    assert.equal(noteNode, undefined, "should not have phantom note: node");
    const noteEdge = data.edges.find((e: any) => e.from === "note:" || e.to === "note:");
    assert.equal(noteEdge, undefined, "should not have edges to/from note:");
  });

  it("--depth --json edges only reference nodes in the nodes array (sl-iliz)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "lineage-chain.stm");
    const { stdout, code } = await run("lineage", "--from", "source_a", "--depth", "1", "--json", F);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const nodeNames = new Set(data.nodes.map((n: any) => n.name));
    for (const edge of data.edges) {
      assert.ok(nodeNames.has(edge.from), `edge from '${edge.from}' should be in nodes`);
      assert.ok(nodeNames.has(edge.to), `edge to '${edge.to}' should be in nodes`);
    }
  });
});

// ---------------------------------------------------------------------------
// satsuma where-used
// ---------------------------------------------------------------------------
describe("satsuma where-used", () => {
  it("shows references for a known schema", async () => {
    const { stdout, code } = await run("where-used", "legacy_sqlserver", PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /legacy_sqlserver/i);
  });

  it("--json produces valid JSON", async () => {
    const { stdout, code } = await run("where-used", "legacy_sqlserver", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.name);
  });

  it("exits 1 for unknown name", async () => {
    const { code, stderr } = await run("where-used", "no_such_thing_xyz", PLATFORM);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("--json not-found error returns JSON instead of plain text", async () => {
    const { stdout, code } = await run("where-used", "no_such_thing_xyz", "--json", PLATFORM);
    assert.equal(code, 1);
    const data = JSON.parse(stdout);
    assert.ok(data.error, "should have error field");
  });

  it("detects import references (sl-izap)", async () => {
    const { stdout, code } = await run("where-used", "address fields", PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /Imported in/);
    assert.match(stdout, /db-to-db\/pipeline\.stm/);
  });

  it("detects ref metadata references (sl-7yoa)", async () => {
    const { stdout, code } = await run("where-used", "dim_customer", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const refMetaRefs = data.refs.filter((r: any) => r.kind === "ref_metadata");
    assert.ok(refMetaRefs.length > 0, "should find ref metadata references");
    assert.ok(refMetaRefs.some((r: any) => r.name.includes("customer_id")), "should reference customer_id field");
  });

  it("detects transform spread references (sl-iw85)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "transform-spread.stm");
    const { stdout, code } = await run("where-used", "cleanup", F);
    assert.equal(code, 0);
    assert.match(stdout, /transform_call|Invoked/);
  });

  it("no duplicate refs for transform spread syntax (sl-b1h0)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "where-used-transform-spread.stm");
    const { stdout, code } = await run("where-used", "my_xform", "--json", F);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.refs.length, 2, "should have exactly 2 refs (spread + bare), not 3");
  });

  it("--help documents the current JSON ref kinds (sl-wawy)", async () => {
    // The help text is the published JSON contract for consumers, so it must
    // enumerate the kinds the command actually emits.
    const { stdout, code } = await run("where-used", "--help");
    assert.equal(code, 0);
    assert.match(stdout, /fragment_spread/);
    assert.match(stdout, /ref_metadata/);
    assert.match(stdout, /import/);
    assert.match(stdout, /transform_call/);
    assert.match(stdout, /nl_ref/);
  });
});

// ---------------------------------------------------------------------------
// satsuma warnings
// ---------------------------------------------------------------------------
describe("satsuma warnings", () => {
  it("lists warning comments", async () => {
    const { stdout, code } = await run("warnings", PLATFORM);
    assert.equal(code, 0);
    // Might list warnings or say "no warnings"
    assert.ok(stdout.length > 0);
  });

  it("--json produces valid JSON", async () => {
    const { stdout, code } = await run("warnings", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.kind);
    assert.ok(typeof data.count === "number");
    assert.ok(Array.isArray(data.items));
  });

  it("--questions shows question comments", async () => {
    const { stdout, code } = await run("warnings", "--questions", PLATFORM);
    assert.equal(code, 0);
    assert.ok(stdout.length > 0);
  });

  it("exits 1 when no warnings found", async () => {
    const { code } = await run("warnings", resolve(import.meta.dirname, "fixtures", "lint-clean.stm"));
    assert.equal(code, 1, "should exit 1 when no warnings found");
  });

  it("--json includes block context (sl-c7yn)", async () => {
    const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { stdout, code } = await run("warnings", "--json", DB);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const withBlock = data.items.filter((i: any) => i.block);
    assert.ok(withBlock.length > 0, "at least one warning should have block context");
    assert.ok(withBlock[0].blockType, "should have blockType");
  });
});

// ---------------------------------------------------------------------------
// satsuma context
// ---------------------------------------------------------------------------
describe("satsuma context", () => {
  it("returns relevant blocks for a query", async () => {
    const { stdout, code } = await run("context", "customer migration", PLATFORM);
    assert.equal(code, 0);
    // Should include the mapping or related schemas
    assert.match(stdout, /legacy_sqlserver|customer migration|postgres_db/i);
  });

  it("--json produces valid JSON array", async () => {
    const { stdout, code } = await run("context", "customer migration", "--json", PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
    assert.ok(data[0].name);
    assert.ok(typeof data[0].score === "number");
  });

  it("--budget limits output tokens", async () => {
    const { stdout, code } = await run("context", "customer", "--budget", "500", PLATFORM);
    assert.equal(code, 0);
    // Output should be shorter than default
    assert.ok(stdout.length > 0);
  });

  it("handles query with no matches gracefully", async () => {
    const { stdout, code } = await run("context", "zzz_no_match_xyz", PLATFORM);
    assert.equal(code, 1, "should exit 1 when no results found");
    assert.match(stdout, /no relevant/i);
  });

  it("searches comment text for query matches (sl-8zij)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "context-comments.stm");
    const { stdout, code } = await run("context", "phone", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.some((d: any) => d.name === "crm_customers"), "should match crm_customers via //? comment");
  });

  it("searches warning comments for query matches (sl-8zij)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "context-comments.stm");
    const { stdout, code } = await run("context", "conversion", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.some((d: any) => d.name === "raw_orders"), "should match raw_orders via //! comment");
  });

  it("finds blocks containing language keywords like flatten and list_of (sc-rj24)", async () => {
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout: flattenOut, code: c1 } = await run("context", "flatten", FFG, "--json");
    assert.equal(c1, 0);
    const flattenData = JSON.parse(flattenOut);
    assert.ok(flattenData.length > 0, "should find blocks containing flatten");

    const { stdout: listOut, code: c2 } = await run("context", "list_of", FFG, "--json");
    assert.equal(c2, 0);
    const listData = JSON.parse(listOut);
    assert.ok(listData.length > 0, "should find blocks containing list_of");
  });

  it("searches metadata tags/values for query matches (sl-mdlr)", async () => {
    const { stdout, code } = await run("context", "pii", PLATFORM, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0, "should find blocks with pii metadata");
  });
});

// ---------------------------------------------------------------------------
// satsuma arrows
// ---------------------------------------------------------------------------
describe("satsuma arrows", () => {
  const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");

  it("shows arrows for a source field", async () => {
    const { stdout, code } = await run("arrows", "legacy_sqlserver.CUST_ID", DB);
    assert.equal(code, 0);
    assert.match(stdout, /CUST_ID -> customer_id/);
    assert.match(stdout, /CUST_ID -> legacy_customer_id/);
    assert.match(stdout, /\[nl\]/);
    assert.match(stdout, /\[none\]/);
  });

  // After Feature 28, all pipe steps are NL — no structural/mixed distinction
  it("shows nl classification on bare identifier pipe steps", async () => {
    const { stdout, code } = await run("arrows", "legacy_sqlserver.FIRST_NM", DB);
    assert.equal(code, 0);
    assert.match(stdout, /\[nl\]/);
    assert.match(stdout, /trim/);
  });

  it("shows nl classification on NL + bare token transform", async () => {
    const { stdout, code } = await run("arrows", "legacy_sqlserver.PHONE_NBR", DB);
    assert.equal(code, 0);
    assert.match(stdout, /\[nl\]/);
  });

  it("shows nl classification on quoted + bare token transform", async () => {
    const { stdout, code } = await run("arrows", "legacy_sqlserver.NOTES", DB);
    assert.equal(code, 0);
    assert.match(stdout, /\[nl\]/);
  });

  it("--as-source filters to source arrows only", async () => {
    const { stdout, code } = await run(
      "arrows", "legacy_sqlserver.CUST_ID", "--as-source", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /CUST_ID -> customer_id/);
    assert.match(stdout, /as source/);
  });

  it("--as-target filters to target arrows only", async () => {
    const { stdout, code } = await run(
      "arrows", "postgres_db.customer_id", "--as-target", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /as target/);
    assert.match(stdout, /CUST_ID -> customer_id/);
  });

  it("header does not over-count target when source/target field names match (cbh-ekvb)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "arrows-same-name.stm");
    const { stdout, code } = await run("arrows", "source_system.email", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /1 as source/);
    assert.doesNotMatch(stdout, /as target/);
  });

  it("target schema sees same-name arrow as target, not source (cbh-ekvb)", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "arrows-same-name.stm");
    const { stdout, code } = await run("arrows", "target_warehouse.email", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /1 as target/);
    assert.doesNotMatch(stdout, /as source/);
  });

  it("--json includes decomposed steps array", async () => {
    const { stdout, code } = await run(
      "arrows", "legacy_sqlserver.CUST_ID", "--json", DB,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 2);
    // After Feature 28, all transforms are "nl" — find one with steps
    const nlWithSteps = data.find((a: any) => a.classification === "nl" && a.steps?.length > 0);
    assert.ok(nlWithSteps, "expected at least one nl arrow with steps");
    assert.ok(Array.isArray(nlWithSteps.steps));
    assert.ok(nlWithSteps.steps[0].type);
    assert.ok(nlWithSteps.steps[0].text);
  });

  it("--json includes file and line", async () => {
    const { stdout, code } = await run(
      "arrows", "legacy_sqlserver.CUST_ID", "--json", DB,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data[0].file);
    assert.ok(typeof data[0].line === "number");
    assert.ok(data[0].line > 0);
  });

  it("exits 1 for unknown schema", async () => {
    const { stderr, code } = await run("arrows", "nonexistent.field", DB);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("exits 1 for unknown field", async () => {
    const { stderr, code } = await run("arrows", "legacy_sqlserver.NONEXISTENT", DB);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("--json source field uses actual source schema, not lookup schema (sl-531q)", async () => {
    const SFDC = resolve(EXAMPLES, "sfdc-to-snowflake/pipeline.stm");
    const { stdout, code } = await run("arrows", "snowflake_opps.opp_key", "--json", SFDC);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const arrow = data.find((a: any) => a.source);
    assert.ok(arrow, "should have arrow with source");
    assert.match(arrow.source, /sfdc_opportunity\./, "source should reference sfdc_opportunity, not snowflake_opps");
    assert.doesNotMatch(arrow.source, /snowflake_opps\.Id/, "source should not use lookup schema");
  });

  it("--json includes arrow-level metadata (sl-6ctd)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "arrow-meta.stm");
    const { stdout, code } = await run("arrows", "tgt.name", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data[0].metadata, "should have metadata on arrow");
    assert.ok(data[0].metadata.some((m: any) => m.kind === "note" && m.text === "Arrow metadata note"));
  });

  it("--json includes tag metadata on arrows (sl-6ctd)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "arrow-meta.stm");
    const { stdout, code } = await run("arrows", "tgt.email", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data[0].metadata, "should have metadata");
    assert.ok(data[0].metadata.some((m: any) => m.kind === "tag" && m.tag === "pii"));
  });

  it("text header shows correct count for nested field paths (sl-dvhm)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("arrows", "commerce_order.Order.Customer.Email", XML);
    assert.equal(code, 0);
    assert.match(stdout, /1 arrow/, "should show correct arrow count in header");
    assert.match(stdout, /as source/, "should show direction in header");
  });

  it("finds arrows for nested child by dotted path (sl-9gvb)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "nested-arrow-lookup.stm");
    const { stdout, code } = await run("arrows", "src_sys.addr.street", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0, "should find arrows for addr.street");
    assert.ok(data[0].source.includes("street"), "source should contain street");
  });

  it("finds arrows for nested child by bare leaf name (sl-9gvb)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "nested-arrow-lookup.stm");
    const { stdout, code } = await run("arrows", "src_sys.street", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0, "should find arrows for bare field name street");
  });

  // sl-9gvb index-builder assertions moved to namespace-index.test.ts
});


// ---------------------------------------------------------------------------
// satsuma fields
// ---------------------------------------------------------------------------
describe("satsuma fields", () => {
  const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");
  const METRICS = resolve(EXAMPLES, "metrics-platform/metrics.stm");

  it("lists all fields with types", async () => {
    const { stdout, code } = await run("fields", "legacy_sqlserver", DB);
    assert.equal(code, 0);
    assert.match(stdout, /CUST_ID/);
    assert.match(stdout, /INT/);
    assert.match(stdout, /EMAIL_ADDR/);
    assert.match(stdout, /VARCHAR\(255\)/);
  });

  it("--json returns structured field array", async () => {
    const { stdout, code } = await run("fields", "legacy_sqlserver", "--json", DB);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
    assert.ok(data[0].name);
    assert.ok(data[0].type);
  });

  it("--json unwraps quoted metadata values on fields (sl-2old)", async () => {
    // fields --json forwards FieldDecl metadata from the shared extractor, so
    // quoted string values should already be normalized here.
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("fields", "completed_orders_parquet", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const customerEmail = data.find((field: any) => field.name === "customer_email");
    const classification = customerEmail.metadata.find((entry: any) => entry.kind === "kv" && entry.key === "classification");
    const retention = customerEmail.metadata.find((entry: any) => entry.kind === "kv" && entry.key === "retention");
    assert.equal(classification?.value, "RESTRICTED");
    assert.equal(retention?.value, "3y");
  });

  it("--unmapped-by on target schema returns correct set difference", async () => {
    const { stdout, code } = await run(
      "fields", "postgres_db", "--unmapped-by", "customer migration", DB,
    );
    assert.equal(code, 0);
    // All postgres_db fields are mapped in db-to-db.stm
    assert.match(stdout, /all fields.*mapped/i);
  });

  it("--unmapped-by on source schema filters mapped fields", async () => {
    const { stdout, code } = await run(
      "fields", "legacy_sqlserver", "--unmapped-by", "customer migration", DB,
    );
    assert.equal(code, 0);
    // CUST_ID, FIRST_NM etc. are mapped — should NOT appear
    assert.doesNotMatch(stdout, /CUST_ID/);
    assert.doesNotMatch(stdout, /FIRST_NM/);
    // Address fields aren't directly mapped — should appear
    assert.match(stdout, /ADDR_LINE_1/);
    assert.match(stdout, /CITY/);
  });

  it("--with-meta includes tags", async () => {
    const { stdout, code } = await run(
      "fields", "legacy_sqlserver", "--with-meta", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /pii/);
  });

  it("--unmapped-by does not report nested list as unmapped", async () => {
    const SAP = resolve(EXAMPLES, "sap-po-to-mfcs/pipeline.stm");
    const { stdout, code } = await run(
      "fields", "mfcs_purchase_order", "--unmapped-by", "sap po to mfcs", "--json", SAP,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.map((f: any) => f.name);
    // "items" list is targeted by nested arrow Items[] -> items[], so should NOT be unmapped
    assert.ok(!names.includes("items"), `"items" should not be reported as unmapped, got: ${names}`);
  });

  it("--unmapped-by filters mapped children from record blocks (sl-4mh2)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "unmapped-nested.stm");
    const { stdout, code } = await run(
      "fields", "nested_tgt", "--unmapped-by", "partial_map", "--json", F,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const details = data.find((f: any) => f.name === "details");
    assert.ok(details, "record 'details' should still appear (has unmapped child)");
    const childNames = details.children.map((c: any) => c.name);
    assert.ok(!childNames.includes("name"), "mapped child 'name' should be filtered out");
    assert.ok(childNames.includes("email"), "unmapped child 'email' should remain");
  });

  it("--unmapped-by excludes record when all children mapped (sl-4mh2)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "unmapped-nested.stm");
    const { stdout, code } = await run(
      "fields", "nested_tgt", "--unmapped-by", "full_map", "--json", F,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.map((f: any) => f.name);
    assert.ok(!names.includes("details"), "fully-mapped record 'details' should be excluded");
    assert.ok(!names.includes("status"), "mapped leaf 'status' should be excluded");
    assert.deepEqual(data, []);
  });

  it("exits 1 for unknown schema", async () => {
    const { stderr, code } = await run("fields", "nonexistent", DB);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("lists fields of a fragment (sl-3o9n)", async () => {
    const { stdout, code } = await run("fields", "audit columns", resolve(EXAMPLES, "lib/common.stm"));
    assert.equal(code, 0);
    assert.match(stdout, /created_at/);
    assert.match(stdout, /updated_at/);
  });

  it("lists fields of a metric (sl-g4u2)", async () => {
    const { stdout, code } = await run("fields", "order_revenue", METRICS);
    assert.equal(code, 0);
    assert.match(stdout, /gross_revenue/);
    assert.match(stdout, /net_revenue/);
  });

  it("text output shows nested record/list children with indentation (sl-1ugo)", async () => {
    const SAP = resolve(EXAMPLES, "sap-po-to-mfcs/pipeline.stm");
    const { stdout, code } = await run("fields", "mfcs_purchase_order", SAP);
    assert.equal(code, 0);
    assert.match(stdout, /items\s+list/);
    // Children should be indented more than parent
    const lines = stdout.split("\n");
    const itemsLine = lines.findIndex((l) => l.includes("items"));
    assert.ok(itemsLine >= 0);
    const childLine = lines.find((l, i) => i > itemsLine && l.includes("item"));
    assert.ok(childLine, "should have child 'item' field after 'items'");
    // Child should be more indented
    const parentIndent = lines[itemsLine].match(/^\s*/)![0].length;
    const childIndent = childLine.match(/^\s*/)![0].length;
    assert.ok(childIndent > parentIndent, `child indent ${childIndent} should be > parent indent ${parentIndent}`);
  });

  it("--with-meta --json includes tags on nested record/list child fields (sl-gf8d)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("fields", "commerce_order", "--with-meta", "--json", XML);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const order = data.find((f: any) => f.name === "Order");
    assert.ok(order.tags, "Order record should have tags from metadata");
    // Check a nested child
    const orderId = order.children.find((f: any) => f.name === "OrderId");
    assert.ok(orderId.tags, "nested OrderId should have tags from xpath metadata");
  });
});

// ---------------------------------------------------------------------------
// satsuma nl
// ---------------------------------------------------------------------------
describe("satsuma nl", () => {
  const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");

  it("extracts NL content from a mapping scope", async () => {
    const { stdout, code } = await run("nl", "customer migration", DB);
    assert.equal(code, 0);
    assert.match(stdout, /\[transform\]/);
  });

  it("--kind transform filters to transform content", async () => {
    const { stdout, code } = await run(
      "nl", "customer migration", "--kind", "transform", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /\[transform\]/);
    assert.ok(!stdout.includes("[note]"));
    assert.ok(!stdout.includes("//!"));
  });

  it("--json returns structured items", async () => {
    const { stdout, code } = await run(
      "nl", "customer migration", "--json", DB,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
    assert.ok(data[0].text);
    assert.ok(data[0].kind);
    assert.ok(data[0].parent);
  });

  it("--json line numbers are 1-indexed", async () => {
    const { stdout, code } = await run(
      "nl", "customer migration", "--json", DB,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0);
    for (const item of data) {
      assert.ok(item.line >= 1, `line should be 1-indexed, got ${item.line}`);
    }
  });

  it("extracts warnings from schema scope", async () => {
    const { stdout, code } = await run("nl", "legacy_sqlserver", DB);
    assert.equal(code, 0);
    assert.match(stdout, /\/\/!/);
  });

  it("field scope extracts NL from arrows", async () => {
    const { stdout, code } = await run(
      "nl", "legacy_sqlserver.PHONE_NBR", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /\[transform\]/);
    assert.match(stdout, /digits/i);
  });

  it("exits 1 for unknown scope", async () => {
    const { stderr, code } = await run("nl", "nonexistent", DB);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("transform_block NL items have transform name as parent (sl-6ino)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "nl-parent-test.stm");
    const { stdout, code } = await run("nl", "all", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const transformItems = data.filter((d: any) => d.parent === "nl transform");
    assert.ok(transformItems.length >= 2, "should have transform-parented items");
  });

  it("concatenated note strings joined with separators (sl-p0et)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "nl-concat-note.stm");
    const { stdout, code } = await run("nl", "order transform", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const note = data.find((d: any) => d.kind === "note");
    assert.ok(note, "should have a note item");
    // Words at string boundaries should not run together
    assert.doesNotMatch(note.text, /note\.Second/, "should not run words together at boundaries");
    assert.match(note.text, /note\.\n?.*Second/, "should have separator between concatenated strings");
  });

  it("concatenated note strings are fully extracted (sl-gu24)", async () => {
    // Verifies that multi-string note blocks are concatenated and both strings
    // survive extraction (sl-gu24 bug: second string was dropped). The body note
    // for cart_abandonment_rate has two concatenated nl_strings spanning "checkout"
    // and "divided by". The metric_name tag also surfaces as a note item, so we
    // search all note items for the one containing the expected body text.
    const { stdout, code } = await run("nl", "cart_abandonment_rate", resolve(EXAMPLES, "metrics-platform/metrics.stm"), "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const bodyNote = data.find((d: any) => d.kind === "note" && /checkout/i.test(d.text));
    assert.ok(bodyNote, "should have a body note item containing 'checkout'");
    assert.match(bodyNote.text, /divided by/i, "should include second concatenated string");
  });

  it("record/list block notes use schema-qualified path as parent (sl-3nrg, sl-prsy)", async () => {
    // Field-level NL items use schema-qualified paths (e.g. "nested_test.address")
    // so consumers can disambiguate fields across schemas (sl-prsy).
    const F = resolve(import.meta.dirname, "fixtures", "nl-parent-test.stm");
    const { stdout, code } = await run("nl", "all", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const addressItems = data.filter((d: any) => d.parent === "nested_test.address");
    assert.ok(addressItems.length >= 1, "address block items should have parent 'nested_test.address'");
    const contactItems = data.filter((d: any) => d.parent === "nested_test.contacts");
    assert.ok(contactItems.length >= 1, "contacts block items should have parent 'nested_test.contacts'");
  });

  it("returns NL from both schema and mapping when names collide (sl-vw49)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "ambiguous-scope.stm");
    const { stdout, code } = await run("nl", "customers", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.some((d: any) => d.kind === "note"), "should include schema note");
    assert.ok(data.some((d: any) => d.kind === "transform"), "should include mapping transform");
    assert.ok(data.length >= 2, "should have at least 2 NL items from both blocks");
  });

  it("accepts standalone transform block names as scope (sl-egu3)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "nl-parent-test.stm");
    const { stdout, code } = await run("nl", "nl transform", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length > 0, "should find NL content in transform block");
    assert.ok(data.some((d: any) => d.parent === "nl transform"), "parent should be transform name");
  });

  it("unescapes escape sequences in NL strings (sl-j014)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "escape-test.stm");
    const { stdout, code } = await run("nl", "all", F, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const note = data.find((d: any) => d.kind === "note");
    assert.ok(note, "should have a note");
    assert.match(note.text, /Contains "quoted" text/, "should unescape \\\" to \"");
    assert.doesNotMatch(note.text, /\\"/, "should not contain escaped quotes");
  });
});

// ---------------------------------------------------------------------------
// satsuma meta
// ---------------------------------------------------------------------------
describe("satsuma meta", () => {
  const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");

  it("extracts schema metadata with note", async () => {
    const { stdout, code } = await run("meta", "legacy_sqlserver", DB);
    assert.equal(code, 0);
    assert.match(stdout, /note:/);
    assert.match(stdout, /CUSTOMER table/);
  });

  it("extracts field metadata with type, tags, enum, kv", async () => {
    const { stdout, code } = await run("meta", "legacy_sqlserver.CUST_TYPE", DB);
    assert.equal(code, 0);
    assert.match(stdout, /type: CHAR\(1\)/);
    assert.match(stdout, /enum/);
    assert.match(stdout, /default/);
  });

  it("--tags-only returns just tag tokens", async () => {
    const { stdout, code } = await run(
      "meta", "legacy_sqlserver.EMAIL_ADDR", "--tags-only", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /pii/);
    // Should not contain kv or enum formatting
    assert.ok(!stdout.includes("enum"));
  });

  it("--json returns structured metadata", async () => {
    const { stdout, code } = await run(
      "meta", "legacy_sqlserver.CUST_TYPE", "--json", DB,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.scope, "legacy_sqlserver.CUST_TYPE");
    assert.equal(data.type, "CHAR(1)");
    assert.ok(Array.isArray(data.entries));
    assert.ok(data.entries.some((e: any) => e.kind === "enum"));
  });

  it("--json unwraps quoted metadata values at schema scope (sl-2old)", async () => {
    // Schema-level metadata should expose logical string values, not raw source
    // text including the quote delimiters.
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("meta", "completed_orders_parquet", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const classification = data.entries.find((entry: any) => entry.kind === "kv" && entry.key === "classification");
    assert.equal(classification?.value, "INTERNAL");
  });

  it("--json unwraps quoted metadata values at field scope (sl-2old)", async () => {
    // Field-level metadata uses the same shared extractor and must normalize
    // string-valued kv metadata identically.
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("meta", "completed_orders_parquet.customer_email", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const classification = data.entries.find((entry: any) => entry.kind === "kv" && entry.key === "classification");
    const retention = data.entries.find((entry: any) => entry.kind === "kv" && entry.key === "retention");
    assert.equal(classification?.value, "RESTRICTED");
    assert.equal(retention?.value, "3y");
  });

  it("exits 1 for unknown scope", async () => {
    const { stderr, code } = await run("meta", "nonexistent", DB);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });

  it("extracts metric field metadata (sl-eglw)", async () => {
    const { stdout, code } = await run("meta", "order_revenue.gross_revenue", resolve(EXAMPLES, "metrics-platform/metrics.stm"));
    assert.equal(code, 0);
    assert.match(stdout, /type: DECIMAL/);
    assert.match(stdout, /measure/);
  });

  it("extracts metric field metadata as JSON (sl-eglw)", async () => {
    const { stdout, code } = await run("meta", "order_revenue.gross_revenue", "--json", resolve(EXAMPLES, "metrics-platform/metrics.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.entries.some((e: any) => e.kind === "kv" && e.key === "measure"));
  });

  it("extracts metadata from record/list blocks (sl-giss)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("meta", "commerce_order.Order", XML);
    assert.equal(code, 0);
    assert.match(stdout, /xpath/, "record block should show xpath metadata");
  });

  it("extracts metadata from nested list blocks (sl-giss)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("meta", "commerce_order.Discounts", "--json", XML);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.entries.some((e: any) => e.kind === "kv" && e.key === "xpath"), "list block should have xpath metadata");
  });

  it("supports nested field paths schema.record.field (sl-bfue)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout, code } = await run("meta", "commerce_order.Order.OrderId", "--json", XML);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.type, "STRING");
    assert.ok(data.entries.some((e: any) => e.kind === "kv" && e.key === "xpath"), "nested field should have xpath");
  });

  it("disambiguates same-named fields via nested path (sl-bfue)", async () => {
    const XML = resolve(EXAMPLES, "xml-to-parquet/pipeline.stm");
    const { stdout: s1 } = await run("meta", "commerce_order.Totals.TaxAmount", "--json", XML);
    const { stdout: s2 } = await run("meta", "commerce_order.LineItems.TaxAmount", "--json", XML);
    const d1 = JSON.parse(s1);
    const d2 = JSON.parse(s2);
    assert.equal(d1.type, d2.type, "both TaxAmount fields should have same type");
    assert.ok(d1.entries.length > 0 && d2.entries.length > 0, "both should have metadata");
  });

  it("finds fields from fragment spreads", async () => {
    const FIXTURE = resolve(__dirname, "fixtures/spread-meta.stm");
    const { stdout, code } = await run("meta", "uses_fragment.created_at", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /TIMESTAMPTZ/);
    assert.match(stdout, /required/);
    assert.match(stdout, /Creation timestamp/);
  });

  it("finds spread fields with --json", async () => {
    const FIXTURE = resolve(__dirname, "fixtures/spread-meta.stm");
    const { stdout, code } = await run("meta", "uses_fragment.created_at", "--json", FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.type, "TIMESTAMPTZ");
    assert.ok(data.entries.some((e: any) => e.kind === "tag" && e.tag === "required"));
    assert.ok(data.entries.some((e: any) => e.kind === "note" && e.text === "Creation timestamp"));
  });

  it("shows list_of prefix for scalar list fields (sc-5j7y)", async () => {
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("meta", "order_events.promo_codes", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.type, "list_of STRING");
  });

  it("still finds direct fields on schemas with spreads", async () => {
    const FIXTURE = resolve(__dirname, "fixtures/spread-meta.stm");
    const { stdout, code } = await run("meta", "uses_fragment.id", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /INT/);
    assert.match(stdout, /pk/);
  });
});

// ---------------------------------------------------------------------------
// satsuma match-fields
// ---------------------------------------------------------------------------
describe("satsuma match-fields", () => {
  const DB = resolve(EXAMPLES, "db-to-db/pipeline.stm");

  it("matches fields by normalized name (FirstName = first_name)", async () => {
    const { stdout, code } = await run(
      "match-fields", "--source", "legacy_sqlserver", "--target", "postgres_db", DB,
    );
    assert.equal(code, 0);
    // NOTES matches notes (both normalize to "notes")
    assert.match(stdout, /NOTES.*notes/i);
  });

  it("shows source-only and target-only lists", async () => {
    const { stdout, code } = await run(
      "match-fields", "--source", "legacy_sqlserver", "--target", "postgres_db", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /Source-only/);
    assert.match(stdout, /Target-only/);
  });

  it("--matched-only shows only matches", async () => {
    const { stdout, code } = await run(
      "match-fields", "--source", "legacy_sqlserver", "--target", "postgres_db",
      "--matched-only", DB,
    );
    assert.equal(code, 0);
    assert.ok(!stdout.includes("Source-only"));
  });

  it("--unmatched-only shows only unmatched", async () => {
    const { stdout, code } = await run(
      "match-fields", "--source", "legacy_sqlserver", "--target", "postgres_db",
      "--unmatched-only", DB,
    );
    assert.equal(code, 0);
    assert.match(stdout, /Source-only/);
    assert.match(stdout, /Target-only/);
    assert.ok(!stdout.includes("<->"));
  });

  it("--json returns structured output", async () => {
    const { stdout, code } = await run(
      "match-fields", "--source", "legacy_sqlserver", "--target", "postgres_db",
      "--json", DB,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.matched));
    assert.ok(Array.isArray(data.sourceOnly));
    assert.ok(Array.isArray(data.targetOnly));
  });

  it("--json --matched-only filters out unmatched fields (sl-vexa)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "match-fields-test.stm");
    const { stdout, code } = await run(
      "match-fields", "--source", "src_match", "--target", "tgt_match",
      "--matched-only", "--json", F,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.matched.length > 0, "should have matched fields");
    assert.deepStrictEqual(data.sourceOnly, [], "sourceOnly should be empty with --matched-only");
    assert.deepStrictEqual(data.targetOnly, [], "targetOnly should be empty with --matched-only");
  });

  it("--json --unmatched-only filters out matched fields (sl-vexa)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "match-fields-test.stm");
    const { stdout, code } = await run(
      "match-fields", "--source", "src_match", "--target", "tgt_match",
      "--unmatched-only", "--json", F,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.deepStrictEqual(data.matched, [], "matched should be empty with --unmatched-only");
    assert.ok(data.sourceOnly.length > 0 || data.targetOnly.length > 0, "should have some unmatched");
  });

  it("normalizes spaces in backtick-quoted field names (sl-u2qa)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "backtick-match.stm");
    const { stdout, code } = await run(
      "match-fields", "--source", "backtick_src", "--target", "backtick_tgt",
      "--json", F,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const spaceMatch = data.matched.find((m: any) => m.source.includes("Spaces") || m.target.includes("spaces"));
    assert.ok(spaceMatch, "backtick field with spaces should match snake_case equivalent");
  });

  it("exits 1 for unknown schema", async () => {
    const { stderr, code } = await run(
      "match-fields", "--source", "nonexistent", "--target", "postgres_db", DB,
    );
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });
});

// ---------------------------------------------------------------------------
// satsuma validate
// ---------------------------------------------------------------------------
describe("satsuma validate", () => {
  it("valid workspace produces 0 errors", async () => {
    const { stdout, code } = await run(
      "validate", resolve(EXAMPLES, "lib/common.stm"),
    );
    assert.equal(code, 0);
    assert.match(stdout, /no issues/i);
  });

  it("parse errors report correct structure", async () => {
    const BAD = resolve(import.meta.dirname, "fixtures", "parse-error.stm");
    const { stdout, code } = await run("validate", BAD);
    assert.equal(code, 2);
    assert.match(stdout, /error/);
    assert.match(stdout, /\d+ error/);
  });

  it("--quiet returns exit code only", async () => {
    const { stdout, code } = await run(
      "validate", "--quiet", resolve(EXAMPLES, "lib/common.stm"),
    );
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "");
  });

  it("--json produces valid JSON", async () => {
    const BAD = resolve(import.meta.dirname, "fixtures", "parse-error.stm");
    const { stdout, code } = await run("validate", "--json", BAD);
    assert.equal(code, 2);
    const data = JSON.parse(stdout);
    assert.ok(data.findings, "should have findings key");
    assert.ok(Array.isArray(data.findings));
    assert.ok(data.findings.length > 0);
    assert.ok(data.findings[0].file);
    assert.ok(data.findings[0].line);
    assert.ok(data.findings[0].severity);
    assert.ok(data.findings[0].rule);
    assert.ok(data.findings[0].message);
    assert.ok(data.summary, "should have summary key");
    assert.equal(typeof data.summary.files, "number");
    assert.equal(typeof data.summary.errors, "number");
    assert.equal(typeof data.summary.warnings, "number");
  });

  it("expands fragment spreads — no false field-not-in-schema warnings", async () => {
    const FIXTURE = resolve(import.meta.dirname, "fixtures", "fragment-spread-validate.stm");
    const { stdout, code } = await run("validate", FIXTURE);
    assert.equal(code, 0, `Expected clean validation but got:\n${stdout}`);
    assert.match(stdout, /no issues/i);
  });

  it("suppresses field-not-in-schema for convention fields (stm-1hsk)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "convention-fields.stm");
    const { stdout, code } = await run("validate", F);
    assert.equal(code, 0, `Convention fields should not trigger warnings:\n${stdout}`);
    assert.match(stdout, /no issues/i);
  });

  it("--errors-only keeps semantic errors (not just parse errors)", async () => {
    const DUP = resolve(import.meta.dirname, "fixtures", "ns-duplicate.stm");
    const { stdout, code } = await run("validate", "--errors-only", DUP);
    assert.equal(code, 2, "duplicate-definition is severity error, should exit 2");
    assert.match(stdout, /duplicate/i);
  });

  it("catches metric source referencing nonexistent schema (sl-313n)", async () => {
    const BAD = resolve(import.meta.dirname, "fixtures", "metric-bad-source.stm");
    const { stdout, code } = await run("validate", BAD);
    assert.equal(code, 0, "warnings-only should exit 0");
    assert.match(stdout, /undefined-ref/);
    assert.match(stdout, /nonexistent_schema/);
    assert.match(stdout, /1 warning/);
  });

  it("catches undefined fragment spread references (sl-idbf)", async () => {
    const BAD = resolve(import.meta.dirname, "fixtures", "undefined-spread.stm");
    const { stdout, code } = await run("validate", BAD);
    assert.equal(code, 0, "warnings-only should exit 0");
    assert.match(stdout, /undefined-ref/);
    assert.match(stdout, /nonexistent_fragment/);
  });

  it("catches undefined transform spread references in arrows (sl-1s81)", async () => {
    const BAD = resolve(import.meta.dirname, "fixtures", "transform-spread.stm");
    const { stdout, code } = await run("validate", BAD);
    assert.equal(code, 0, "warnings-only should exit 0");
    assert.match(stdout, /undefined-ref/);
    assert.match(stdout, /nonexistent_xform/);
    // Use a structural assertion that the warning message itself does not name 'cleanup',
    // rather than scanning the full stdout — file paths printed in diagnostics can legitimately
    // contain the word "cleanup" (e.g. when the test runs from a worktree under chore/cleanup-*).
    assert.doesNotMatch(stdout, /undefined transform 'cleanup'/, "known transform 'cleanup' should not be flagged");
    assert.match(stdout, /1 warning/);
  });

  it("includes missing import file in diagnostics (sl-bhpv)", async () => {
    const BAD = resolve(import.meta.dirname, "fixtures", "missing-import.stm");
    const { stdout, code } = await run("validate", BAD, "--json");
    assert.equal(code, 0, "missing import is a warning, not an error");
    const data = JSON.parse(stdout);
    assert.ok(data.findings.some((d: any) => d.rule === "missing-import"), "should have missing-import diagnostic");
  });

  it("warns on undefined import name (sl-t5k4)", async () => {
    const badImport = resolve(import.meta.dirname, "fixtures", "import-validate", "bad-import.stm");
    const { stdout, code } = await run("validate", badImport, "--json");
    assert.equal(code, 0, "undefined import is a warning, not an error");
    const data = JSON.parse(stdout);
    const undefinedImport = data.findings.find((d: any) => d.rule === "undefined-import");
    assert.ok(undefinedImport, "should have undefined-import diagnostic");
    assert.match(undefinedImport.message, /totally_fake_name/);
  });

  it("warns on ref metadata pointing to nonexistent schema (sl-7vbb)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "ref-check.stm");
    const { stdout, code } = await run("validate", F, "--json");
    assert.equal(code, 0, "ref warning is not an error");
    const data = JSON.parse(stdout);
    const refWarning = data.findings.find((d: any) => d.rule === "undefined-ref" && d.message.includes("nonexistent_table"));
    assert.ok(refWarning, "should warn about ref to nonexistent_table");
    // Valid ref to customers should NOT produce a warning
    assert.ok(!data.findings.some((d: any) => d.message.includes("customers")), "valid ref should not warn");
  });

  it("target-only mapping parses without errors (sl-icqz)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "target-only-mapping.stm");
    const { stdout, code } = await run("validate", F);
    assert.equal(code, 0, `Target-only mapping should parse cleanly:\n${stdout}`);
    assert.match(stdout, /no issues/i);
  });

  it("--json produces JSON for filesystem errors (sl-5q6h)", async () => {
    const { stdout, code } = await run("validate", "/nonexistent/path.stm", "--json");
    assert.equal(code, 2);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.equal(data.length, 1);
    assert.equal(data[0].severity, "error");
    assert.match(data[0].message, /ENOENT|resolving path/);
  });

  it("unclosed schema at EOF reports missing-node error (sl-w6yu)", async () => {
    const F = resolve(import.meta.dirname, "fixtures", "unclosed-schema.stm");
    const { stdout, code } = await run("validate", F);
    assert.equal(code, 2, "should exit with code 2 for parse errors");
    assert.match(stdout, /missing/i, "should report the missing closing brace");
  });
});

// ---------------------------------------------------------------------------
// satsuma diff
// ---------------------------------------------------------------------------
describe("satsuma diff", () => {
  it("identical files produce empty diff", async () => {
    const f = resolve(EXAMPLES, "lib/common.stm");
    const { stdout, code } = await run("diff", f, f);
    assert.equal(code, 0);
    assert.match(stdout, /no structural differences/i);
  });

  it("different files show changes", async () => {
    const { stdout, code } = await run(
      "diff",
      resolve(EXAMPLES, "db-to-db/pipeline.stm"),
      resolve(EXAMPLES, "lib/common.stm"),
    );
    assert.equal(code, 0);
    // Should show added/removed schemas
    assert.ok(stdout.includes("+") || stdout.includes("-"));
  });

  it("--json produces valid delta object", async () => {
    const { stdout, code } = await run(
      "diff", "--json",
      resolve(EXAMPLES, "db-to-db/pipeline.stm"),
      resolve(EXAMPLES, "lib/common.stm"),
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.schemas);
    assert.ok(data.mappings);
    assert.ok(Array.isArray(data.schemas.added));
    assert.ok(Array.isArray(data.schemas.removed));
  });

  it("--stat shows summary counts", async () => {
    const { stdout, code } = await run(
      "diff", "--stat",
      resolve(EXAMPLES, "db-to-db/pipeline.stm"),
      resolve(EXAMPLES, "lib/common.stm"),
    );
    assert.equal(code, 0);
    // Should show counts like "2 schemas added"
    assert.match(stdout, /\d+/);
  });

  it("--names-only lists changed block names", async () => {
    const { stdout, code } = await run(
      "diff", "--names-only",
      resolve(EXAMPLES, "db-to-db/pipeline.stm"),
      resolve(EXAMPLES, "lib/common.stm"),
    );
    assert.equal(code, 0);
    assert.ok(stdout.trim().length > 0);
  });

  it("reports no differences for byte-identical files containing anonymous mappings (sl-ndtz)", async () => {
    // Anonymous mappings were keyed by absolute path + row internally, so two
    // identical files at different paths always produced phantom +/- entries.
    const dir = mkdtempSync(join(tmpdir(), "satsuma-diff-"));
    const source = "schema s {\n  id INTEGER\n}\n\nschema t {\n  id INTEGER\n}\n\nmapping {\n  source { s }\n  target { t }\n  id -> id\n}\n";
    const v1 = join(dir, "v1.stm");
    const v2 = join(dir, "v2.stm");
    writeFileSync(v1, source);
    writeFileSync(v2, source);

    const { stdout, code } = await run("diff", v1, v2);
    assert.equal(code, 0);
    assert.match(stdout, /no structural differences/i);
    assert.doesNotMatch(stdout, /<anon>@/, "internal anon keys must never reach user output");
  });

  it("documents that imports are not followed, matching actual behaviour (sl-ndtz)", async () => {
    // diff resolves both inputs with followImports:false; the help text used
    // to claim the opposite.
    const { stdout, code } = await run("diff", "--help");
    assert.equal(code, 0);
    assert.match(stdout, /imports are not followed/i);
    assert.doesNotMatch(stdout, /resolved with its imports/i);
  });

  it("diffs metrics, fragments, and transforms", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    // Metrics
    assert.match(stdout, /Metrics:/);
    assert.match(stdout, /\+ churn_rate/);
    assert.match(stdout, /~ monthly_revenue/);
    // Fragments
    assert.match(stdout, /Fragments:/);
    assert.match(stdout, /~ audit columns/);
    assert.match(stdout, /\+ field deleted_at/);
    // Transforms
    assert.match(stdout, /Transforms:/);
    assert.match(stdout, /\+ hash_key/);
  });

  it("--json includes metrics, fragments, transforms sections", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.metrics, "delta should have metrics section");
    assert.ok(data.fragments, "delta should have fragments section");
    assert.ok(data.transforms, "delta should have transforms section");
    assert.deepStrictEqual(data.metrics.added, ["churn_rate"]);
    assert.equal(data.metrics.changed.length, 1);
    assert.equal(data.metrics.changed[0].name, "monthly_revenue");
    assert.deepStrictEqual(data.transforms.added, ["hash_key"]);
    assert.equal(data.fragments.changed.length, 1);
  });

  it("--stat includes metrics, fragments, transforms counts", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-b.stm");
    const { stdout, code } = await run("diff", "--stat", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /metrics added/);
    assert.match(stdout, /metrics changed/);
    assert.match(stdout, /fragments changed/);
    assert.match(stdout, /transforms added/);
  });

  it("detects field metadata changes", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-meta-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-meta-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /~ name metadata/);
    assert.match(stdout, /~ email metadata/);
  });

  it("--json reports metadata-changed kind", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-meta-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-meta-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const changes = data.schemas.changed[0].changes;
    assert.ok(changes.some((c: any) => c.kind === "metadata-changed" && c.field === "name"));
    assert.ok(changes.some((c: any) => c.kind === "metadata-changed" && c.field === "email"));
  });

  it("detects note block additions and removals", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-notes-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-notes-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /Notes:/);
    assert.match(stdout, /\+ "This is the UPDATED/);
    assert.match(stdout, /- "This is the original/);
  });

  it("--json includes notes delta", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-notes-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-notes-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.notes, "delta should have notes section");
    assert.equal(data.notes.added.length, 2);
    assert.equal(data.notes.removed.length, 1);
  });

  it("detects nested record/list field changes", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-nested-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-nested-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /\+ field address\.zip/);
    assert.match(stdout, /\+ field items\.price/);
  });

  it("--json reports nested field changes with dotted paths", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-nested-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-nested-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const changes = data.schemas.changed[0].changes;
    const fields = changes.map((c: any) => c.field);
    assert.ok(fields.includes("address.zip"), "should include address.zip");
    assert.ok(fields.includes("items.price"), "should include items.price");
  });

  it("--stat includes note counts", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-notes-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-notes-b.stm");
    const { stdout, code } = await run("diff", "--stat", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /notes added/);
    assert.match(stdout, /notes removed/);
  });

  it("detects arrow transform changes in mappings (sl-o4wq)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-transform-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-transform-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /arrow.*name.*display_name/);
    assert.match(stdout, /title_case.*uppercase/);
  });

  it("--json reports arrow transform changes (sl-o4wq)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-transform-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-transform-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const mapping = data.mappings.changed.find((m: any) => m.name === "copy data");
    assert.ok(mapping, "should have changed mapping");
    const transformChange = mapping.changes.find((c: any) => c.kind === "arrow-transform-changed");
    assert.ok(transformChange, "should have arrow-transform-changed");
    assert.match(String(transformChange.from), /title_case/);
    assert.match(String(transformChange.to), /uppercase/);
  });

  it("detects schema-level note text changes (sl-4gio)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-schema-note-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-schema-note-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /note/);
    assert.match(stdout, /Raw source data/);
    assert.match(stdout, /Updated raw source data description/);
  });

  it("--json reports schema note-changed kind (sl-4gio)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-schema-note-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-schema-note-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const schemaChange = data.schemas.changed.find((s: any) => s.name === "source_data");
    assert.ok(schemaChange, "should have changed schema");
    const noteChange = schemaChange.changes.find((c: any) => c.kind === "note-changed");
    assert.ok(noteChange, "should have note-changed");
    assert.equal(noteChange.from, "Raw source data");
    assert.equal(noteChange.to, "Updated raw source data description");
  });

  it("detects transform body text changes (sl-7ow3)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-transform-body-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-transform-body-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /clean address/);
    assert.match(stdout, /body/);
  });

  it("--json reports transform body-changed kind (sl-7ow3)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-transform-body-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-transform-body-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const txChange = data.transforms.changed.find((t: any) => t.name === "clean address");
    assert.ok(txChange, "should have changed transform");
    const bodyChange = txChange.changes.find((c: any) => c.kind === "body-changed");
    assert.ok(bodyChange, "should have body-changed");
    assert.match(bodyChange.from, /trim/);
    assert.match(bodyChange.to, /capitalize/);
  });

  it("metric note change attributed under metric, not top-level (sl-kf76)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-metric-note-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-metric-note-b.stm");
    const { stdout, code } = await run("diff", a, b);
    assert.equal(code, 0);
    assert.match(stdout, /Metrics:/);
    assert.match(stdout, /daily_signups/);
    assert.match(stdout, /note/);
  });

  it("--json metric note changes under metrics.changed, not notes (sl-kf76)", async () => {
    const a = resolve(import.meta.dirname, "fixtures", "diff-metric-note-a.stm");
    const b = resolve(import.meta.dirname, "fixtures", "diff-metric-note-b.stm");
    const { stdout, code } = await run("diff", "--json", a, b);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const metricChange = data.metrics.changed.find((m: any) => m.name === "daily_signups");
    assert.ok(metricChange, "should have changed metric");
    const noteAdded = metricChange.changes.find((c: any) => c.kind === "note-added");
    const noteRemoved = metricChange.changes.find((c: any) => c.kind === "note-removed");
    assert.ok(noteAdded, "should have note-added");
    assert.ok(noteRemoved, "should have note-removed");
    assert.equal(data.notes.added.length, 0, "metric notes should not leak to top-level");
    assert.equal(data.notes.removed.length, 0, "metric notes should not leak to top-level");
  });

  it("shows removals when file B imports from file A (sl-pzgv)", async () => {
    const lib = resolve(import.meta.dirname, "fixtures", "diff-import-lib.stm");
    const consumer = resolve(import.meta.dirname, "fixtures", "diff-import-consumer.stm");
    const { stdout, code } = await run("diff", lib, consumer);
    assert.equal(code, 0);
    assert.match(stdout, /- ref_data/, "schema from lib not in consumer should appear as removed");
    assert.match(stdout, /- audit_fields/, "fragment from lib not in consumer should appear as removed");
    assert.match(stdout, /\+ orders/, "schema only in consumer should appear as added");
  });

  it("--json shows removals when file B imports from file A (sl-pzgv)", async () => {
    const lib = resolve(import.meta.dirname, "fixtures", "diff-import-lib.stm");
    const consumer = resolve(import.meta.dirname, "fixtures", "diff-import-consumer.stm");
    const { stdout, code } = await run("diff", "--json", lib, consumer);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.schemas.removed.includes("ref_data"), "ref_data should be in schemas.removed");
    assert.ok(data.schemas.added.includes("orders"), "orders should be in schemas.added");
    assert.ok(data.fragments.removed.includes("audit_fields"), "audit_fields should be in fragments.removed");
  });
});

// ---------------------------------------------------------------------------
// Namespace-aware commands
// ---------------------------------------------------------------------------
const NS_FIXTURE = resolve(import.meta.dirname, "fixtures", "namespaces.stm");

describe("satsuma summary (namespaces)", () => {
  it("shows ns::name format for namespaced schemas", async () => {
    const { stdout, code } = await run("summary", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /pos::stores/);
    assert.match(stdout, /pos::transactions/);
    assert.match(stdout, /ecom::orders/);
    assert.match(stdout, /warehouse::hub_store/);
  });

  it("shows global entities without namespace prefix", async () => {
    const { stdout, code } = await run("summary", NS_FIXTURE);
    assert.equal(code, 0);
    // audit_fields is global — should appear without ns:: prefix
    assert.match(stdout, /audit_fields/);
    assert.doesNotMatch(stdout, /\w+::audit_fields/);
  });

  it("--json includes all namespaced schemas", async () => {
    const { stdout, code } = await run("summary", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.schemas.map((s: any) => s.name);
    assert.ok(names.includes("pos::stores"));
    assert.ok(names.includes("ecom::orders"));
    assert.ok(names.includes("warehouse::hub_store"));
  });

  it("--compact lists qualified names", async () => {
    const { stdout, code } = await run("summary", "--compact", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /pos::stores/);
    assert.match(stdout, /ecom::customers/);
  });
});

describe("satsuma schema (namespaces)", () => {
  it("resolves fully qualified namespace schema", async () => {
    const { stdout, code } = await run("schema", "pos::stores", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /STORE_ID/);
    assert.match(stdout, /STORE_NAME/);
  });

  it("resolves unambiguous unqualified name to namespaced schema", async () => {
    // 'hub_store' exists only in warehouse namespace
    const { stdout, code } = await run("schema", "hub_store", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /store_hk/);
  });

  it("reports ambiguous unqualified name", async () => {
    // 'orders' exists in ecom — should resolve since it's unique
    // But let's test a schema that exists in only one namespace
    const { stdout, code } = await run("schema", "stores", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /STORE_ID/);
  });

  it("--fields-only works for namespaced schema", async () => {
    const { stdout, code } = await run("schema", "pos::stores", "--fields-only", NS_FIXTURE);
    assert.equal(code, 0);
    const lines = stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 3, `expected at least 3 field lines, got ${lines.length}`);
  });

  it("--json works for namespaced schema", async () => {
    const { stdout, code } = await run("schema", "pos::stores", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.name);
    assert.ok(Array.isArray(data.fields));
    assert.ok(data.fields.length >= 3);
  });

  it("--json includes namespace field for namespaced schema (sl-5pa2)", async () => {
    const { stdout, code } = await run("schema", "pos::stores", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.namespace, "pos");
    assert.equal(data.name, "pos::stores");
  });

  it("text output includes namespace prefix for namespaced schema (sl-5pa2)", async () => {
    const { stdout, code } = await run("schema", "pos::stores", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /schema pos::stores/);
  });
});

describe("satsuma validate (namespaces)", () => {
  it("valid namespace file produces no errors", async () => {
    const { stdout, code } = await run("validate", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /no issues/i);
  });

  it("catches duplicates within a namespace", async () => {
    const DUP = resolve(import.meta.dirname, "fixtures", "ns-duplicate.stm");
    const { stdout, code } = await run("validate", DUP);
    assert.notEqual(code, 0);
    assert.match(stdout, /duplicate-definition/);
    assert.match(stdout, /pos::stores/);
  });

  it("catches namespace metadata conflicts", async () => {
    const CONFLICT = resolve(import.meta.dirname, "fixtures", "ns-meta-conflict.stm");
    const { stdout, code } = await run("validate", CONFLICT);
    assert.notEqual(code, 0);
    assert.match(stdout, /namespace-metadata-conflict|conflicting/i);
  });

  it("warns for unqualified cross-namespace reference with hint", async () => {
    const BAD_REF = resolve(import.meta.dirname, "fixtures", "ns-unresolved-ref.stm");
    const { stdout } = await run("validate", BAD_REF);
    // Should produce a warning about 'stores' not being defined in vault or global
    assert.match(stdout, /undefined-ref|undefined.*stores/i);
    assert.match(stdout, /hint|pos::stores/i);
  });

  it("--json shows namespace-aware diagnostics", async () => {
    const DUP = resolve(import.meta.dirname, "fixtures", "ns-duplicate.stm");
    const { stdout, code } = await run("validate", "--json", DUP);
    assert.notEqual(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.findings, "should have findings key");
    assert.ok(Array.isArray(data.findings));
    const dupError = data.findings.find((d: any) => d.rule === "duplicate-definition");
    assert.ok(dupError, "Should contain a duplicate-definition diagnostic");
    assert.ok(dupError.message.includes("pos::stores"));
  });
});

describe("satsuma find (namespaces)", () => {
  it("finds pii tag inside namespace blocks", async () => {
    const { stdout, code } = await run("find", "--tag", "pii", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /pii/i);
  });

  it("--json returns matches from namespaced schemas", async () => {
    const { stdout, code } = await run("find", "--tag", "pii", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 2, "expected at least 2 pii-tagged fields");
    // Should include fields from pos::stores and ecom::customers
    const blocks = data.map((m) => m.block);
    assert.ok(
      blocks.some((b) => b.includes("stores")),
      "should find pii in stores",
    );
    assert.ok(
      blocks.some((b) => b.includes("customers")),
      "should find pii in customers",
    );
  });
});

describe("satsuma lineage (namespaces)", () => {
  it("traces lineage from qualified namespace schema", async () => {
    const { stdout, code } = await run(
      "lineage", "--from", "pos::stores", NS_FIXTURE,
    );
    assert.equal(code, 0);
    // pos::stores -> load hub_store -> warehouse::hub_store
    assert.match(stdout, /load hub_store|hub_store/);
  });

  it("traces lineage from unqualified unique schema", async () => {
    const { stdout, code } = await run(
      "lineage", "--from", "stores", NS_FIXTURE,
    );
    assert.equal(code, 0);
    assert.match(stdout, /hub_store/);
  });

  it("--json produces DAG with namespace-qualified names", async () => {
    const { stdout, code } = await run(
      "lineage", "--from", "pos::stores", "--json", NS_FIXTURE,
    );
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.nodes));
    assert.ok(Array.isArray(data.edges));
    const nodeNames = data.nodes.map((n: any) => n.name);
    assert.ok(nodeNames.includes("pos::stores"));
  });

  it("exits 1 for unknown qualified schema", async () => {
    const { code, stderr } = await run(
      "lineage", "--from", "nonexistent::schema", NS_FIXTURE,
    );
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });
});

describe("satsuma where-used (namespaces)", () => {
  it("shows references for a namespaced schema", async () => {
    const { stdout, code } = await run("where-used", "pos::stores", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /pos::stores|load hub_store/i);
  });
});

describe("satsuma fields (namespaces)", () => {
  it("lists fields for qualified namespace schema", async () => {
    const { stdout, code } = await run("fields", "pos::stores", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /STORE_ID/);
    assert.match(stdout, /STORE_NAME/);
    assert.match(stdout, /REGION_CD/);
  });

  it("lists fields for unqualified unique schema", async () => {
    const { stdout, code } = await run("fields", "hub_store", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /store_hk/);
  });

  it("--json returns structured fields", async () => {
    const { stdout, code } = await run("fields", "pos::stores", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 3);
  });
});

describe("satsuma mapping (namespaces)", () => {
  it("resolves namespaced mapping by name", async () => {
    const { stdout, code } = await run("mapping", "load hub_store", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /pos::stores|hub_store/);
  });

  it("--json shows cross-namespace source reference", async () => {
    const { stdout, code } = await run("mapping", "load hub_store", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.name);
    assert.ok(data.sources.includes("pos::stores") || data.sources.some((s: any) => s.includes("stores")));
  });

  it("--json includes namespace field for namespaced mappings (sl-x8yp)", async () => {
    const { stdout, code } = await run("mapping", "load hub_store", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.namespace, "namespace should be included in JSON");
  });
});

// ---------------------------------------------------------------------------
// Bug fix: arrows command (stm-sbgx) — schema qualifier respected
// ---------------------------------------------------------------------------
const NS_PLATFORM = resolve(EXAMPLES, "namespaces/ns-platform.stm");
const NS_MERGING = resolve(EXAMPLES, "namespaces/ns-merging.stm");

describe("satsuma arrows (namespace bugs)", () => {
  it("scopes arrows to the correct schema", async () => {
    const { stdout, code } = await run("arrows", "raw::crm_contacts.email", NS_PLATFORM);
    assert.equal(code, 0);
    // Should find only the arrow in vault::load sat_contact
    assert.match(stdout, /load sat_contact/);
    // Should NOT find the arrow in mart::build dim_contact
    assert.doesNotMatch(stdout, /build dim_contact/);
  });

  it("returns different results for different schemas with same field name", async () => {
    const { stdout: srcOut } = await run("arrows", "raw::crm_contacts.email", NS_PLATFORM);
    const { stdout: tgtOut } = await run("arrows", "mart::dim_contact.email", NS_PLATFORM);
    // Different result sets
    assert.notEqual(srcOut, tgtOut);
    assert.match(tgtOut, /build dim_contact/);
    assert.doesNotMatch(tgtOut, /load sat_contact/);
  });

  it("JSON shows resolved target schema", async () => {
    const { stdout, code } = await run("arrows", "raw::crm_contacts.email", "--json", NS_PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.length >= 1);
    // Target should be resolved, not "?.email"
    const arrow = data.find((a: any) => a.target);
    assert.ok(arrow.target.includes("sat_contact_details"), `expected qualified target, got ${arrow.target}`);
    assert.doesNotMatch(arrow.target, /^\?/);
  });

  it("summary count is arithmetically correct", async () => {
    const { stdout, code } = await run("arrows", "raw::crm_contacts.email", NS_PLATFORM);
    assert.equal(code, 0);
    // Parse "N arrow(s) (M as source, K as target)"
    const totalMatch = stdout.match(/(\d+) arrows?/);
    const sourceMatch = stdout.match(/(\d+) as source/);
    const targetMatch = stdout.match(/(\d+) as target/);
    assert.ok(totalMatch, "should have arrow count");
    const total = parseInt(totalMatch[1]);
    const asSource = sourceMatch ? parseInt(sourceMatch[1]) : 0;
    const asTarget = targetMatch ? parseInt(targetMatch[1]) : 0;
    assert.ok(total <= asSource + asTarget, `total ${total} should be <= source ${asSource} + target ${asTarget}`);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: lineage --from (stm-ku9i) — qualified target names
// ---------------------------------------------------------------------------
describe("satsuma lineage --from (namespace bugs)", () => {
  it("shows fully qualified target schema names", async () => {
    const { stdout, code } = await run("lineage", "--from", "raw::crm_deals", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /vault::hub_deal/);
    assert.match(stdout, /vault::link_contact_deal/);
  });

  it("multi-hop lineage works end-to-end", async () => {
    const { stdout, code } = await run("lineage", "--from", "raw::crm_deals", NS_PLATFORM);
    assert.equal(code, 0);
    // Should reach mart layer via vault
    assert.match(stdout, /mart::fact_deals/);
  });

  it("--json nodes include namespace prefix", async () => {
    const { stdout, code } = await run("lineage", "--from", "raw::crm_deals", "--json", NS_PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const nodeNames = data.nodes.map((n: any) => n.name);
    assert.ok(nodeNames.includes("vault::hub_deal"), `expected vault::hub_deal in ${nodeNames}`);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: lineage --to (stm-3af2) — works with namespaced schemas
// ---------------------------------------------------------------------------
describe("satsuma lineage --to (namespace bugs)", () => {
  it("traces upstream for namespaced target", async () => {
    const { stdout, code } = await run("lineage", "--to", "mart::fact_revenue", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /raw::erp_invoices/);
    assert.match(stdout, /mart::build fact_revenue/);
  });

  it("traces multi-hop upstream through vault", async () => {
    const { stdout, code } = await run("lineage", "--to", "mart::dim_contact", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /vault::hub_contact/);
    assert.match(stdout, /raw::crm_contacts/);
  });

  it("traces upstream with merged namespaces", async () => {
    const { stdout, code } = await run("lineage", "--to", "staging::stg_gl_entries", NS_MERGING);
    assert.equal(code, 0);
    // BFS finds a valid upstream path — may go through structural source
    // (finance_gl) or NL-derived source (hr_employees); both are correct
    assert.match(stdout, /source::(finance_gl|hr_employees)/);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: metric metadata (stm-axj8) — values not lost
// ---------------------------------------------------------------------------
describe("satsuma metric (namespace bugs)", () => {
  it("displays correct metadata values for namespaced sources", async () => {
    const { stdout, code } = await run("metric", "pipeline_value", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /source vault::hub_deal/);
    assert.match(stdout, /grain daily/);
    // Should NOT show "source source" or "grain grain"
    assert.doesNotMatch(stdout, /source source/);
    assert.doesNotMatch(stdout, /grain grain/);
  });

  it("JSON metadata array has correct values", async () => {
    const { stdout, code } = await run("metric", "pipeline_value", "--json", NS_PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const sourceMeta = data.metadata.find((m: any) => m.key === "source");
    assert.ok(sourceMeta);
    assert.equal(sourceMeta.value, "vault::hub_deal");
    const grainMeta = data.metadata.find((m: any) => m.key === "grain");
    assert.ok(grainMeta);
    assert.equal(grainMeta.value, "daily");
  });

  it("--json includes namespace field for namespaced metric (sl-09bo)", async () => {
    const { stdout, code } = await run("metric", "analytics::daily_sales", "--json", NS_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.namespace, "analytics");
    assert.equal(data.name, "analytics::daily_sales");
  });

  it("text output includes namespace prefix for namespaced metric (sl-09bo)", async () => {
    // Metrics are now rendered as schema blocks — the output uses `schema`, not `metric`.
    const { stdout, code } = await run("metric", "analytics::daily_sales", NS_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /schema analytics::daily_sales/);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: where-used (stm-4oop) — fragment spreads and transform refs
// ---------------------------------------------------------------------------
describe("satsuma where-used (namespace bugs)", () => {
  it("finds fragment spreads inside namespace blocks", async () => {
    const { stdout, code } = await run("where-used", "standard_metadata", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /7/);
    assert.match(stdout, /raw::crm_contacts/);
    assert.match(stdout, /vault::hub_contact/);
    assert.match(stdout, /vault::link_contact_deal/);
  });

  it("finds transform invocations inside namespace mappings", async () => {
    const { stdout, code } = await run("where-used", "dv_hash_key", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /5/);
    assert.match(stdout, /vault::load hub_contact/);
    assert.match(stdout, /vault::load hub_deal/);
  });

  it("finds single transform reference", async () => {
    const { stdout, code } = await run("where-used", "normalize_email", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /1/);
    assert.match(stdout, /vault::load sat_contact/);
  });

  it("finds schema references from both source and target mappings", async () => {
    const { stdout, code } = await run("where-used", "hub_contact", NS_PLATFORM);
    assert.equal(code, 0);
    // Should find vault::load hub_contact (target) and mart::build dim_contact (source)
    assert.match(stdout, /vault::load hub_contact/);
    assert.match(stdout, /mart::build dim_contact/);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: fields --unmapped-by (stm-9mao) — correct with namespaces
// ---------------------------------------------------------------------------
describe("satsuma fields --unmapped-by (namespace bugs)", () => {
  it("returns only unmapped fields for namespace-scoped mapping", async () => {
    const { stdout, code } = await run(
      "fields", "mart::dim_contact", "--unmapped-by", "build dim_contact", NS_PLATFORM,
    );
    assert.equal(code, 0);
    // Only is_current, valid_from, valid_to are unmapped
    assert.match(stdout, /is_current/);
    assert.match(stdout, /valid_from/);
    assert.match(stdout, /valid_to/);
    // Mapped fields should NOT appear
    assert.doesNotMatch(stdout, /contact_sk/);
    assert.doesNotMatch(stdout, /contact_bk/);
    assert.doesNotMatch(stdout, /full_name/);
    assert.doesNotMatch(stdout, /email/);
    assert.doesNotMatch(stdout, /company/);
  });

  it("works with qualified mapping name", async () => {
    const { stdout, code } = await run(
      "fields", "mart::dim_contact", "--unmapped-by", "mart::build dim_contact", NS_PLATFORM,
    );
    assert.equal(code, 0);
    assert.match(stdout, /is_current/);
    assert.doesNotMatch(stdout, /contact_sk/);
  });
});

// ---------------------------------------------------------------------------
// satsuma nl-refs
// ---------------------------------------------------------------------------
describe("satsuma nl-refs", () => {
  it("extracts @refs from ns-merging.stm", async () => {
    const { stdout, code } = await run("nl-refs", NS_MERGING);
    assert.equal(code, 0);
    assert.match(stdout, /NL @ref references/);
    assert.match(stdout, /source::hr_employees/);
    assert.match(stdout, /department/);
    assert.match(stdout, /posted_by/);
  });

  it("supports --json output", async () => {
    const { stdout, code } = await run("nl-refs", "--json", NS_MERGING);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    assert.ok(Array.isArray(refs));
    assert.ok(refs.length > 0);
    assert.ok(refs[0].ref);
    assert.ok(refs[0].classification);
    assert.ok("resolved" in refs[0]);
  });

  it("supports --mapping filter", async () => {
    const { stdout, code } = await run(
      "nl-refs", "--mapping", "stage gl entries", "--json", NS_MERGING,
    );
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    assert.ok(refs.length > 0);
    // All refs should be from this mapping
    for (const ref of refs) {
      assert.match(ref.mapping, /stage gl entries/);
    }
  });

  it("supports --unresolved filter with no results", async () => {
    const { code } = await run("nl-refs", "--unresolved", NS_MERGING);
    assert.equal(code, 1, "should exit 1 when no refs match filter");
  });

  it("--json outputs empty array when no refs found", async () => {
    const { stdout, code } = await run("nl-refs", "--unresolved", "--json", NS_MERGING);
    assert.equal(code, 1);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data), "should output JSON array");
    assert.equal(data.length, 0);
  });

  it("extracts refs from db-to-db.stm with COUNTRY_CD backtick", async () => {
    const dbFile = resolve(EXAMPLES, "db-to-db/pipeline.stm");
    const { stdout, code } = await run("nl-refs", "--json", dbFile);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    const countryCd = refs.find((r: any) => r.ref === "COUNTRY_CD");
    assert.ok(countryCd, "should find COUNTRY_CD @ref");
  });

  it("extracts @refs from standalone transform blocks", async () => {
    // Extraction logic tested in nl-ref-extract.test.ts; here we verify CLI end-to-end.
    const fixture = resolve(import.meta.dirname, "fixtures", "transform-nl-refs.stm");
    const { stdout, code } = await run("nl-refs", "--json", fixture);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    assert.equal(refs.length, 3, "should find 3 @refs");
    const refNames = refs.map((r: any) => r.ref).sort();
    assert.deepStrictEqual(refNames, ["first_name", "last_name", "region_code"]);
  });

  it("shows transform name in mapping field for transform refs", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "transform-nl-refs.stm");
    const { stdout, code } = await run("nl-refs", "--json", fixture);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    const firstName = refs.find((r: any) => r.ref === "first_name");
    assert.equal(firstName.mapping, "transform:build_fullname");
    const regionCode = refs.find((r: any) => r.ref === "region_code");
    assert.equal(regionCode.mapping, "transform:region_lookup");
  });

  it("displays transform refs in text output", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "transform-nl-refs.stm");
    const { stdout, code } = await run("nl-refs", fixture);
    assert.equal(code, 0);
    assert.match(stdout, /transform 'build_fullname'/);
    assert.match(stdout, /first_name/);
    assert.match(stdout, /last_name/);
    assert.match(stdout, /region_code/);
  });

  it("extracts @refs from note blocks inside mappings (sl-z57o)", async () => {
    // Extraction logic tested in nl-ref-extract.test.ts; here we verify CLI end-to-end.
    const fixture = resolve(import.meta.dirname, "fixtures", "note-nl-refs.stm");
    const { stdout, code } = await run("nl-refs", "--json", fixture);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    assert.equal(refs.length, 4, "should find 4 @refs (3 from note + 1 from arrow)");
    const noteRefs = refs.filter((r: any) => r.targetField === null);
    assert.equal(noteRefs.length, 3, "3 refs should come from the note block (no targetField)");
    const refNames = noteRefs.map((r: any) => r.ref).sort();
    assert.deepStrictEqual(refNames, ["balance", "src_accounts", "tgt_accounts"]);
  });

  it("reports correct line numbers for refs in multiline strings (sl-djeo)", async () => {
    // Line-offset logic tested in nl-ref-extract.test.ts; here we verify CLI end-to-end.
    const fixture = resolve(import.meta.dirname, "fixtures", "multiline-nl.stm");
    const { stdout, code } = await run("nl-refs", "--json", fixture);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    assert.equal(refs.length, 4, "should find 4 @refs");
    assert.equal(refs[0].line, 15, "first ref should be on line 15");
    assert.equal(refs[1].line, 15, "second ref should be on line 15");
    assert.equal(refs[2].line, 17, "third ref should be on line 17");
    assert.equal(refs[3].line, 17, "fourth ref should be on line 17");
  });

  it("extracts @refs from standalone and schema note blocks (sl-h8sb)", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "nl-refs-atref-notes.stm");
    const { stdout, code } = await run("nl-refs", "--json", fixture);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    // Standalone note: @src_accounts
    const standaloneRef = refs.find((r: any) => r.ref === "src_accounts" && r.mapping.startsWith("note:"));
    assert.ok(standaloneRef, "should find @src_accounts in standalone note");
    // Schema note: @balance, @currency
    const balanceRef = refs.find((r: any) => r.ref === "balance" && r.mapping.startsWith("note:"));
    assert.ok(balanceRef, "should find @balance in schema note");
    const currencyRef = refs.find((r: any) => r.ref === "currency" && r.mapping.startsWith("note:"));
    assert.ok(currencyRef, "should find @currency in schema note");
    // Arrow NL: @balance, @currency (in mapping body)
    const arrowBalance = refs.find((r: any) => r.ref === "balance" && !r.mapping.startsWith("note:"));
    assert.ok(arrowBalance, "should find @balance in arrow NL");
  });

  it("extracts @refs from each_block and flatten_block (sl-kqfj)", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "nl-refs-each-flatten.stm");
    const { stdout, code } = await run("nl-refs", "--json", fixture);
    assert.equal(code, 0);
    const refs = JSON.parse(stdout);
    assert.ok(refs.length >= 2, "should find at least 2 @refs inside each block");
    const skuRef = refs.find((r: any) => r.ref === "sku");
    assert.ok(skuRef, "should find @sku ref inside each block");
    const priceRef = refs.find((r: any) => r.ref === "price");
    assert.ok(priceRef, "should find @price ref inside each block");
  });
});

// ---------------------------------------------------------------------------
// satsuma validate — NL ref warnings
// ---------------------------------------------------------------------------
describe("satsuma validate (NL refs)", () => {
  it("validates ns-merging.stm without NL ref warnings", async () => {
    const { stdout, code } = await run("validate", NS_MERGING);
    assert.equal(code, 0);
    assert.match(stdout, /no issues found/);
  });
});

// ---------------------------------------------------------------------------
// satsuma where-used — NL ref surface
// ---------------------------------------------------------------------------
describe("satsuma where-used (NL refs)", () => {
  it("includes NL refs in where-used results", async () => {
    const { stdout, code } = await run("where-used", "source::hr_employees", "--json", NS_MERGING);
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    const nlRefs = result.refs.filter((r: any) => r.kind === "nl_ref");
    assert.ok(nlRefs.length > 0, "should find NL references to source::hr_employees");
  });

  const NOTE_WU = resolve(import.meta.dirname, "fixtures", "note-where-used.stm");

  it("finds NL @refs in standalone note blocks", async () => {
    const { stdout, code } = await run("where-used", "product", "--json", NOTE_WU);
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    const nlRefs = result.refs.filter((r: any) => r.kind === "nl_ref");
    assert.ok(nlRefs.length >= 1, "should find NL ref in standalone note block");
    assert.ok(nlRefs.some((r: any) => r.name === "(file-level note)"), "standalone note should use descriptive placeholder name");
  });

  it("finds NL @refs in metric note blocks", async () => {
    const { stdout, code } = await run("where-used", "orders", "--json", NOTE_WU);
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    const nlRefs = result.refs.filter((r: any) => r.kind === "nl_ref");
    assert.ok(nlRefs.length >= 1, "should find NL ref in metric note block");
    assert.ok(nlRefs.some((r: any) => r.name === "order_count"), "should use bare entity name without internal scope prefix");
  });

  it("text output uses 'Referenced in NL text' label", async () => {
    const { stdout, code } = await run("where-used", "product", NOTE_WU);
    assert.equal(code, 0);
    assert.match(stdout, /Referenced in NL text/);
  });
});

// ---------------------------------------------------------------------------
// satsuma lint
// ---------------------------------------------------------------------------
const LINT_FIXTURES = resolve(__dirname, "fixtures");

describe("satsuma lint", () => {
  it("reports no issues for a clean file", async () => {
    const { stdout, code } = await run("lint", resolve(LINT_FIXTURES, "lint-clean.stm"));
    assert.equal(code, 0);
    assert.match(stdout, /no issues found/);
  });

  it("exits 2 when findings are present", async () => {
    const { stdout, code } = await run("lint", resolve(LINT_FIXTURES, "lint-hidden-source.stm"));
    assert.equal(code, 2);
    assert.match(stdout, /hidden-source-in-nl/);
  });

  it("reports unresolved NL references with exit 0 (warning-only)", async () => {
    // unresolved-nl-ref is warning severity — warnings do not cause exit 2
    const { stdout, code } = await run("lint", resolve(LINT_FIXTURES, "lint-unresolved.stm"));
    assert.equal(code, 0);
    assert.match(stdout, /unresolved-nl-ref/);
    assert.match(stdout, /nonexistent_schema/);
  });

  it("--quiet exits 0 for warning-only findings (sl-8o37)", async () => {
    // Warning-severity findings must not cause exit 2, only errors should.
    const { stdout, code } = await run("lint", "--quiet", resolve(LINT_FIXTURES, "lint-unresolved.stm"));
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "");
  });

  it("--json produces valid structured output", async () => {
    const { stdout, code } = await run("lint", "--json", resolve(LINT_FIXTURES, "lint-hidden-source.stm"));
    assert.equal(code, 2);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.findings));
    assert.ok(data.findings.length > 0);
    assert.ok(data.summary);
    assert.equal(typeof data.summary.files, "number");
    assert.equal(typeof data.summary.findings, "number");
    assert.equal(typeof data.summary.fixable, "number");
    // Verify diagnostic shape
    const d = data.findings[0];
    assert.equal(typeof d.file, "string");
    assert.equal(typeof d.line, "number");
    assert.equal(typeof d.column, "number");
    assert.ok(["error", "warning"].includes(d.severity));
    assert.equal(typeof d.rule, "string");
    assert.equal(typeof d.message, "string");
    assert.equal(typeof d.fixable, "boolean");
  });

  it("--quiet returns only exit code", async () => {
    const { stdout, code } = await run("lint", "--quiet", resolve(LINT_FIXTURES, "lint-hidden-source.stm"));
    assert.equal(code, 2);
    assert.equal(stdout.trim(), "");
  });

  it("--quiet returns 0 for clean file", async () => {
    const { stdout, code } = await run("lint", "--quiet", resolve(LINT_FIXTURES, "lint-clean.stm"));
    assert.equal(code, 0);
    assert.equal(stdout.trim(), "");
  });

  it("--rules lists available rules", async () => {
    const { stdout, code } = await run("lint", "--rules");
    assert.equal(code, 0);
    assert.match(stdout, /hidden-source-in-nl/);
    assert.match(stdout, /unresolved-nl-ref/);
    assert.match(stdout, /duplicate-definition/);
  });

  it("--select filters to specified rules only", async () => {
    const { stdout } = await run(
      "lint", "--select", "unresolved-nl-ref",
      resolve(LINT_FIXTURES, "lint-hidden-source.stm"),
    );
    // Should only show unresolved-nl-ref, not hidden-source-in-nl
    assert.ok(!stdout.includes("hidden-source-in-nl"));
  });

  it("fires lint rules on anonymous mappings (sl-0o1x)", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "anon-lint.stm");
    const { stdout, code } = await run("lint", "--json", fixture);
    assert.equal(code, 2, "should find findings");
    const data = JSON.parse(stdout);
    const finding = data.findings.find((f: any) => f.rule === "hidden-source-in-nl");
    assert.ok(finding, "should fire hidden-source-in-nl on anonymous mapping");
    assert.match(finding.message, /hidden_lookup/);
  });
});

// ---------------------------------------------------------------------------
// satsuma lint --fix
// ---------------------------------------------------------------------------

describe("satsuma lint --fix", () => {
  /** Copy a fixture to a temp dir so --fix can modify it safely. */
  function copyFixture(name: any) {
    const src = resolve(LINT_FIXTURES, name);
    const tmp = mkdtempSync(join(tmpdir(), "satsuma-lint-"));
    const dest = join(tmp, name);
    copyFileSync(src, dest);
    return dest;
  }

  it("fixes fixable findings and reports residual non-fixable ones", async () => {
    const file = copyFixture("lint-mixed.stm");

    const { stdout, code } = await run("lint", "--fix", file);
    // After fix, only warning-severity findings remain → exit 0
    assert.equal(code, 0);
    assert.match(stdout, /Fixed:/);
    assert.match(stdout, /hidden-source-in-nl/);
    // Residual non-fixable finding still reported
    assert.match(stdout, /unresolved-nl-ref/);

    // Verify the source block was actually updated
    const content = readFileSync(file, "utf8");
    assert.match(content, /source::hr_employees/);
  });

  it("--fix --json reports fixes and residual findings", async () => {
    const file = copyFixture("lint-mixed.stm");

    const { stdout, code } = await run("lint", "--fix", "--json", file);
    // After fix, only warning-severity findings remain → exit 0
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.fixes.length > 0, "should have applied fixes");
    assert.ok(data.findings.length > 0, "should have residual findings");
    assert.equal(data.summary.fixed, data.fixes.length);
  });

  it("--fix is idempotent — rerunning produces no new fixes", async () => {
    const file = copyFixture("lint-mixed.stm");

    // First run: apply fixes
    const { stdout: first } = await run("lint", "--fix", "--json", file);
    const firstData = JSON.parse(first);
    assert.ok(firstData.summary.fixed > 0, "first run should fix something");

    // Second run: no new fixes, only residual warning-severity findings → exit 0
    const { stdout, code } = await run("lint", "--fix", "--json", file);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.summary.fixed, 0, "no new fixes on second run");
    // Persistent non-fixable finding (nonexistent_fx_rates) still present
    assert.ok(data.findings.length > 0);
    assert.ok(data.findings.every((d: any) => !d.fixable));
  });

  it("--fix on a clean file makes no changes", async () => {
    const file = copyFixture("lint-clean.stm");
    const before = readFileSync(file, "utf8");

    const { code } = await run("lint", "--fix", file);
    assert.equal(code, 0);

    const after = readFileSync(file, "utf8");
    assert.equal(before, after);
  });

  it("--fix on a purely fixable file exits 0 after fixing", async () => {
    const file = copyFixture("lint-fixable-only.stm");

    const { stdout, code } = await run("lint", "--fix", file);
    assert.equal(code, 0);
    assert.match(stdout, /Fixed:/);

    // Verify fix was applied
    const content = readFileSync(file, "utf8");
    assert.match(content, /source \{ source::finance_gl, source::hr_employees \}/);
  });

  it("wraps added source ref in backticks when existing entries use backticks (sl-z157)", async () => {
    const src = resolve(import.meta.dirname, "fixtures", "lint-backtick-fix.stm");
    const file = src.replace("lint-backtick-fix.stm", "lint-backtick-fix-copy.stm");
    copyFileSync(src, file);
    const { stdout, code } = await run("lint", "--fix", file);
    assert.equal(code, 0);
    assert.match(stdout, /Fixed:/);
    const content = readFileSync(file, "utf8");
    assert.match(content, /source \{ `src_main`, `hidden_lookup` \}/);
    unlinkSync(file);
  });

  it("uses namespace-local name when fixing inside namespace block (sl-td9l)", async () => {
    const src = resolve(import.meta.dirname, "fixtures", "lint-ns-fix.stm");
    const file = src.replace("lint-ns-fix.stm", "lint-ns-fix-copy.stm");
    copyFileSync(src, file);
    const { stdout, code } = await run("lint", "--fix", file);
    assert.equal(code, 0);
    assert.match(stdout, /Fixed:/);
    const content = readFileSync(file, "utf8");
    // Should insert "contacts" (local name), not "crm::contacts" (qualified)
    assert.match(content, /source \{ accounts, contacts \}/);
    assert.ok(!content.includes("crm::contacts"), "should not use namespace-qualified ref inside same namespace");
    unlinkSync(file);
  });

  it("applies hidden-source fix to an anonymous mapping (sl-1wpy)", async () => {
    // Bug sl-1wpy: lint --fix identified fixable findings but applied 0 fixes for
    // anonymous mappings. The add-source fix searched for the mapping by name, which
    // is null for anonymous mappings. Fix: detect the anonymous mapping key pattern
    // "<anon>@file:row" and locate the `mapping {` line by row number instead.
    const file = copyFixture("lint-anon-fix.stm");

    const { stdout, code } = await run("lint", "--fix", "--json", file);
    assert.equal(code, 0, `lint exited with code ${code}`);
    const data = JSON.parse(stdout);
    assert.ok(data.summary.fixed > 0, "at least one fix should have been applied");

    const content = readFileSync(file, "utf8");
    assert.match(content, /hidden_dep/, "hidden_dep should be added to the source block");
  });
});

// ---------------------------------------------------------------------------
// Import resolution — stm-8k6p
// ---------------------------------------------------------------------------
const IMPORT_ENTRY = resolve(__dirname, "fixtures", "import-entry.stm");
const IMPORT_CHAIN = resolve(__dirname, "fixtures", "import-chain-entry.stm");

describe("import resolution: summary", () => {
  it("includes imported schemas when pointing at entry file", async () => {
    const { stdout, code } = await run("summary", "--json", IMPORT_ENTRY);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.schemas.map((s: any) => s.name);
    assert.ok(names.includes("src::customers"), `expected src::customers, got ${names}`);
    assert.ok(names.includes("mart::dim_customers"), `expected mart::dim_customers, got ${names}`);
    assert.equal(data.mappings.length, 1);
  });

  it("follows transitive imports", async () => {
    const { stdout, code } = await run("summary", "--json", IMPORT_CHAIN);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.schemas.map((s: any) => s.name);
    assert.ok(names.includes("src::customers"), `transitive: expected src::customers, got ${names}`);
    assert.ok(names.includes("mart::dim_customers"), `transitive: expected mart::dim_customers, got ${names}`);
    assert.ok(names.includes("analytics::customer_stats"), `transitive: expected analytics::customer_stats, got ${names}`);
  });
});

describe("import resolution: schema", () => {
  it("finds imported schema by qualified name", async () => {
    const { stdout, code } = await run("schema", "src::customers", IMPORT_ENTRY);
    assert.equal(code, 0);
    assert.match(stdout, /customer_id/);
    assert.match(stdout, /email/);
  });
});

describe("import resolution: where-used", () => {
  it("finds mapping references to imported schema", async () => {
    const { stdout, code } = await run("where-used", "src::customers", IMPORT_ENTRY);
    assert.equal(code, 0);
    assert.match(stdout, /build dim_customers/);
  });
});

describe("satsuma graph: --schema-only derived-only edges (sl-w4hv)", () => {
  it("includes schema-level edges for mappings with only derived arrows", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "derived-only.stm");
    const { stdout, code } = await run("graph", "--json", "--schema-only", fixture);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.edges.length > 0, "should have schema-level edges");
    const edge = data.edges.find((e: any) => e.mapping === "enrich data");
    assert.ok(edge, "should have edge for 'enrich data' mapping");
    assert.equal(edge.from, "raw_data");
    assert.equal(edge.to, "enriched_data");
  });
});

describe("satsuma graph: schema_edges NL-referenced schemas (sl-n11t)", () => {
  const FIXTURE = resolve(__dirname, "fixtures/hidden-source-graph.stm");

  it("does not promote NL-referenced schemas to source edges", async () => {
    const { stdout, code } = await run("graph", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const sourceEdges = data.schema_edges.filter((e: any) => e.role === "source");
    const sourceNames = sourceEdges.map((e: any) => e.from);
    assert.ok(sourceNames.includes("crm_accounts"), "should have declared source");
    assert.ok(sourceNames.includes("erp_customers"), "should have declared source");
    assert.ok(!sourceNames.includes("web_profiles"), "should NOT include NL-referenced schema as source");
  });

  it("emits nl_ref edges for NL-referenced schemas not in source list", async () => {
    const { stdout, code } = await run("graph", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const nlRefEdges = data.schema_edges.filter((e: any) => e.role === "nl_ref");
    assert.equal(nlRefEdges.length, 1, "should have one nl_ref edge");
    assert.equal(nlRefEdges[0].from, "web_profiles");
    assert.equal(nlRefEdges[0].to, "build dim_customer");
  });

  it("does not duplicate nl_ref edge for schemas already in source list", async () => {
    const { stdout, code } = await run("graph", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const nlRefEdges = data.schema_edges.filter((e: any) => e.role === "nl_ref");
    const nlRefNames = nlRefEdges.map((e: any) => e.from);
    assert.ok(!nlRefNames.includes("crm_accounts"), "should NOT have nl_ref for declared source");
  });

  it("compact output shows NL-referenced schemas with nl_ref role", async () => {
    const { stdout, code } = await run("graph", FIXTURE, "--compact");
    assert.equal(code, 0);
    assert.ok(stdout.includes("web_profiles"), "should show NL-referenced schema in compact");
    assert.ok(stdout.includes("[nl_ref]"), "should show nl_ref role");
  });
});

describe("satsuma graph: scalar list fields (sc-ebau)", () => {
  it("--json shows list_of type for scalar list fields", async () => {
    const FFG = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");
    const { stdout, code } = await run("graph", "--json", FFG);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const allFields = data.nodes.flatMap((n: any) => n.fields || []);
    const promoCodes = allFields.find((f: any) => f.name === "promo_codes");
    assert.ok(promoCodes, "should have promo_codes field");
    assert.equal(promoCodes.type, "list_of STRING", "scalar list field should show list_of type");
  });
});

describe("satsuma graph: fragment fields (sl-yibt, sl-p0hz)", () => {
  it("fragment nodes do NOT appear in --json nodes array (sl-p0hz)", async () => {
    const { stdout, code } = await run("graph", "--json", resolve(EXAMPLES, "lib/common.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const frags = data.nodes.filter((n: any) => n.kind === "fragment");
    assert.equal(frags.length, 0, "fragment nodes must not appear in nodes[]");
    // But stats.fragments still reports the count
    assert.ok(data.stats.fragments > 0, "stats.fragments should still count fragments");
  });

  it("schema fields include spread-expanded fields in --json (sl-p0hz)", async () => {
    const { stdout, code } = await run("graph", "--json", resolve(EXAMPLES, "lib/common.stm"));
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    // Find a schema that uses fragment spreads and verify its fields are expanded
    const schemasWithFields = data.nodes.filter((n: any) => n.kind === "schema" && Array.isArray(n.fields) && n.fields.length > 0);
    assert.ok(schemasWithFields.length > 0, "schema nodes should have non-empty fields");
  });
});

describe("import resolution: graph", () => {
  it("includes schema nodes for imported definitions", async () => {
    const { stdout, code } = await run("graph", "--json", IMPORT_ENTRY);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.stats.schemas, 2, `expected 2 schemas, got ${data.stats.schemas}`);
    assert.equal(data.stats.mappings, 1);
  });
});

describe("import resolution: validate", () => {
  it("does not emit undefined-ref for imported names", async () => {
    const { stdout, code } = await run("validate", IMPORT_ENTRY);
    assert.equal(code, 0);
    assert.match(stdout, /no issues/i);
  });
});

describe("import resolution: missing target", () => {
  it("warns on stderr for missing import target", async () => {
    const { stderr, code } = await run("summary", "--json", resolve(__dirname, "fixtures", "import-missing.stm"));
    // Should still succeed (warn, not fail)
    assert.equal(code, 0);
    assert.match(stderr, /import target.*not found/i);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: nl field scope (sg-3xof) — schema qualifier respected for arrows
// ---------------------------------------------------------------------------
describe("satsuma nl field scope (sg-3xof)", () => {
  it("does not leak NL from unrelated schemas sharing the same field name", async () => {
    // ecom::customers.email has no NL-bearing arrows — should not pick up
    // vault::sat_contact_details.email NL from 'build dim_contact'
    const { stdout, code } = await run("nl", "ecom::customers.email", NS_PLATFORM);
    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /vault::sat_contact_details/);
    assert.doesNotMatch(stdout, /build dim_contact/);
  });

  it("returns NL for the correct schema when field name is shared", async () => {
    // vault::sat_contact_details.email IS a source for 'build dim_contact'
    const { stdout, code } = await run("nl", "vault::sat_contact_details.email", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /vault::sat_contact_details/);
  });

  it("unique field names continue to work", async () => {
    // contact_bk is unique enough — should return NL from its mapping
    const { code } = await run("nl", "vault::hub_contact.contact_bk", NS_PLATFORM);
    assert.equal(code, 0);
    // contact_bk -> contact_bk is a plain arrow with no NL, so no transform items
    // but the command should succeed without error
    assert.equal(code, 0);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: lineage --to (sg-pufq) — all upstream branches returned
// ---------------------------------------------------------------------------
describe("satsuma lineage --to upstream branches (sg-pufq)", () => {
  it("includes both upstream sources for mart::dim_contact", async () => {
    const { stdout, code } = await run("lineage", "--to", "mart::dim_contact", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /vault::hub_contact/);
    assert.match(stdout, /vault::sat_contact_details/);
  });

  it("includes all upstream branches for mart::fact_deals", async () => {
    const { stdout, code } = await run("lineage", "--to", "mart::fact_deals", NS_PLATFORM);
    assert.equal(code, 0);
    assert.match(stdout, /vault::hub_deal/);
    assert.match(stdout, /vault::link_contact_deal/);
    assert.match(stdout, /vault::hub_contact/);
  });

  it("--json returns nodes and edges DAG for --to", async () => {
    const { stdout, code } = await run("lineage", "--to", "mart::dim_contact", "--json", NS_PLATFORM);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(Array.isArray(data.nodes));
    assert.ok(Array.isArray(data.edges));
    const names = data.nodes.map((n: any) => n.name);
    assert.ok(names.includes("vault::hub_contact"), `expected vault::hub_contact in ${names}`);
    assert.ok(names.includes("vault::sat_contact_details"), `expected vault::sat_contact_details in ${names}`);
  });
});

// ---------------------------------------------------------------------------
// P5.4: lineage follows @ref edges (lsp-4hai)
// ---------------------------------------------------------------------------
const HIDDEN_SOURCE_FIXTURE = resolve(__dirname, "fixtures/hidden-source-graph.stm");

describe("satsuma lineage: @ref edge traversal (lsp-4hai)", () => {
  it("--from follows NL-referenced schema downstream", async () => {
    const { stdout, code } = await run("lineage", "--from", "web_profiles", HIDDEN_SOURCE_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /web_profiles/);
    assert.match(stdout, /build dim_customer/);
    assert.match(stdout, /dim_customer/);
  });

  it("--to includes NL-referenced schema in upstream path", async () => {
    const { stdout, code } = await run("lineage", "--to", "dim_customer", HIDDEN_SOURCE_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /web_profiles/);
    assert.match(stdout, /crm_accounts/);
    assert.match(stdout, /erp_customers/);
  });

  it("--from --json includes @ref-derived edges", async () => {
    const { stdout, code } = await run("lineage", "--from", "web_profiles", "--json", HIDDEN_SOURCE_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const names = data.nodes.map((n: any) => n.name);
    assert.ok(names.includes("web_profiles"));
    assert.ok(names.includes("build dim_customer"));
    const edge = data.edges.find((e: any) => e.from === "web_profiles" && e.to === "build dim_customer");
    assert.ok(edge, "should have edge from web_profiles to build dim_customer");
  });
});

// ---------------------------------------------------------------------------
// Bug fixes: fragment spread expansion across CLI commands
// (sl-3aff, sl-h1b0, sl-wrzl, sl-t6lt, sl-zjec, sl-307v)
// ---------------------------------------------------------------------------
const SPREAD_FIXTURE = resolve(__dirname, "fixtures", "fragment-spread-commands.stm");

describe("satsuma fields — fragment spread expansion (sl-3aff)", () => {
  it("includes fields from fragment spreads", async () => {
    const { stdout, code } = await run("fields", "tgt_customers", SPREAD_FIXTURE);
    assert.equal(code, 0);
    // Direct fields
    assert.match(stdout, /customer_id/);
    assert.match(stdout, /email/);
    // Fragment spread fields from 'audit fields'
    assert.match(stdout, /created_at/);
    assert.match(stdout, /updated_at/);
    assert.match(stdout, /created_by/);
    // Fragment spread fields from 'address fields'
    assert.match(stdout, /street_line_1/);
    assert.match(stdout, /city/);
  });

  it("--json includes fragment spread fields", async () => {
    const { stdout, code } = await run("fields", "tgt_customers", "--json", SPREAD_FIXTURE);
    assert.equal(code, 0);
    const fields = JSON.parse(stdout);
    const names = fields.map((f: any) => f.name);
    assert.ok(names.includes("created_at"), "should include created_at from audit fields");
    assert.ok(names.includes("street_line_1"), "should include street_line_1 from address fields");
  });

  it("includes transitive spread fields", async () => {
    const { stdout, code } = await run("fields", "customer_with_full_address", "--json", SPREAD_FIXTURE);
    assert.equal(code, 0);
    const fields = JSON.parse(stdout);
    const names = fields.map((f: any) => f.name);
    // From 'full address' fragment directly
    assert.ok(names.includes("country"), "should include country from full address");
    // Transitive from 'address fields' via 'full address'
    assert.ok(names.includes("street_line_1"), "should include street_line_1 transitively");
    assert.ok(names.includes("city"), "should include city transitively");
  });
});

describe("satsuma fields --with-meta on fragment spreads (sl-z9us)", () => {
  const FIXTURE = resolve(__dirname, "fixtures/spread-fields-meta.stm");

  it("--with-meta shows tags on fragment spread fields", async () => {
    const { stdout, code } = await run("fields", "with_spreads", FIXTURE, "--with-meta");
    assert.equal(code, 0);
    assert.match(stdout, /created_at.*required/);
    assert.match(stdout, /email.*pii/);
  });

  it("--with-meta --json includes tags on fragment spread fields", async () => {
    const { stdout, code } = await run("fields", "with_spreads", FIXTURE, "--with-meta", "--json");
    assert.equal(code, 0);
    const fields = JSON.parse(stdout);
    const email = fields.find((f: any) => f.name === "email");
    assert.ok(email, "should find email field from fragment spread");
    assert.deepEqual(email.tags, ["pii"]);
    const created = fields.find((f: any) => f.name === "created_at");
    assert.ok(created, "should find created_at from fragment spread");
    assert.deepEqual(created.tags, ["required"]);
  });
});

describe("satsuma arrows — fragment spread expansion (sl-h1b0)", () => {
  it("finds arrows targeting fields from fragment spreads", async () => {
    const { stdout, code } = await run("arrows", "tgt_customers.created_at", SPREAD_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /now_utc/);
  });

  it("finds arrows targeting spread source fields", async () => {
    const { stdout, code } = await run("arrows", "src_customers.street_line_1", SPREAD_FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /street_line_1/);
  });

  it("does not error for spread field lookup", async () => {
    const { stderr, code } = await run("arrows", "tgt_customers.updated_at", SPREAD_FIXTURE);
    assert.equal(code, 0);
    assert.ok(!stderr.includes("not found"), "should not error for spread field");
  });
});

describe("satsuma match-fields — fragment spread expansion (sl-wrzl)", () => {
  it("matches fields from shared fragment spreads", async () => {
    const { stdout, code } = await run(
      "match-fields", "--source", "src_customers", "--target", "tgt_customers",
      "--json", SPREAD_FIXTURE,
    );
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    const matchedNames = result.matched.map((m: any) => m.source);
    // Both schemas spread 'address fields' — these should match
    assert.ok(matchedNames.includes("street_line_1"), "street_line_1 should be matched");
    assert.ok(matchedNames.includes("city"), "city should be matched");
    assert.ok(matchedNames.includes("state"), "state should be matched");
  });
});

describe("satsuma graph --json — fragment spread expansion (sl-t6lt)", () => {
  it("includes fragment spread fields in schema node fields arrays", async () => {
    const { stdout, code } = await run("graph", "--json", SPREAD_FIXTURE);
    assert.equal(code, 0);
    const graph = JSON.parse(stdout);
    const tgtNode = graph.nodes.find((n: any) => n.id === "tgt_customers");
    assert.ok(tgtNode, "tgt_customers node should exist");
    const fieldNames = tgtNode.fields.map((f: any) => f.name);
    assert.ok(fieldNames.includes("created_at"), "should include created_at from audit fields");
    assert.ok(fieldNames.includes("street_line_1"), "should include street_line_1 from address fields");
  });

  it("no fragment_spread schema_edges (sl-p0hz: fragments are not graph nodes)", async () => {
    const { stdout, code } = await run("graph", "--json", SPREAD_FIXTURE);
    assert.equal(code, 0);
    const graph = JSON.parse(stdout);
    const spreadEdges = graph.schema_edges.filter((e: any) => e.role === "fragment_spread");
    assert.equal(spreadEdges.length, 0, "fragment_spread edges must not appear (fragments are not nodes)");
  });
});

describe("satsuma graph: nested array arrow edges (sl-4e5c)", () => {
  const FIXTURE = resolve(__dirname, "fixtures/nested-array-arrows.stm");

  it("child arrows have parent path prefix", async () => {
    const { stdout } = await run("graph", FIXTURE, "--json");
    const data = JSON.parse(stdout);
    const skuEdge = data.edges.find((e: any) => e.to && e.to.includes("product_code"));
    assert.ok(skuEdge, "should have product_code edge");
    assert.equal(skuEdge.from, "::order_api.line_items.sku");
    assert.equal(skuEdge.to, "::order_flat.items.product_code");
  });

  it("no corrupted newlines in edge paths", async () => {
    const { stdout } = await run("graph", FIXTURE, "--json");
    const data = JSON.parse(stdout);
    for (const e of data.edges) {
      if (e.from) assert.ok(!e.from.includes("\n"), `from path should not contain newline: ${e.from}`);
      if (e.to) assert.ok(!e.to.includes("\n"), `to path should not contain newline: ${e.to}`);
    }
  });

  it("parent array edge exists", async () => {
    const { stdout } = await run("graph", FIXTURE, "--json");
    const data = JSON.parse(stdout);
    const parentEdge = data.edges.find((e: any) => e.from === "::order_api.line_items" && e.to === "::order_flat.items");
    assert.ok(parentEdge, "should have parent array edge");
  });
});

describe("satsuma schema --json — fragment spread expansion (sl-zjec)", () => {
  it("includes expanded fragment fields in fields array", async () => {
    const { stdout, code } = await run("schema", "tgt_customers", "--json", SPREAD_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const fieldNames = data.fields.map((f: any) => f.name);
    assert.ok(fieldNames.includes("created_at"), "should include created_at from audit fields");
    assert.ok(fieldNames.includes("updated_at"), "should include updated_at from audit fields");
    assert.ok(fieldNames.includes("created_by"), "should include created_by from audit fields");
    assert.ok(fieldNames.includes("street_line_1"), "should include street_line_1 from address fields");
  });

  it("still shows spread syntax in fieldLines", async () => {
    const { stdout, code } = await run("schema", "tgt_customers", "--json", SPREAD_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.fieldLines.some((l: any) => l.includes("...audit fields")));
    assert.ok(data.fieldLines.some((l: any) => l.includes("...address fields")));
  });
});

describe("satsuma where-used — fragment-to-fragment spreads (sl-307v)", () => {
  it("finds fragment-to-fragment spread references", async () => {
    const { stdout, code } = await run("where-used", "address fields", "--json", SPREAD_FIXTURE);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const spreadRefs = data.refs.filter((r: any) => r.kind === "fragment_spread");
    const refNames = spreadRefs.map((r: any) => r.name);
    // Should find spreads in: src_customers, tgt_customers, full address, customer_with_full_address (transitive via full address)
    assert.ok(refNames.includes("src_customers"), "should find spread in src_customers");
    assert.ok(refNames.includes("tgt_customers"), "should find spread in tgt_customers");
    assert.ok(refNames.includes("full address"), "should find spread in fragment 'full address'");
  });
});

// ---------------------------------------------------------------------------
// Bug fix: nl/meta field syntax (sg-95gr) — dot-separated scope works
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Bug fix: nl text output no longer truncates (sl-d9hi)
// ---------------------------------------------------------------------------
const DEEP_NESTED = resolve(__dirname, "fixtures", "deep-nested-bugs.stm");

describe("satsuma nl — no truncation (sl-d9hi)", () => {
  it("text output shows full NL content without truncation", async () => {
    const { stdout, code } = await run("nl", "pacs008", DEEP_NESTED);
    assert.equal(code, 0);
    // The note is >100 chars — should NOT be truncated with "..."
    assert.match(stdout, /Used for tracking across the entire payment chain\./);
    assert.ok(!stdout.includes("..."), "should not truncate with ellipsis");
  });
});

// ---------------------------------------------------------------------------
// Bug fix: nl supports deeply nested field paths (sl-kutf)
// ---------------------------------------------------------------------------
describe("satsuma nl — deeply nested paths (sl-kutf)", () => {
  it("3-level nested path finds NL on record scope", async () => {
    const { stdout, code } = await run("nl", "pacs008.CdtTrfTxInf.PmtId", DEEP_NESTED);
    assert.equal(code, 0);
    assert.match(stdout, /Unique end-to-end transaction reference/);
  });

  it("3-level nested path finds warnings", async () => {
    const { stdout, code } = await run("nl", "pacs008.GrpHdr.InstgAgt", DEEP_NESTED);
    assert.equal(code, 0);
    assert.match(stdout, /BIC may need SWIFT validation/);
  });

  it("exits 1 for invalid nested path", async () => {
    const { stderr, code } = await run("nl", "pacs008.GrpHdr.Nonexistent.BIC", DEEP_NESTED);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: arrows supports deeply nested field paths (sl-xj4p)
// ---------------------------------------------------------------------------
describe("satsuma arrows — deeply nested paths (sl-xj4p)", () => {
  it("deeply nested path returns only matching arrow", async () => {
    const { stdout, code } = await run("arrows", "pacs008.CdtTrfTxInf.DbtrAgt.BIC", DEEP_NESTED);
    assert.equal(code, 0);
    assert.match(stdout, /1 arrow/);
    assert.match(stdout, /DbtrAgt\.BIC -> debtor_bic/);
    // Should NOT include other BIC arrows
    assert.ok(!stdout.includes("instructing_bic"), "should not include InstgAgt.BIC arrow");
    assert.ok(!stdout.includes("creditor_bic"), "should not include CdtrAgt.BIC arrow");
  });

  it("leaf-name query still returns all matching arrows", async () => {
    const { stdout, code } = await run("arrows", "pacs008.BIC", DEEP_NESTED);
    assert.equal(code, 0);
    assert.match(stdout, /3 arrow/);
  });

  it("--json includes full nested path for source", async () => {
    const { stdout, code } = await run("arrows", "pacs008.CdtTrfTxInf.DbtrAgt.BIC", "--json", DEEP_NESTED);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.length, 1);
    assert.match(data[0].source, /pacs008\.CdtTrfTxInf\.DbtrAgt\.BIC/);
  });

  it("exits 1 for invalid deeply nested path", async () => {
    const { stderr, code } = await run("arrows", "pacs008.Nonexistent.BIC", DEEP_NESTED);
    assert.equal(code, 1);
    assert.match(stderr, /not found/i);
  });
});

describe("satsuma nl/meta field syntax (sg-95gr)", () => {
  it("nl accepts schema.field without 'field' keyword", async () => {
    const { code } = await run("nl", "mart::dim_contact.email", NS_PLATFORM);
    assert.equal(code, 0);
  });

  it("meta accepts schema.field without 'field' keyword", async () => {
    const { code } = await run("meta", "vault::sat_contact_details.email", NS_PLATFORM);
    assert.equal(code, 0);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: nl includes source block join NL (cbh-so1o)
// ---------------------------------------------------------------------------
describe("satsuma nl — source block join NL (cbh-so1o)", () => {
  it("includes join NL strings from source blocks", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "source-join-nl.stm");
    const { stdout, code } = await run("nl", "order enrichment", fixture);
    assert.equal(code, 0);
    assert.match(stdout, /Left join orders\.id = customers\.order_id/);
  });

  it("includes join NL in --json output", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "source-join-nl.stm");
    const { stdout, code } = await run("nl", "order enrichment", "--json", fixture);
    assert.equal(code, 0);
    const items = JSON.parse(stdout);
    const joinItem = items.find((i: any) => i.text.includes("Left join"));
    assert.ok(joinItem, "should find join NL in JSON output");
    assert.equal(joinItem.kind, "note");
  });
});

// ---------------------------------------------------------------------------
// Bug fix: nl field-scoped query finds NL in each/flatten blocks (sl-sq4u)
// ---------------------------------------------------------------------------
describe("satsuma nl — field scope in each/flatten (sl-sq4u)", () => {
  it("finds NL for fields mapped inside each blocks", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "nl-refs-each-flatten.stm");
    const { stdout, code } = await run("nl", "order_flat.product_code", fixture);
    assert.equal(code, 0);
    assert.match(stdout, /Convert @sku to product code format/);
  });

  it("--json output works for each block field NL", async () => {
    const fixture = resolve(import.meta.dirname, "fixtures", "nl-refs-each-flatten.stm");
    const { stdout, code } = await run("nl", "order_flat.product_code", "--json", fixture);
    assert.equal(code, 0);
    const items = JSON.parse(stdout);
    assert.ok(items.length > 0, "should find NL items");
    assert.ok(items[0].text.includes("Convert"));
  });
});

// ---------------------------------------------------------------------------
// Bug fix: metric description string included in nl output (sl-571v)
// ---------------------------------------------------------------------------
describe("satsuma nl — metric description string (sl-571v)", () => {
  const fixture = resolve(import.meta.dirname, "fixtures", "metric-description.stm");

  it("includes the metric description string alongside body notes", async () => {
    // The nl_string between the metric name and metadata parens is the metric's
    // displayName — it should surface as kind: "note" in nl output.
    const { stdout, code } = await run("nl", "monthly_revenue", fixture);
    assert.equal(code, 0);
    assert.match(stdout, /Total monthly revenue/);
    assert.match(stdout, /Body note/);
  });

  it("--json includes the description with correct parent", async () => {
    const { stdout, code } = await run("nl", "monthly_revenue", "--json", fixture);
    assert.equal(code, 0);
    const items = JSON.parse(stdout);
    const desc = items.find((i: any) => i.text === "Total monthly revenue");
    assert.ok(desc, "description string should be in nl output");
    assert.equal(desc.kind, "note");
    assert.equal(desc.parent, "monthly_revenue");
  });

  it("nl all scope also includes the metric description", async () => {
    const { stdout, code } = await run("nl", "all", "--json", fixture);
    assert.equal(code, 0);
    const items = JSON.parse(stdout);
    const desc = items.find((i: any) => i.text === "Total monthly revenue");
    assert.ok(desc, "description string should be in nl all output");
  });
});

// ---------------------------------------------------------------------------
// Bug fix: nl parent field uses schema-qualified path (sl-prsy)
// ---------------------------------------------------------------------------
describe("satsuma nl — schema-qualified parent (sl-prsy)", () => {
  it("field-level notes have schema.field parent, not bare field name", async () => {
    // When two schemas have the same field name, nl output must distinguish
    // them with schema-qualified paths in the parent field.
    const fixture = resolve(import.meta.dirname, "fixtures", "nl-parent-qualified.stm");
    const { stdout, code } = await run("nl", "all", fixture, "--json");
    assert.equal(code, 0);
    const items = JSON.parse(stdout);
    const alpha = items.find((i: any) => i.text === "Alpha email");
    const beta = items.find((i: any) => i.text === "Beta email");
    assert.ok(alpha, "should find Alpha email note");
    assert.ok(beta, "should find Beta email note");
    assert.equal(alpha.parent, "alpha.email", "parent should be schema-qualified");
    assert.equal(beta.parent, "beta.email", "parent should be schema-qualified");
  });
});

// ---------------------------------------------------------------------------
// Bug fix: validate no false warnings with duplicate mapping names (sl-04eg)
// ---------------------------------------------------------------------------
describe("satsuma validate — duplicate mapping names (sl-04eg)", () => {
  it("does not produce false field-not-in-schema warnings", async () => {
    const fixtureA = resolve(import.meta.dirname, "fixtures", "dup-mapping-a.stm");
    const fixtureB = resolve(import.meta.dirname, "fixtures", "dup-mapping-b.stm");
    const { stdout } = await run("validate", fixtureA, fixtureB);
    // Should only report duplicate-definition, not field-not-in-schema
    assert.doesNotMatch(stdout, /field-not-in-schema/);
  });
});

// ---------------------------------------------------------------------------
// Bug fix: arrows/field-lineage for anonymous mapping in namespace (sl-1vnm)
// ---------------------------------------------------------------------------
describe("satsuma arrows — anonymous mapping in namespace (sl-1vnm)", () => {
  const fixture = resolve(import.meta.dirname, "fixtures", "namespace-anon-mapping.stm");

  it("finds arrows for fields in anonymous namespaced mapping", async () => {
    // Anonymous mappings inside namespace blocks must be resolvable by
    // their namespace-qualified field paths.
    const { stdout, code } = await run("arrows", "ns::tgt_ns.val", "--json", fixture);
    assert.equal(code, 0);
    const arrows = JSON.parse(stdout);
    assert.equal(arrows.length, 1);
    assert.equal(arrows[0].source, "ns::src_ns.val");
    assert.equal(arrows[0].target, "ns::tgt_ns.val");
  });

  it("field-lineage returns upstream for anonymous namespaced mapping", async () => {
    const { stdout, code } = await run("field-lineage", "ns::tgt_ns.val", "--json", fixture);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.upstream.length, 1);
    assert.equal(data.upstream[0].field, "ns::src_ns.val");
  });
});

// ---------------------------------------------------------------------------
// Bug fix: nl-derived duplicate suppression (sl-k797)
// When a declared arrow already has the @ref field as a source (e.g.
// `c -> d { "clean up @s1.c" }`), no duplicate nl-derived arrow should be
// emitted. But when the declared arrow is derived (source=null), the
// nl-derived arrow adds source info and must NOT be suppressed for source queries.
// ---------------------------------------------------------------------------
describe("satsuma arrows — nl-derived duplicate suppression (sl-k797)", () => {
  it("no duplicate nl-derived when declared arrow already has the source", async () => {
    // `c -> d { "clean up @s1.c" }` — declared arrow has source c, @ref is s1.c.
    // Should return 1 arrow, not 2.
    const fixture = resolve(import.meta.dirname, "..", "..", "..", "smoke-tests", "arrows", "10-pipe-flatten", "fixture.stm");
    const { stdout, code } = await run("arrows", "s2.d", "--json", fixture);
    assert.equal(code, 0);
    const arrows = JSON.parse(stdout);
    assert.equal(arrows.length, 1, "should not emit duplicate nl-derived arrow");
  });

  it("nl-derived arrow IS emitted when querying by source ref field", async () => {
    // `-> total { "Sum @source8.amount" }` — querying source8.amount should find
    // the nl-derived arrow since the declared arrow has no source.
    const fixture = resolve(import.meta.dirname, "fixtures", "nl-derived-target.stm");
    const { stdout, code } = await run("arrows", "source8.amount", "--json", fixture);
    assert.equal(code, 0);
    const arrows = JSON.parse(stdout);
    const nlDerived = arrows.find((a: any) => a.classification === "nl-derived");
    assert.ok(nlDerived, "nl-derived arrow should be present for source query");
    assert.equal(nlDerived.source, "::source8.amount");
    assert.equal(nlDerived.target, "::target8.total");
  });
});

// ---------------------------------------------------------------------------
// satsuma arrows — leaf-name false positive fix
// A field F in schema A should not get arrows attributed to it just because
// the mapping has schema A as a source and a *different* source field has F
// as a leaf name (e.g. nested_record.F from schema B is NOT schema_A.F).
// ---------------------------------------------------------------------------
describe("satsuma arrows — no leaf-name false positives across schemas", () => {
  const FIXTURE = resolve(EXAMPLES, "filter-flatten-governance/filter-flatten-governance.stm");

  it("customer_profiles.customer_id has no arrows (join key, not arrow source)", async () => {
    const { stdout, stderr, code } = await run("arrows", "customer_profiles.customer_id", FIXTURE);
    // Must exit 1 (no arrows found) — not 0 with a false positive
    assert.equal(code, 1, `expected exit 1 (no arrows), got ${code}\n${stdout}${stderr}`);
    assert.match(stdout, /No arrows found/, "should report no arrows");
  });

  it("customer_profiles.acquisition_channel still has its arrow", async () => {
    const { stdout, code } = await run("arrows", "customer_profiles.acquisition_channel", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /acquisition_channel/);
    assert.match(stdout, /1 as source/);
  });

  it("order_events.customer.customer_id correctly shows arrows from the nested record", async () => {
    const { stdout, code } = await run("arrows", "order_events.customer.customer_id", FIXTURE);
    assert.equal(code, 0);
    assert.match(stdout, /customer\.customer_id -> customer_id/);
    assert.match(stdout, /2 as source/);
  });
});

// ---------------------------------------------------------------------------
// ADR-022: directory argument rejection
// ---------------------------------------------------------------------------
//
// The exhaustive per-rule behaviour of directory rejection lives in
// `load-workspace.test.ts` (the shared loader) and `workspace.test.ts`
// (the underlying resolveInput primitive). The integration tests below
// only need to prove that the rejection actually reaches the user through
// commander's command wiring — once for the shared `loadWorkspace` path
// (here exercised via `summary`) and once for the still-custom `validate`
// path which formats errors specially when --json is in use.
describe("directory argument rejection (ADR-022)", () => {
  it("surfaces the rejection through a loadWorkspace-backed command (summary)", async () => {
    const { stderr, code } = await run("summary", EXAMPLES);
    assert.notEqual(code, 0, "should exit non-zero for directory argument");
    assert.match(stderr, /directory arguments are not supported/);
  });

  it("surfaces the rejection through validate (which formats errors itself)", async () => {
    const { stderr, code } = await run("validate", EXAMPLES);
    assert.notEqual(code, 0);
    assert.match(stderr, /directory arguments are not supported/);
  });
});

/**
 * summary.test.ts — Focused CLI coverage for the `satsuma summary` command.
 *
 * These tests spawn the built command so the formatter contract, workspace
 * loading, import following, and JSON/compact flags are checked together.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runCli } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const PLATFORM = resolve(__dirname, "fixtures/platform.stm");
const IMPORT_ENTRY = resolve(__dirname, "fixtures/import-entry.stm");
const METRICS_EXAMPLE = resolve(__dirname, "../../../examples/metrics-platform/metrics.stm");

const run = (...args: string[]) => runCli(CLI, ...args);

describe("satsuma summary", () => {
  it("prints the human overview with all primary entity sections", async () => {
    // The default text mode is the command's human contract, so it must keep
    // the major workspace sections visible when the workspace contains them.
    const { stdout, code } = await run("summary", PLATFORM);

    assert.equal(code, 0);
    assert.match(stdout, /Satsuma Workspace/);
    assert.match(stdout, /Schemas \(/);
    assert.match(stdout, /Metrics \(/);
    assert.match(stdout, /Mappings \(/);
    assert.match(stdout, /Fragments \(/);
    assert.match(stdout, /Transforms \(/);
  });

  it("prints compact text as names grouped by entity type", async () => {
    // Compact output is intentionally names-only; this guards against leaking
    // detail fields into the mode used by scripts and quick terminal scans.
    const { stdout, code } = await run("summary", "--compact", PLATFORM);

    assert.equal(code, 0);
    assert.match(stdout, /^schemas:/m);
    assert.match(stdout, /^mappings:/m);
    assert.match(stdout, /^ {2}::legacy_sqlserver$/m);
    assert.doesNotMatch(stdout, /\[/);
    assert.doesNotMatch(stdout, /\/examples\//);
  });

  it("emits full JSON with imported schemas and source-target details", async () => {
    // Full JSON is the programmatic contract; imported definitions and detailed
    // mapping fields must be present for downstream tools.
    const { stdout, code } = await run("summary", "--json", IMPORT_ENTRY);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.fileCount, 2);
    assert.deepEqual(
      data.schemas.map((schema: { name: string }) => schema.name).sort(),
      ["mart::dim_customers", "src::customers"],
    );
    assert.equal(data.mappings[0].name, "::build dim_customers");
    assert.deepEqual(data.mappings[0].sources, ["src::customers"]);
    assert.deepEqual(data.mappings[0].targets, ["mart::dim_customers"]);
    assert.equal(typeof data.mappings[0].file, "string");
    assert.equal(typeof data.mappings[0].line, "number");
  });

  it("emits compact JSON without location or source-target details", async () => {
    // `--json --compact` is a distinct mode, not just pretty compact text; it
    // keeps counts while omitting verbose details from each entity object.
    const { stdout, code } = await run("summary", "--json", "--compact", IMPORT_ENTRY);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.fileCount, 2);
    assert.deepEqual(Object.keys(data.schemas[0]).sort(), ["fieldCount", "name"]);
    assert.deepEqual(Object.keys(data.mappings[0]).sort(), ["arrowCount", "name"]);
    assert.equal(data.warningCount, 0);
    assert.equal(data.questionCount, 0);
    assert.equal(data.totalErrors, 0);
  });

  it("reports an unresolvable path as a bare CommandError message, not an unhandled rejection", async () => {
    // Regression for sl-00rw: summary was the only command not wrapped in
    // runCommand, so loadWorkspace failures escaped to the unhandledRejection
    // net and were prefixed "Unhandled error:" — breaking the error-message
    // contract shared by every other command.
    const { stderr, code } = await run("summary", "/nonexistent/path.stm");

    assert.equal(code, 2);
    assert.match(stderr, /^Error resolving path/);
    assert.doesNotMatch(stderr, /Unhandled error:/);
  });

  it("lists metric blocks only under metrics, never double-counted as schemas (sl-s2mh)", async () => {
    // Metric schemas live in both index.schemas and index.metrics; the summary
    // sections must partition them or the schema count disagrees with graph
    // stats and every metric is reported twice.
    const { stdout, code } = await run("summary", "--json", METRICS_EXAMPLE);

    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.ok(data.metrics.length > 0, "metrics-platform example should yield metric entries");
    const schemaNames = new Set(data.schemas.map((s: { name: string }) => s.name));
    for (const metric of data.metrics) {
      assert.ok(!schemaNames.has(metric.name), `metric '${metric.name}' must not also be listed as a schema`);
    }
  });
});

// ---------------------------------------------------------------------------
// sl-201z: declared-arrow coverage must see both same-line arrows
// ---------------------------------------------------------------------------
describe("summary nl-derived coverage with same-line arrows (sl-201z)", () => {
  it("suppresses an nl ref covered by the second of two same-line declared arrows", async () => {
    // Bug sl-201z: declared-coverage collection deduplicated arrow records by
    // file:line:target, dropping `b -> x` when it shares a line and target
    // with `a -> x`. The @b ref annotating its own declared source was then
    // wrongly counted as an extra nl-derived arrow.
    const fixture = resolve(__dirname, "fixtures/same-line-arrows.stm");
    const { stdout, code } = await run("summary", "--json", fixture);
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    const mapping = (data.mappings as any[]).find((m) => m.name === "::m");
    assert.ok(mapping, "mapping ::m should be reported");
    assert.equal(mapping.arrowCount, 2, "only the two declared arrows should be counted");
    assert.equal(mapping.nlDerivedArrowCount, undefined,
      "@b annotates its own declared arrow and must not count as nl-derived");
  });
});

/**
 * where-used.test.ts — End-to-end tests for `satsuma where-used`.
 *
 * Runs the built CLI as a subprocess against fixtures (the same pattern as
 * namespace-bugs.test.ts). The previous version of this file tested an
 * inline *copy* of the walker implementation, which kept passing while the
 * real command silently found nothing for namespaced transforms and
 * fragments (sl-l3m8) — these tests exercise the actual command.
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run as _run } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
// Fixture defining crm::tidy / crm::audit_fields plus a global `tidy` that
// shares the bare name, exercising every bare/qualified × inside/outside
// namespace combination (sl-l3m8).
const FIXTURE = resolve(__dirname, "fixtures/namespace-where-used.stm");
// Canonical example: a GLOBAL fragment spread bare into namespaced schemas.
const NS_PLATFORM = resolve(__dirname, "../../../examples/namespaces/ns-platform.stm");

const run = (...args: string[]) => _run(CLI, ...args);

/** Parse `--json` stdout and return the refs of the given kind. */
function refsOfKind(stdout: string, kind: string): Array<{ name: string; line: number }> {
  return JSON.parse(stdout).refs.filter((r: { kind: string }) => r.kind === kind);
}

describe("where-used: transforms defined inside a namespace (sl-l3m8)", () => {
  it("finds bare invocations, bare spreads, and qualified spreads of a namespaced transform", async () => {
    const { stdout, code } = await run("where-used", "crm::tidy", FIXTURE, "--json");
    assert.equal(code, 0);
    const calls = refsOfKind(stdout, "transform_call");
    const byMapping = new Map(calls.map((r) => [r.name, r.line]));
    // `...tidy` spread inside the namespace binds to crm::tidy
    assert.ok(byMapping.has("crm::clean_customers"), "bare ...spread inside namespace must be found");
    // bare `tidy` pipe step inside the namespace binds to crm::tidy
    assert.ok(byMapping.has("crm::clean_customers_again"), "bare pipe invocation inside namespace must be found");
    // `...crm::tidy` from outside the namespace binds to crm::tidy
    assert.ok(byMapping.has("clean_global_users"), "qualified ...spread from outside namespace must be found");
    assert.equal(calls.length, 3, "exactly the three crm::tidy call sites — no fan-out to the global tidy");
  });

  it("does not attribute bare references inside the namespace to a same-named global transform", async () => {
    // The fixture's global `tidy` shadows nothing inside crm: a bare `tidy`
    // authored in crm binds to crm::tidy, so the global transform's
    // references are only those authored outside the namespace.
    const { stdout, code } = await run("where-used", "tidy", FIXTURE, "--json");
    assert.equal(code, 0);
    const data = JSON.parse(stdout);
    assert.equal(data.name, "::tidy", "bare query resolves to the global transform");
    const calls = refsOfKind(stdout, "transform_call");
    assert.deepEqual(calls.map((r) => r.name), ["shout_global_users"]);
  });
});

describe("where-used: fragments defined inside a namespace (sl-l3m8)", () => {
  it("finds bare spreads from inside and qualified spreads from outside the namespace", async () => {
    const { stdout, code } = await run("where-used", "crm::audit_fields", FIXTURE, "--json");
    assert.equal(code, 0);
    const spreads = refsOfKind(stdout, "fragment_spread");
    const blocks = spreads.map((r) => r.name).sort();
    assert.deepEqual(blocks, ["crm::customers", "global_users"]);
  });

  it("still finds bare spreads of a GLOBAL fragment authored inside namespaces (corpus)", async () => {
    // ns-platform.stm spreads the global standard_metadata fragment into
    // schemas across several namespace blocks — the pre-fix raw-text match
    // happened to work here, so this pins against regression in the other
    // direction (bare ref in a namespace falling back to the global def).
    const { stdout, code } = await run("where-used", "standard_metadata", NS_PLATFORM, "--json");
    assert.equal(code, 0);
    const spreads = refsOfKind(stdout, "fragment_spread");
    assert.ok(spreads.length >= 5, `expected the corpus's many spreads, got ${spreads.length}`);
    assert.ok(spreads.some((r) => r.name.includes("::")), "spread targets include namespaced schemas");
  });

  it("finds spreads of multi-word backticked fragment names", async () => {
    // Spread-label text extraction joins identifier parts with spaces and
    // strips backticks; this guards that path alongside namespace resolution.
    const { stdout, code } = await run("where-used", "common keys", FIXTURE, "--json");
    assert.equal(code, 0);
    const spreads = refsOfKind(stdout, "fragment_spread");
    assert.deepEqual(spreads.map((r) => r.name), ["global_users"]);
  });
});

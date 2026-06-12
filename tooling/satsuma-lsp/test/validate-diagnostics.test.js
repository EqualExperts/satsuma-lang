const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const {
  runValidate,
  parseValidateFindings,
  pathToFileUri,
  reconcileValidateCache,
} = require("../dist/validate-diagnostics");

// The locally built CLI, invoked directly (it has a `#!/usr/bin/env node`
// shebang). Tests must NOT use a bare "satsuma" from PATH: a missing global
// install silently yields zero diagnostics, which is exactly how the
// sl-rngq regression passed the old soft-guarded tests unnoticed.
const CLI_PATH = path.resolve(__dirname, "../../satsuma-cli/dist/index.js");

describe("reconcileValidateCache", () => {
  // sl-th5k: on save, only the saved file's cache entry was deleted. A
  // cross-file diagnostic (error in A attributed to B) stayed cached for B
  // even after the fixing save removed it from the validate output — the
  // client showed B's stale diagnostic until B itself was saved.

  const diag = (msg) => [{ message: msg, range: {}, severity: 1 }];

  it("clears cached entries for in-scope files the new run no longer reports (sl-th5k)", () => {
    const cache = new Map([
      ["file:///a.stm", diag("old A")],
      ["file:///b.stm", diag("cross-file error in B")],
    ]);
    // The fixing save: the new run reports nothing for B any more.
    const results = new Map([["file:///a.stm", diag("new A")]]);
    const cleared = reconcileValidateCache(
      cache,
      ["file:///a.stm", "file:///b.stm"],
      results,
    );
    assert.deepEqual(cleared, ["file:///b.stm"]);
    assert.equal(cache.has("file:///b.stm"), false, "stale entry must be removed");
    assert.deepEqual(cache.get("file:///a.stm"), diag("new A"), "fresh results replace old");
  });

  it("leaves cached entries outside the run's scope untouched", () => {
    // C's diagnostics came from validating a different entry file; this run
    // says nothing about C and must not wipe legitimate results.
    const cache = new Map([["file:///c.stm", diag("error in other closure")]]);
    const cleared = reconcileValidateCache(cache, ["file:///a.stm"], new Map());
    assert.deepEqual(cleared, []);
    assert.ok(cache.has("file:///c.stm"));
  });

  it("clears the saved file itself when it stops reporting", () => {
    // The saved file is part of its own closure: fixing the last error in A
    // must clear A without special-casing.
    const cache = new Map([["file:///a.stm", diag("old A")]]);
    const cleared = reconcileValidateCache(cache, ["file:///a.stm"], new Map());
    assert.deepEqual(cleared, ["file:///a.stm"]);
    assert.equal(cache.size, 0);
  });
});

describe("pathToFileUri", () => {
  // The Windows symptom (a `C:\…` path becoming a malformed `file://C:\…`
  // URI that never matches the open document, so diagnostics silently fail
  // to attach) cannot be reproduced on the POSIX CI host, because
  // pathToFileURL is platform-bound. These cases pin the platform-independent
  // invariant that prevents it: a canonical file:// URL that round-trips. (gh-265)

  it("produces a canonical file:// URL, not a hand-built string", () => {
    // Locks the implementation to Node's pathToFileURL. The previous
    // `"file://" + encodeURI(path)` is what mishandled Windows drive paths.
    assert.equal(pathToFileUri("/proj/x.stm"), pathToFileURL("/proj/x.stm").toString());
  });

  it("round-trips a path containing URL-significant characters", () => {
    // `?` is the POSIX proxy for the Windows drive-colon breakage: encodeURI
    // left it raw, so the old code yielded `file:///a?b.stm` where `?b.stm`
    // parses as a query string and fileURLToPath loses it. pathToFileURL
    // encodes it, so the URI round-trips to the exact input.
    const p = "/proj/weird?name #1/x.stm";
    assert.equal(fileURLToPath(pathToFileUri(p)), p);
  });
});

describe("parseValidateFindings", () => {
  // sl-rngq: the CLI switched `validate --json` from a bare array to a
  // `{findings, summary}` envelope (commit 8758118) and the LSP's
  // Array.isArray guard silently rejected it — every validate diagnostic
  // vanished from the editor for months. These cases pin both accepted
  // shapes and the rejection behaviour.

  it("extracts findings from the {findings, summary} envelope the CLI emits today", () => {
    const raw = JSON.stringify({
      findings: [{ file: "/a.stm", line: 3, column: 1, severity: "warning", rule: "r", message: "m", fixable: false }],
      summary: { files: 1, errors: 0, warnings: 1 },
    });
    const entries = parseValidateFindings(raw);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].rule, "r");
  });

  it("accepts the bare-array shape still emitted for path-resolve failures", () => {
    // Not legacy tolerance: satsuma-cli validate.ts emits
    // `[{severity, message}]` (no file) when input resolution fails.
    const entries = parseValidateFindings(
      JSON.stringify([{ severity: "error", message: "Error resolving path: nope" }]),
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].file, undefined);
  });

  it("returns no findings for unparseable or unrecognised JSON", () => {
    assert.deepEqual(parseValidateFindings("not json"), []);
    // An object without a findings array (e.g. a future shape change) must
    // degrade to empty, not throw inside the execFile callback.
    assert.deepEqual(parseValidateFindings(JSON.stringify({ summary: {} })), []);
    assert.deepEqual(parseValidateFindings(JSON.stringify({ findings: "oops" })), []);
  });
});

describe("runValidate", () => {
  it("returns empty map when CLI produces no output", async () => {
    // Use a non-existent CLI to exercise the error/empty path
    const result = await runValidate(
      "file:///tmp/nonexistent.stm",
      "/nonexistent/satsuma-cli",
    );
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });

  it("returns empty map when CLI produces invalid JSON", async () => {
    // echo outputs non-JSON text
    const result = await runValidate(
      "file:///tmp/test.stm",
      "echo",
    );
    assert.ok(result instanceof Map);
    assert.equal(result.size, 0);
  });

  // Contract test against the real built CLI (sl-rngq acceptance criterion 3):
  // if the CLI's --json shape and the LSP parser ever drift again, this fails
  // loudly instead of degrading to zero diagnostics. The namespaces example
  // ships four known field-not-in-schema warnings (bogus source fields on
  // warehouse::conformed_store in the 'daily sales pipeline' mapping), so a
  // non-empty result is a hard requirement, not an if-guarded hope.
  it("surfaces the namespaces example's four field-not-in-schema warnings from the real CLI", async () => {
    const fixturePath = path.resolve(
      __dirname,
      "../../../examples/namespaces/namespaces.stm",
    );
    const fixtureUri = pathToFileURL(fixturePath).toString();

    const result = await runValidate(fixtureUri, CLI_PATH);

    assert.ok(result.size > 0, "real CLI output must produce diagnostics — empty means the JSON shapes have drifted (sl-rngq)");

    const all = [...result.values()].flat();
    const fieldWarnings = all.filter((d) => d.code === "field-not-in-schema");
    assert.equal(fieldWarnings.length, 4, "the four bogus source fields must each surface as a diagnostic");
    for (const d of fieldWarnings) {
      assert.equal(d.source, "satsuma-validate");
      // DiagnosticSeverity.Warning === 2
      assert.equal(d.severity, 2, "field-not-in-schema is warning severity");
      assert.match(d.message, /not declared in schema 'warehouse::conformed_store'/);
      // CLI reports lines 105-108 (1-based); LSP must convert to 0-based.
      assert.ok(d.range.start.line >= 104 && d.range.start.line <= 107,
        `expected 0-based line in [104,107], got ${d.range.start.line}`);
    }

    // Diagnostics must be keyed by canonical file:// URIs so they attach to
    // the open editor document.
    for (const [uri] of result) {
      assert.ok(uri.startsWith("file://"), `URI should start with file://, got: ${uri}`);
    }
  });
});

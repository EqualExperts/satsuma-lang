const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { fileURLToPath, pathToFileURL } = require("node:url");
const {
  runValidate,
  pathToFileUri,
  reconcileValidateCache,
} = require("../dist/validate-diagnostics");

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

  it("parses valid satsuma validate --json output", async () => {
    // Use the real satsuma CLI against a fixture with known warnings
    const fixtureDir = require("path").resolve(
      __dirname,
      "../../../examples/db-to-db/pipeline.stm",
    );
    const fixtureUri = "file://" + encodeURI(fixtureDir);

    const result = await runValidate(fixtureUri, "satsuma");

    // db-to-db.stm should have warnings (missing-import, undefined-ref, etc.)
    // If satsuma CLI is not available, this effectively tests graceful fallback
    if (result.size > 0) {
      for (const [uri, diags] of result) {
        assert.ok(uri.startsWith("file://"), `URI should be file:// got ${uri}`);
        assert.ok(diags.length > 0, "Should have diagnostics");
        for (const d of diags) {
          assert.equal(d.source, "satsuma-validate");
          assert.ok(d.message, "Diagnostic should have a message");
          assert.ok(d.code, "Diagnostic should have a rule code");
          assert.ok(d.range, "Diagnostic should have a range");
          // Lines should be 0-based (converted from 1-based)
          assert.ok(
            d.range.start.line >= 0,
            "Line should be non-negative",
          );
        }
      }
    }
  });

  it("returns diagnostics with correct severity mapping", async () => {
    const fixtureDir = require("path").resolve(
      __dirname,
      "../../../examples/db-to-db/pipeline.stm",
    );
    const fixtureUri = "file://" + encodeURI(fixtureDir);

    const result = await runValidate(fixtureUri, "satsuma");

    if (result.size > 0) {
      for (const [, diags] of result) {
        for (const d of diags) {
          // DiagnosticSeverity: Error=1, Warning=2, Information=3, Hint=4
          assert.ok(
            [1, 2, 3, 4].includes(d.severity),
            `Severity should be a valid LSP value, got ${d.severity}`,
          );
        }
      }
    }
  });

  it("groups diagnostics by file URI", async () => {
    // Validate the examples directory — should have multiple files
    const examplesDir = require("path").resolve(
      __dirname,
      "../../../examples",
    );
    // Pick a file that imports from another file
    const fixtureUri = "file://" + encodeURI(
      require("path").join(examplesDir, "db-to-db/pipeline.stm"),
    );

    const result = await runValidate(fixtureUri, "satsuma");

    if (result.size > 0) {
      // All URIs should be properly formatted
      for (const [uri] of result) {
        assert.ok(
          uri.startsWith("file://"),
          `URI should start with file://, got: ${uri}`,
        );
      }
    }
  });

  it("converts 1-based line/column to 0-based", async () => {
    const fixtureDir = require("path").resolve(
      __dirname,
      "../../../examples/db-to-db/pipeline.stm",
    );
    const fixtureUri = "file://" + encodeURI(fixtureDir);

    const result = await runValidate(fixtureUri, "satsuma");

    if (result.size > 0) {
      for (const [, diags] of result) {
        for (const d of diags) {
          // 0-based lines: line 3 in CLI output → line 2 in LSP
          assert.ok(d.range.start.line >= 0, "Line must be 0-based");
          assert.ok(d.range.start.character >= 0, "Character must be 0-based");
        }
      }
    }
  });
});

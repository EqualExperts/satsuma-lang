const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const { computeDiagnostics } = require("../dist/diagnostics");

before(async () => { await initTestParser(); });

describe("computeDiagnostics", () => {
  it("returns empty diagnostics for valid input", () => {
    const tree = parse(`schema customers {
  customer_id UUID (pk)
  name VARCHAR(200)
}`);
    const diags = computeDiagnostics(tree);
    const errors = diags.filter((d) => d.severity === 1); // Error
    assert.equal(errors.length, 0);
  });

  it("reports syntax errors for invalid input", () => {
    const tree = parse("schema { }"); // missing block label
    const diags = computeDiagnostics(tree);
    const errors = diags.filter((d) => d.severity === 1); // Error
    assert.ok(errors.length > 0, "Expected at least one error diagnostic");
  });

  it("reports warning comments as Warning severity", () => {
    const tree = parse(`schema foo {
  bar STRING //! known issue with this field
}`);
    const diags = computeDiagnostics(tree);
    const warnings = diags.filter((d) => d.severity === 2); // Warning
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /known issue/);
  });

  // Regression for sl-sme1 / gh-273: a bare `//!` produced message: "",
  // which vscode's Diagnostic constructor rejects ("message must be set"),
  // aborting the client's entire diagnostic batch for the file.
  it("gives a bare //! comment a non-empty fallback message", () => {
    const tree = parse(`schema foo {
  bar STRING //!
}`);
    const diags = computeDiagnostics(tree);
    const warnings = diags.filter((d) => d.severity === 2); // Warning
    assert.equal(warnings.length, 1);
    assert.ok(
      warnings[0].message.trim().length > 0,
      "bare //! must not produce an empty diagnostic message",
    );
  });

  it("reports question comments as Hint severity with TODO prefix", () => {
    const tree = parse(`schema foo {
  bar STRING //? should this be INT?
}`);
    const diags = computeDiagnostics(tree);
    const hints = diags.filter((d) => d.severity === 4); // Hint
    assert.equal(hints.length, 1);
    assert.match(hints[0].message, /^TODO: /);
    assert.match(hints[0].message, /should this be INT/);
  });

  it("sets source to 'satsuma' on all diagnostics", () => {
    const tree = parse(`schema { }
//! warning
//? question`);
    const diags = computeDiagnostics(tree);
    assert.ok(diags.length > 0);
    for (const d of diags) {
      assert.equal(d.source, "satsuma");
    }
  });

  it("handles files with no blocks gracefully", () => {
    const tree = parse("");
    const diags = computeDiagnostics(tree);
    assert.deepEqual(diags, []);
  });

  it("includes correct line/column range for errors", () => {
    const tree = parse("schema { }");
    const diags = computeDiagnostics(tree);
    const errors = diags.filter((d) => d.severity === 1);
    assert.ok(errors.length > 0);
    // Error should be on line 0
    assert.equal(errors[0].range.start.line, 0);
  });
});

describe("ensureNonEmptyMessages", () => {
  const { ensureNonEmptyMessages } = require("../dist/diagnostics");
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };

  // Publish-boundary safety net for sl-sme1: whatever producer misbehaves,
  // the server must never hand the client an empty-message diagnostic.
  it("replaces empty and whitespace-only messages with a placeholder naming the rule code", () => {
    const out = ensureNonEmptyMessages([
      { range, severity: 1, source: "satsuma", message: "", code: "missing-import" },
      { range, severity: 2, source: "satsuma", message: "   " },
    ]);
    assert.match(out[0].message, /missing-import/);
    assert.ok(out[1].message.trim().length > 0);
  });

  it("passes diagnostics with real messages through unchanged", () => {
    const diag = { range, severity: 1, source: "satsuma", message: "Syntax error" };
    const out = ensureNonEmptyMessages([diag]);
    assert.deepEqual(out, [diag]);
  });
});

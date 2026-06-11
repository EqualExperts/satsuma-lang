/**
 * context.test.js — Unit tests for context command scoring and tokenization.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ── Inline scoring helpers (mirrors context.js) ───────────────────────────────

function tokenize(query: string) {
  const stop = new Set(["a", "an", "the", "to", "for", "in", "of", "and", "or", "is"]);
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((t: string) => t.length > 1 && !stop.has(t));
}

function scoreText(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.filter((t: string) => lower.includes(t)).length;
}

function scoreAll(index: any, terms: string[]) {
  const results: { name: string; type: string; score: number; file: string; row: number }[] = [];
  const scoreEntry = (name: string, type: string, entry: any) => {
    let score = 0;
    score += scoreText(name, terms) * 10;
    if (entry.note) score += scoreText(entry.note, terms) * 2;
    if (entry.fields) {
      for (const f of entry.fields) {
        score += scoreText(f.name, terms) * 5;
        score += scoreText(f.type, terms);
      }
    }
    if (entry.sources) for (const s of entry.sources) score += scoreText(s, terms);
    if (entry.targets) for (const t of entry.targets) score += scoreText(t, terms);
    if (score > 0) results.push({ name, type, score, file: entry.file ?? "", row: entry.row ?? 0 });
  };
  for (const [name, e] of (index.schemas ?? new Map())) scoreEntry(name, "schema", e);
  for (const [name, e] of (index.metrics ?? new Map())) scoreEntry(name, "metric", e);
  for (const [name, e] of (index.mappings ?? new Map())) scoreEntry(name, "mapping", e);
  return results;
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("tokenize", () => {
  it("splits on non-word characters", () => {
    assert.deepEqual(tokenize("add a PII field"), ["add", "pii", "field"]);
  });

  it("filters stop words", () => {
    const terms = tokenize("the customer schema");
    assert.ok(!terms.includes("the"));
    assert.ok(terms.includes("customer"));
    assert.ok(terms.includes("schema"));
  });

  it("is case-insensitive", () => {
    assert.deepEqual(tokenize("Customer PII"), ["customer", "pii"]);
  });

  it("filters single-char tokens", () => {
    const terms = tokenize("a b c pii");
    assert.deepEqual(terms, ["pii"]);
  });
});

describe("scoreText", () => {
  it("counts term hits in text", () => {
    assert.equal(scoreText("customer_id email pii", ["pii", "email"]), 2);
  });

  it("is case-insensitive", () => {
    assert.equal(scoreText("PII field", ["pii"]), 1);
  });

  it("returns 0 for no match", () => {
    assert.equal(scoreText("order_id INT", ["customer"]), 0);
  });
});

describe("scoreAll", () => {
  it("scores schemas higher on name match", () => {
    const index = {
      schemas: new Map([
        ["customer", { fields: [], note: null, file: "a.stm", row: 0 }],
        ["orders", { fields: [], note: null, file: "a.stm", row: 5 }],
      ]),
    };
    const terms = tokenize("customer schema");
    const results = scoreAll(index, terms);
    const customerEntry = results.find((r) => r.name === "customer");
    const ordersEntry = results.find((r) => r.name === "orders");
    assert.ok(customerEntry !== undefined);
    assert.ok(customerEntry.score > (ordersEntry?.score ?? 0));
  });

  it("scores field name match (×5)", () => {
    const index = {
      schemas: new Map([
        ["orders", { fields: [{ name: "email", type: "VARCHAR(255)" }], note: null, file: "a.stm", row: 0 }],
        ["products", { fields: [{ name: "sku", type: "STRING(20)" }], note: null, file: "a.stm", row: 5 }],
      ]),
    };
    const terms = ["email"];
    const results = scoreAll(index, terms);
    const ordersEntry = results.find((r) => r.name === "orders");
    assert.ok(ordersEntry !== undefined);
    assert.equal(ordersEntry.score, 5); // field match ×5
  });

  it("returns empty array when nothing matches", () => {
    const index = {
      schemas: new Map([["foo", { fields: [], note: null, file: "a.stm", row: 0 }]]),
    };
    const results = scoreAll(index, ["xyz_nonexistent"]);
    assert.equal(results.length, 0);
  });

  it("surfaces the correct block for PII query", () => {
    const index = {
      schemas: new Map([
        ["customer", { fields: [{ name: "email", type: "VARCHAR(255)" }, { name: "tax_id", type: "VARCHAR(20)" }], note: "Customer PII data", file: "c.stm", row: 0 }],
        ["products", { fields: [{ name: "sku", type: "STRING" }], note: null, file: "p.stm", row: 0 }],
      ]),
    };
    const terms = tokenize("add a PII field to the customer schema");
    const results = scoreAll(index, terms);
    results.sort((a, b) => b.score - a.score);
    assert.equal(results[0].name, "customer");
  });
});

describe("estimateTokens", () => {
  it("estimates tokens as ceil(length / 4)", () => {
    assert.equal(estimateTokens("hello"), 2); // 5/4 = 1.25 → 2
    assert.equal(estimateTokens(""), 0);
    assert.equal(estimateTokens("1234"), 1);
    assert.equal(estimateTokens("12345"), 2);
  });
});

// ── CLI-level coverage (spawns the built command) ────────────────────────────

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run as runCli } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "../dist/index.js");
const METRICS_EXAMPLE = resolve(__dirname, "../../../examples/metrics-platform/metrics.stm");

describe("satsuma context metric deduplication (sl-s2mh)", () => {
  it("scores each metric block once, as a metric, never additionally as a schema", async () => {
    // Metric schemas live in both index.schemas and index.metrics; scoring
    // both rendered the same block twice and wasted the token budget the
    // command exists to manage.
    const { stdout, code } = await runCli(CLI, "context", "monthly recurring revenue", "--json", METRICS_EXAMPLE);

    assert.equal(code, 0);
    const candidates = JSON.parse(stdout) as Array<{ name: string; type: string }>;
    const seen = new Set<string>();
    for (const candidate of candidates) {
      assert.ok(!seen.has(candidate.name), `'${candidate.name}' emitted more than once`);
      seen.add(candidate.name);
    }
    assert.ok(
      candidates.some((candidate) => candidate.type === "metric"),
      "an MRR query against the metrics example should surface metric candidates",
    );
  });
});

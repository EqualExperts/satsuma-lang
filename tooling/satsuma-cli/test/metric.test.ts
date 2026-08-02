/**
 * metric.test.js — Unit tests for metric command helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ── Mock CST helpers ──────────────────────────────────────────────────────────

function n(type: string, namedChildren: any[] = [], text = "") {
  return { type, text, startPosition: { row: 0, column: 0 }, namedChildren };
}
function ident(t: string) {
  return n("identifier", [], t);
}

// ── Inline extractMetaEntries (mirrors metric.js) ─────────────────────────────

function extractMetaEntries(metaNode: any) {
  if (!metaNode) return [];
  const entries = [];
  for (const c of metaNode.namedChildren) {
    if (c.type === "tag_with_value") {
      const key = c.namedChildren[0]; // identifier
      const val = c.namedChildren[1]; // value_text
      if (key) {
        let valText = val?.text ?? "";
        // Strip quotes from nl_string values inside value_text
        const firstChild = val?.namedChildren?.[0];
        if (firstChild?.type === "nl_string") valText = firstChild.text.slice(1, -1);
        entries.push({ key: key.text, value: valText });
      }
    } else if (c.type === "tag_token") {
      entries.push({ key: c.text, value: null });
    }
  }
  return entries;
}

// ── Inline formatMeta (mirrors metric.js) ─────────────────────────────────────

function formatMeta(entries: { key: string; value: string | null }[]) {
  if (entries.length === 0) return "";
  const format = (e: { key: string; value: string | null }) =>
    e.value !== null ? `${e.key} ${e.value}` : e.key;
  if (entries.length <= 2) {
    return ` (${entries.map(format).join(", ")})`;
  }
  const lines = entries.map((e) => `  ${format(e)}`).join(",\n");
  return ` (\n${lines}\n)`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("extractMetaEntries", () => {
  it("extracts tag_with_value entries", () => {
    const kvVal = n("value_text", [ident("monthly")], "monthly");
    const kv = n("tag_with_value", [ident("grain"), kvVal]);
    const meta = n("metadata_block", [kv]);

    const entries = extractMetaEntries(meta);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "grain");
    assert.equal(entries[0].value, "monthly");
  });

  it("strips nl_string quotes from values", () => {
    const kvVal = n(
      "value_text",
      [n("nl_string", [], "\"status = 'active'\"")],
      "\"status = 'active'\"",
    );
    const kv = n("tag_with_value", [ident("filter"), kvVal]);
    const meta = n("metadata_block", [kv]);

    const entries = extractMetaEntries(meta);
    assert.equal(entries[0].value, "status = 'active'");
  });

  it("handles tag_token (no value)", () => {
    const tag = n("tag_token", [], "monthly");
    const meta = n("metadata_block", [tag]);

    const entries = extractMetaEntries(meta);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, "monthly");
    assert.equal(entries[0].value, null);
  });

  it("returns empty array for null", () => {
    assert.deepEqual(extractMetaEntries(null), []);
  });
});

describe("formatMeta", () => {
  it("returns empty string for 0 entries", () => {
    assert.equal(formatMeta([]), "");
  });

  it("formats 1 entry inline", () => {
    const result = formatMeta([{ key: "grain", value: "monthly" }]);
    assert.equal(result, " (grain monthly)");
  });

  it("formats 2 entries inline", () => {
    const result = formatMeta([
      { key: "grain", value: "monthly" },
      { key: "source", value: "fact_subs" },
    ]);
    assert.equal(result, " (grain monthly, source fact_subs)");
  });

  it("formats 3+ entries multi-line", () => {
    const result = formatMeta([
      { key: "source", value: "fact_subs" },
      { key: "grain", value: "monthly" },
      { key: "filter", value: "status=active" },
    ]);
    assert.ok(result.startsWith(" (\n"));
    assert.ok(result.endsWith("\n)"));
    assert.ok(result.includes("  source fact_subs"));
    assert.ok(result.includes("  grain monthly"));
    assert.ok(result.includes("  filter status=active"));
  });

  it("formats tag_token (no value) correctly", () => {
    const result = formatMeta([{ key: "additive", value: null }]);
    assert.equal(result, " (additive)");
  });
});

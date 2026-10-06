/**
 * Tests for check-doc-snippets.mjs, the guard that keeps the tutorials' and
 * lessons' Satsuma snippets valid (GitHub issue #525).
 *
 * The guard is only worth having if it fails for the reason it exists, so the
 * central test feeds it the exact snippet the BA tutorial used to teach and
 * asserts the #525 warning comes back. The last test runs the guard over the
 * real docs, which is what stops the drift recurring.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractSnippets,
  isCompleteNestedMapping,
  contextDeclarations,
  validateWithContext,
  checkDocSnippets,
  initSnippetParser,
} from "./check-doc-snippets.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

before(async () => {
  await initSnippetParser();
});

/** A minimal context: an order with a list of line items, and a flat target. */
const ORDER_CONTEXT = `
schema shop {
  Order record {
    OrderId STRING
    LineItems list_of record {
      SKU STRING
    }
  }
}

schema rows {
  order_id STRING
  sku STRING
}

mapping \`already defined\` {
  source { shop }
  target { rows }
  Order.OrderId -> order_id
}
`;

/** Wraps flatten-block arrows in the mapping shape every test snippet shares. */
function flattenMapping(arrows) {
  return `mapping \`order lines\` {
  source { shop }
  target { rows }

  flatten Order.LineItems -> rows {
${arrows}
  }
}
`;
}

test("reads the annotation on the nearest non-blank line above a fence, and none when absent", () => {
  // The annotation is how a doc author opts a snippet in; a blank line between
  // comment and fence is common in hand-written Markdown and must not detach it.
  const md = [
    "<!-- satsuma-check: schemas from examples/x.stm -->",
    "",
    "```satsuma",
    "schema a { b STRING }",
    "```",
    "Prose.",
    "```satsuma",
    "schema c { d STRING }",
    "```",
  ].join("\n");
  const [first, second] = extractSnippets(md);
  assert.deepEqual(first.annotation, { kind: "schemas", contextPath: "examples/x.stm" });
  assert.equal(first.line, 3);
  assert.equal(first.code, "schema a { b STRING }\n");
  assert.equal(second.annotation, null);
});

test("requires a reason on skip, and reports a malformed directive rather than ignoring it", () => {
  // A typo in the directive must not silently disable the check.
  const skip = extractSnippets(
    "<!-- satsuma-check: skip — illustrative only -->\n```satsuma\nx\n```\n",
  )[0];
  assert.deepEqual(skip.annotation, { kind: "skip", reason: "illustrative only" });
  const bare = extractSnippets("<!-- satsuma-check: skip -->\n```satsuma\nx\n```\n")[0];
  assert.equal(bare.annotation.kind, "invalid");
  const typo = extractSnippets(
    "<!-- satsuma-check: schema form a.stm -->\n```satsuma\nx\n```\n",
  )[0];
  assert.equal(typo.annotation.kind, "invalid");
});

test("recognises the standalone and earlier-snippets forms", () => {
  // Both forms are used by docs/nested-data/README.md; a rename would turn them
  // into "invalid" and fail loudly rather than drop the check.
  const md =
    "<!-- satsuma-check: standalone -->\n```satsuma\nx\n```\n<!-- satsuma-check: schemas from earlier snippets -->\n```satsuma\ny\n```\n";
  assert.deepEqual(
    extractSnippets(md).map((s) => s.annotation),
    [{ kind: "standalone" }, { kind: "earlier" }],
  );
});

test("keeps only the last declaration when a guide redeclares a schema", () => {
  // Guides refine a schema across snippets; borrowing both copies would raise
  // duplicate-definition, and the earlier copy is the one the reader has moved past.
  const declarations = contextDeclarations(
    "schema s {\n  old STRING\n}\nschema s {\n  new STRING\n}\n",
  );
  assert.match(declarations, /new STRING/);
  assert.doesNotMatch(declarations, /old STRING/);
});

test("treats only a parseable mapping with each/flatten as needing an annotation", () => {
  // Fragments cannot be validated, so demanding annotations on them would only
  // teach authors to add skips. Complete nested mappings are where #525 lived.
  assert.equal(isCompleteNestedMapping(flattenMapping("    .SKU -> sku")), true);
  assert.equal(
    isCompleteNestedMapping("mapping m {\n  source { a }\n  target { b }\n  x -> y\n}\n"),
    false,
  );
  assert.equal(isCompleteNestedMapping("each LineItems -> .items {\n  .SKU -> .sku\n}\n"), false);
});

test("borrows the context file's schemas but not its mappings", () => {
  // The snippet must be free to reuse an example's mapping name without a
  // duplicate-definition finding.
  const declarations = contextDeclarations(ORDER_CONTEXT);
  assert.match(declarations, /schema shop/);
  assert.match(declarations, /schema rows/);
  assert.doesNotMatch(declarations, /already defined/);
});

test("reports the #525 warning for an ancestor path written without an escape inside flatten", () => {
  // The exact pattern the BA tutorial taught. If this stops failing, the guard
  // no longer protects against the drift it was written for.
  const findings = validateWithContext(
    flattenMapping("    Order.OrderId -> order_id"),
    ORDER_CONTEXT,
  );
  // The message wording (and its sl-i9ve hint) belongs to core's tests; this
  // pins only that the guard reports the finding at the snippet's own line.
  assert.deepEqual(
    findings.map((f) => [f.rule, f.line]),
    [["field-not-in-schema", 6]],
  );
  assert.match(
    findings[0].message,
    /^Arrow source 'Order\.LineItems\.Order\.OrderId' not declared/,
  );
});

test("accepts the corrected snippet that reaches the order with ^.", () => {
  // Paired with the test above: the same snippet, fixed as the docs now teach.
  assert.deepEqual(
    validateWithContext(
      flattenMapping("    ^.OrderId -> order_id\n    .SKU -> sku"),
      ORDER_CONTEXT,
    ),
    [],
  );
});

test("every Satsuma snippet in the tutorials and lessons passes the guard", () => {
  // The guard over the real docs. A failure names the doc line to fix; add a
  // `schemas from` or `skip — <reason>` annotation if the snippet is new.
  assert.deepEqual(checkDocSnippets(repoRoot), []);
});

test("the corrected lesson snippets are annotated, so the real docs stay under check", () => {
  // Removing an annotation would quietly drop a snippet from validation; pin
  // the three that #525 was filed against.
  const docs = [
    "docs/tutorials/ba-tutorial.md",
    "lessons/07-nested-mappings.md",
    "lessons/14-integration-engineer-playbook.md",
  ];
  for (const doc of docs) {
    const flatten = extractSnippets(readFileSync(join(repoRoot, doc), "utf8")).find((s) =>
      s.code.includes("flatten Order.LineItems"),
    );
    assert.equal(flatten?.annotation?.kind, "schemas", `${doc}: flatten snippet is not validated`);
  }
});

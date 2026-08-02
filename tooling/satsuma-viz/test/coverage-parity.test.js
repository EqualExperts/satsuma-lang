/**
 * coverage-parity.test.js — The viz card and `satsuma coverage` report one number.
 *
 * Feature 36's overlay is only worth building if its figures equal the CLI's,
 * and that guarantee had no test that would fail if it broke (sl-5nsv). This
 * file supplies it end to end on the viz side: parse a fixture, build the model
 * through `@satsuma/viz-backend` exactly as the VS Code host does, derive the
 * covered-field set the card is given, and count it the way the card counts.
 *
 * The expected figures are the ones `satsuma coverage --json` prints for the
 * same files, asserted in satsuma-cli/test/coverage.test.ts, and the same leaves
 * the editor gutter reports, asserted in satsuma-lsp/test/coverage.test.js. One
 * fixture, three suites, one set of numbers — change one and the others fail.
 *
 * `@satsuma/viz-backend` is a devDependency here for exactly this: the runtime
 * dependency still runs component → core only, and nothing in the bundle
 * changes.
 */
import "./dom-shim.js";
import { before, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countContainerStates,
  fieldCoverageFromCoveredPaths,
  getParser,
  initParser,
  summarizeFieldCoverage,
} from "@satsuma/core";
import { createWorkspaceIndex, indexFile } from "@satsuma/viz-backend/workspace-index";
import { buildVizModel } from "@satsuma/viz-backend/viz-model";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");
/** Fixtures live in the CLI package because its suite asserts on them too. */
const FIXTURES = resolve(__dirname, "../../satsuma-cli/test/fixtures");

/** @type {typeof import("../dist/satsuma-viz.js")} */
let viz;

before(async () => {
  await initParser(WASM_PATH);
  viz = await import("../dist/satsuma-viz.js");
});

/**
 * Coverage of one target schema as the card computes it: model from the
 * backend, covered set from the mapping's arrows, counting from core.
 */
function targetCoverage(fixtureName, schemaId) {
  const uri = `file://${resolve(FIXTURES, fixtureName)}`;
  const tree = getParser().parse(readFileSync(resolve(FIXTURES, fixtureName), "utf8"));
  const index = createWorkspaceIndex();
  indexFile(index, uri, tree);
  const model = buildVizModel(uri, tree, index);

  const schemas = model.namespaces.flatMap((ns) => ns.schemas);
  const schema = schemas.find((s) => s.id === schemaId);
  const mapping = model.namespaces.flatMap((ns) => ns.mappings)[0];
  const { targetMapped } = viz.buildMappingCoveredFields(mapping, [], schema);

  const entries = fieldCoverageFromCoveredPaths(schema.fields, uri, targetMapped);
  return {
    leaves: entries.map((f) => [f.path, f.state]),
    totals: summarizeFieldCoverage(entries),
    containers: countContainerStates(entries),
  };
}

describe("viz coverage equals satsuma coverage (sl-5nsv)", () => {
  it("agrees leaf for leaf on a record body materialised by a fragment spread", () => {
    // The CLI reports 2/5 (40%) here with address.street and address.city
    // covered. Every part of that has to match: the leaf list (the model must
    // materialise the spread), the verdicts, the container state, and the
    // percentage.
    const { leaves, totals, containers } = targetCoverage("nested-record-spread.stm", "customer");
    assert.deepEqual(leaves, [
      ["id", "uncovered"],
      ["name", "uncovered"],
      ["address", "partial"],
      ["address.street", "covered"],
      ["address.city", "covered"],
      ["address.zip", "uncovered"],
    ]);
    assert.equal(totals.covered, 2);
    assert.equal(totals.total, 5);
    assert.equal(totals.pct, 40);
    assert.deepEqual(containers, { covered: 0, partial: 1, uncovered: 0 });
  });

  it("agrees on a list_of record body whose arrows are element-relative", () => {
    // Two fixes meeting on one file: the spread has to materialise `lines`'
    // leaves (sl-5nsv) and `.item_code -> .sku` inside the `each` has to
    // resolve against its container (3cdd-yavi). Miss either and the card reads
    // 0 covered where the CLI reads 2/4.
    const { leaves, totals } = targetCoverage("list-of-record-spread.stm", "invoice");
    assert.deepEqual(leaves, [
      ["invoice_no", "covered"],
      ["lines", "partial"],
      ["lines.sku", "covered"],
      ["lines.qty", "uncovered"],
      ["lines.unit_price", "uncovered"],
    ]);
    assert.equal(totals.covered, 2);
    assert.equal(totals.total, 4);
    assert.equal(totals.pct, 50);
  });
});

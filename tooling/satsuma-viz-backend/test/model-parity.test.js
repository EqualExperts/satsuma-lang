/**
 * Model-parity test (sl-j8n5) — locks buildModelFromSources to the VizModel the
 * harness server produced *before* model-building moved into the browser.
 *
 * Feature 33 extracted the harness server's inline /api/model algorithm into
 * buildModelFromSources so the browser and server share one path. This test is
 * the regression guard for that move: `legacyServerModel` below is a frozen,
 * independent transcription of the pre-extraction server algorithm (build one
 * index over all documents → scope to the entry's import graph → buildVizModel,
 * or per-reachable build + mergeVizModels for lineage). If a future change to
 * buildModelFromSources alters output, the deep-equality assertions fail.
 *
 * The fixtures are minimal two-file doc sets (not copies of the real corpus),
 * exercising both single-file and cross-file-lineage modes. Because both
 * runtimes key documents under identical file:/// URIs (feature 33 §1a), the
 * comparison is apples-to-apples.
 */
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { initTestParser, parse } = require("./helper");
const {
  createWorkspaceIndex,
  indexFile,
  getImportReachableUris,
  createScopedIndex,
} = require("../dist/workspace-index");
const { buildVizModel, mergeVizModels } = require("../dist/viz-model");
const { buildModelFromSources } = require("../dist/model-from-sources");

before(async () => {
  await initTestParser();
});

/**
 * The harness server's original /api/model algorithm, transcribed verbatim from
 * server.ts before the buildModelFromSources extraction. Builds the index over
 * the whole document set (as the server did over all fixtures), then scopes to
 * the entry's import graph. Kept here as the parity oracle — do not "simplify"
 * it to call buildModelFromSources, or the test becomes a tautology.
 */
function legacyServerModel(entryUri, documents, lineage) {
  const ws = createWorkspaceIndex();
  for (const doc of documents) {
    const tree = parse(doc.source);
    if (tree) indexFile(ws, doc.uri, tree);
  }
  const entry = documents.find((d) => d.uri === entryUri);
  const entryTree = parse(entry.source);
  const reachable = getImportReachableUris(entryUri, ws);

  if (lineage) {
    const models = [];
    for (const reachableUri of reachable) {
      const doc = documents.find((d) => d.uri === reachableUri);
      if (!doc) continue;
      const tree = parse(doc.source);
      if (!tree) continue;
      const scoped = createScopedIndex(ws, reachable);
      models.push(buildVizModel(reachableUri, tree, scoped));
    }
    return mergeVizModels(entryUri, models);
  }

  const scoped = createScopedIndex(ws, reachable);
  return buildVizModel(entryUri, entryTree, scoped);
}

// A minimal two-file workspace: the entry maps an imported schema to a local one.
const BASE = "file:///library/";
const ENTRY = `${BASE}pipeline.stm`;
const IMPORTEE = `${BASE}customers.stm`;
const DOCUMENTS = [
  {
    uri: ENTRY,
    source: [
      'import { customers } from "./customers.stm"',
      "schema users { id INT }",
      "mapping m { source { customers } target { users } id -> id }",
    ].join("\n"),
  },
  { uri: IMPORTEE, source: "schema customers { id INT }" },
];

describe("buildModelFromSources parity with the pre-extraction server algorithm", () => {
  // Single-file mode must match the server's import-scoped single-file build
  // exactly — the move to the browser changed where, not what, is computed.
  it("matches the legacy server model in single-file mode", () => {
    assert.deepStrictEqual(
      buildModelFromSources(ENTRY, DOCUMENTS, { lineage: false }),
      legacyServerModel(ENTRY, DOCUMENTS, false),
    );
  });

  // Cross-file-lineage mode must match the server's reachable-merge exactly,
  // including the imported document's contributed schema and its source URI.
  it("matches the legacy server model in cross-file-lineage mode", () => {
    assert.deepStrictEqual(
      buildModelFromSources(ENTRY, DOCUMENTS, { lineage: true }),
      legacyServerModel(ENTRY, DOCUMENTS, true),
    );
  });
});

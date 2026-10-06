/**
 * Server-level tests for which open documents get fresh diagnostics after the
 * workspace index changes (bsw-r1wl).
 *
 * An open file's semantic diagnostics depend on other files through the shared
 * index, so an edit to one file must republish the others. These tests run the
 * built server over stdio, because which documents are republished is decided
 * by the lifecycle handlers in server.ts, not by any provider function.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { startServer } = require("./support/stdio-client");

/** Write `files` into a fresh temp folder; returns the folder and a URI helper. */
function makeWorkspace(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "satsuma-lsp-republish-"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
  return { root, uri: (name) => pathToFileURL(path.join(root, name)).toString() };
}

const hasCode = (code) => (diags) => diags.some((d) => d.code === code);
const lacksCode = (code) => (diags) => !diags.some((d) => d.code === code);

describe("republishing other open documents after an edit (bsw-r1wl)", () => {
  let workspace;
  let client;

  before(async () => {
    workspace = makeWorkspace({
      // a imports x from b and also declares x: a duplicate while b has x.
      "a.stm": 'import { x } from "b.stm"\n\nschema x {\n  id INT\n}\n',
      "b.stm": "schema x {\n  id INT\n}\n",
      // c imports nothing but uses y, which no file declares yet.
      "c.stm":
        "schema t {\n  id INT\n}\n\nmapping m {\n  source { y }\n  target { t }\n  id -> id\n}\n",
    });
    client = await startServer(workspace.root);
    for (const name of ["a.stm", "b.stm", "c.stm"]) {
      client.open(workspace.uri(name), fs.readFileSync(path.join(workspace.root, name), "utf8"));
    }
    // Baselines: the setup really does produce the diagnostics we expect to change.
    await client.waitForDiagnostics(workspace.uri("a.stm"), 0, hasCode("duplicate-definition"));
    await client.waitForDiagnostics(workspace.uri("c.stm"), 0, lacksCode("missing-import"));
  });

  after(async () => {
    await client?.stop();
    fs.rmSync(workspace.root, { recursive: true, force: true });
  });

  it("clears an importer's duplicate-definition when the imported file renames its schema", async () => {
    // The ticket's case: only b is edited, yet a's duplicate depended on b's
    // content. Before the fix a kept the stale diagnostic until a was edited.
    const a = workspace.uri("a.stm");
    const c = workspace.uri("c.stm");
    const seenA = client.publishCount(a);
    const seenC = client.publishCount(c);
    client.change(workspace.uri("b.stm"), 2, "schema y {\n  id INT\n}\n");

    await client.waitForDiagnostics(a, seenA, lacksCode("duplicate-definition"));

    // Second case, same edit: c does not import b, but the folder-wide
    // missing-import rule now finds y in b. Refreshing only importers of the
    // changed file would miss this, which is why every open document is refreshed.
    const diags = await client.waitForDiagnostics(c, seenC, hasCode("missing-import"));
    assert.match(diags.find((d) => d.code === "missing-import").message, /b\.stm/);
  });

  it("restores an importer's duplicate-definition when the edited file is closed unsaved", async () => {
    // Closing b discards its unsaved rename, so the index reverts to b's
    // on-disk `schema x` and a's duplicate is real again. No document is
    // edited here, so only the close handler can bring a up to date.
    const a = workspace.uri("a.stm");
    const seenA = client.publishCount(a);
    client.notify("textDocument/didClose", { textDocument: { uri: workspace.uri("b.stm") } });

    await client.waitForDiagnostics(a, seenA, hasCode("duplicate-definition"));
  });
});

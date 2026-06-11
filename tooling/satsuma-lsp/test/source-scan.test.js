/**
 * source-scan.test.js — workspace scan discovers all Satsuma source files.
 *
 * sl-v215: the startup scan indexed only .stm, so a workspace of .satsuma
 * files got syntax highlighting but no cross-file features. These cases pin
 * the invariant that the scan and the registered extensions agree, and that
 * the traversal skip rules (hidden dirs, node_modules) still hold.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { findSatsumaSourceFiles } = require("../dist/source-scan");

describe("findSatsumaSourceFiles", () => {
  let root;

  before(() => {
    // Minimal on-disk workspace: both extensions at mixed depths, plus
    // locations the scan must ignore.
    root = fs.mkdtempSync(path.join(os.tmpdir(), "satsuma-scan-"));
    fs.writeFileSync(path.join(root, "pipeline.stm"), "");
    fs.writeFileSync(path.join(root, "ingest.satsuma"), "");
    fs.writeFileSync(path.join(root, "README.md"), "");
    fs.mkdirSync(path.join(root, "crm"));
    fs.writeFileSync(path.join(root, "crm", "orders.satsuma"), "");
    fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "dep", "x.stm"), "");
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "y.stm"), "");
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds .stm and .satsuma files at any depth (sl-v215)", () => {
    const found = findSatsumaSourceFiles(root).map((p) => path.relative(root, p)).sort();
    assert.deepEqual(found, ["crm/orders.satsuma", "ingest.satsuma", "pipeline.stm"]);
  });

  it("never descends into hidden directories or node_modules", () => {
    // Dependency and VCS trees can contain .stm fixtures; indexing them would
    // pollute cross-file navigation with definitions outside the workspace.
    const found = findSatsumaSourceFiles(root);
    assert.equal(found.some((p) => p.includes("node_modules") || p.includes(".git")), false);
  });

  it("returns an empty list for an unreadable or missing directory", () => {
    // A permission error must degrade to "no files", not crash server startup.
    assert.deepEqual(findSatsumaSourceFiles(path.join(root, "does-not-exist")), []);
  });
});

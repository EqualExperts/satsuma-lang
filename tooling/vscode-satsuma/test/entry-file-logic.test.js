/**
 * Tests for the pure entry-file selection rules (sl-1ycv).
 *
 * Since ADR-022 the CLI rejects directory arguments, so every extension CLI
 * invocation must name a .stm file. These rules decide which file that is;
 * regressions here mean the extension either prompts when it shouldn't or
 * silently picks a surprising workspace root.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyEntryFileCandidates,
  orderCandidatesForPick,
} = require("../dist/client/commands/entry-file-logic.js");

describe("classifyEntryFileCandidates", () => {
  // The user is looking at a .stm file — that file is the least surprising
  // workspace root and must win without prompting.
  it("uses the active editor's file when it is a .stm file", () => {
    const res = classifyEntryFileCandidates("/ws/crm/pipeline.stm", [
      "/ws/crm/pipeline.stm",
      "/ws/platform.stm",
    ]);
    assert.deepEqual(res, { kind: "active", fsPath: "/ws/crm/pipeline.stm" });
  });

  // A non-.stm active editor (e.g. README.md) must not be passed to the CLI —
  // that is exactly the class of bad argument ADR-022 rejects.
  it("ignores a non-.stm active editor and falls through to the workspace files", () => {
    const res = classifyEntryFileCandidates("/ws/README.md", ["/ws/pipeline.stm"]);
    assert.deepEqual(res, { kind: "single", fsPath: "/ws/pipeline.stm" });
  });

  it("uses the only .stm file in the workspace without prompting", () => {
    const res = classifyEntryFileCandidates(undefined, ["/ws/pipeline.stm"]);
    assert.deepEqual(res, { kind: "single", fsPath: "/ws/pipeline.stm" });
  });

  // Multiple candidates and nothing active: the extension must ask rather
  // than guess (a wrong guess silently changes lineage/validation scope).
  it("reports ambiguity when several .stm files exist and none is active", () => {
    const res = classifyEntryFileCandidates(undefined, [
      "/ws/billing/pipeline.stm",
      "/ws/platform.stm",
    ]);
    assert.equal(res.kind, "ambiguous");
    assert.equal(res.candidates.length, 2);
  });

  it("reports none for a workspace without .stm files", () => {
    assert.deepEqual(classifyEntryFileCandidates(undefined, []), { kind: "none" });
  });
});

describe("orderCandidatesForPick", () => {
  // Platform entry points conventionally live at the workspace root
  // (platform.stm importing per-domain pipelines), so shallower paths must
  // sort first to put the likely entry file at the top of the quick pick.
  it("orders candidates shallowest-first, then alphabetically", () => {
    const ordered = orderCandidatesForPick([
      "/ws/crm/deep/nested.stm",
      "/ws/billing/pipeline.stm",
      "/ws/platform.stm",
      "/ws/aardvark.stm",
    ]);
    assert.deepEqual(ordered, [
      "/ws/aardvark.stm",
      "/ws/platform.stm",
      "/ws/billing/pipeline.stm",
      "/ws/crm/deep/nested.stm",
    ]);
  });
});

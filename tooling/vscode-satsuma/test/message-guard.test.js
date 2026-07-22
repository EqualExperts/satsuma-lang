/**
 * message-guard.test.js — provenance rule for webview `message` events.
 *
 * sl-mrn3 introduced the guard; sl-b90g corrected its invariant. The webview
 * entry points must only act on messages posted by the extension host — which
 * arrive carrying the webview's own origin — and ignore messages posted by any
 * other window (e.g. content embedded in the webview), which carry a different
 * origin. These cases pin the origin-matching rule all four webview scripts
 * rely on.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isExtensionHostMessage } = require("../dist/client/webview/message-guard.js");

// The webview's own origin. VS Code assigns each webview a unique
// `vscode-webview://<uuid>` origin; the concrete value is opaque here, so we
// use a representative stand-in and assert only on the equality contract.
const SELF_ORIGIN = "vscode-webview://11111111-2222-3333-4444-555555555555";

describe("isExtensionHostMessage", () => {
  // The legitimate path: the extension host's messages are delivered into the
  // webview's own frame, so they share the webview's own origin.
  it("accepts a message whose origin matches the webview's own origin", () => {
    assert.equal(isExtensionHostMessage({ origin: SELF_ORIGIN }, SELF_ORIGIN), true);
  });

  // The attack path the guard exists for: another window (an embedded iframe,
  // or foreign content) posts into the webview — its origin differs.
  it("rejects a message posted from a different origin", () => {
    const foreignOrigin = "https://evil.example.com";
    assert.equal(isExtensionHostMessage({ origin: foreignOrigin }, SELF_ORIGIN), false);
  });

  // An empty-string origin (some synthetic or sandboxed dispatches) must not be
  // treated as trusted when the webview has a concrete origin of its own.
  it("rejects a message with an empty origin", () => {
    assert.equal(isExtensionHostMessage({ origin: "" }, SELF_ORIGIN), false);
  });
});

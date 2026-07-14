/**
 * message-guard.test.js — provenance rule for webview `message` events.
 *
 * sl-mrn3: the webview entry points must only act on messages relayed by the
 * extension host (the webview's parent frame) and ignore messages posted by
 * any other window, e.g. content embedded in the webview. These cases pin
 * the source-matching rule all four webview scripts rely on.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { isExtensionHostMessage } = require("../dist/client/webview/message-guard.js");

describe("isExtensionHostMessage", () => {
  // The legitimate path: the extension host's messages arrive with the
  // webview's parent frame as their source.
  it("accepts a message whose source is the webview's parent frame", () => {
    const parent = { name: "parent-frame" };
    assert.equal(isExtensionHostMessage({ source: parent }, parent), true);
  });

  // The attack path the guard exists for: an embedded iframe (or any other
  // window) posts into the webview — its source is not the parent frame.
  it("rejects a message posted by a different window", () => {
    const parent = { name: "parent-frame" };
    const foreign = { name: "embedded-iframe" };
    assert.equal(isExtensionHostMessage({ source: foreign }, parent), false);
  });

  // MessageEvents constructed without a source (e.g. synthetic dispatch)
  // carry source: null — identity comparison must not treat null as trusted.
  it("rejects a synthetic message with a null source", () => {
    const parent = { name: "parent-frame" };
    assert.equal(isExtensionHostMessage({ source: null }, parent), false);
  });
});

/**
 * pan-gesture.test.js — which presses pan the canvas (gh-513, sl-u3x8).
 *
 * These pin the decisions only. Whether a real drag moves the canvas, which
 * cursor shows, and whether a card's click is suppressed are only observable
 * in a browser; the viz-harness "Canvas panning" Playwright suite covers them.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const { startsPan, isEmptyCanvasElement, isTextEntryTarget } =
  await import("../dist/satsuma-viz.js");

const press = (overrides) => ({
  button: 0,
  altKey: false,
  spaceHeld: false,
  onEmptyCanvas: false,
  ...overrides,
});

describe("startsPan", () => {
  it("pans on a plain left-drag from empty canvas, the gesture #513 asked for", () => {
    assert.equal(startsPan(press({ onEmptyCanvas: true })), true);
  });

  it("does not pan on a plain left press on a card, so its click and text selection survive", () => {
    assert.equal(startsPan(press({ onEmptyCanvas: false })), false);
  });

  it("pans from anywhere with Space held, the hand tool", () => {
    assert.equal(startsPan(press({ spaceHeld: true })), true);
  });

  it("keeps the older middle-drag and Alt+drag bindings, which pan from anywhere", () => {
    assert.equal(startsPan(press({ button: 1 })), true);
    assert.equal(startsPan(press({ altKey: true })), true);
  });

  it("never pans on the secondary button, which belongs to the context menu", () => {
    assert.equal(startsPan(press({ button: 2, onEmptyCanvas: true, spaceHeld: true })), false);
  });
});

describe("isEmptyCanvasElement", () => {
  it("treats each view's background as empty canvas", () => {
    // Overview canvas, detail grid gap, chain rail gap, and the pan overlay.
    for (const cls of ["card-layer", "column", "chain-column", "pan-overlay"]) {
      assert.equal(isEmptyCanvasElement(["some-other", cls]), true, cls);
    }
  });

  it("treats anything not on the allow-list as content, so new elements keep their clicks", () => {
    assert.equal(isEmptyCanvasElement(["field-row", "hl"]), false);
    assert.equal(isEmptyCanvasElement([]), false);
  });
});

describe("isTextEntryTarget", () => {
  it("leaves Space to typing in form fields and editable regions", () => {
    assert.equal(isTextEntryTarget({ tagName: "input", isContentEditable: false }), true);
    assert.equal(isTextEntryTarget({ tagName: "DIV", isContentEditable: true }), true);
  });

  it("arms the hand tool when Space lands on ordinary page content", () => {
    assert.equal(isTextEntryTarget({ tagName: "BODY", isContentEditable: false }), false);
    assert.equal(isTextEntryTarget(null), false);
  });
});

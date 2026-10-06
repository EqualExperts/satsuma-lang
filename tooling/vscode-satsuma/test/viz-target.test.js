/**
 * viz-target.test.js — which file the mapping visualisation shows (bsw-a2zk).
 *
 * The Explorer's "Overview Visualization" entry passes the right-clicked
 * file's URI to `satsuma.showViz`, but the panel ignored it and used the
 * active editor or the last file shown. Right-clicking a file that was not
 * open showed an empty-state message or the wrong file. These cases pin the
 * precedence the panel now follows.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { chooseVizTargetUri } = require("../dist/client/webview/viz/viz-target.js");

describe("chooseVizTargetUri", () => {
  it("prefers the URI the command was invoked with over the active editor and last file", () => {
    // The Explorer case: the reader right-clicked a file other than the one
    // open in the editor, and that file is the one they asked to see.
    assert.equal(
      chooseVizTargetUri({
        requestedUri: "file:///explorer.stm",
        activeSatsumaUri: "file:///open.stm",
        lastUri: "file:///previous.stm",
      }),
      "file:///explorer.stm",
    );
  });

  it("falls back to the active Satsuma editor when the command carries no URI", () => {
    // The command palette and save/editor watchers invoke a refresh with no
    // URI; the active editor stays the default target.
    assert.equal(
      chooseVizTargetUri({
        requestedUri: undefined,
        activeSatsumaUri: "file:///open.stm",
        lastUri: "file:///previous.stm",
      }),
      "file:///open.stm",
    );
  });

  it("falls back to the last file shown when nothing else names one", () => {
    // Refresh from inside the webview, where the panel itself has focus.
    assert.equal(
      chooseVizTargetUri({
        requestedUri: undefined,
        activeSatsumaUri: undefined,
        lastUri: "file:///previous.stm",
      }),
      "file:///previous.stm",
    );
  });

  it("returns undefined when there is no file to show", () => {
    // The panel then shows its "open a .stm file" message.
    assert.equal(
      chooseVizTargetUri({
        requestedUri: undefined,
        activeSatsumaUri: undefined,
        lastUri: undefined,
      }),
      undefined,
    );
  });
});

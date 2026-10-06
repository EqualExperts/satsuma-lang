/**
 * Unit tests for the debounce rule that republishes the other open documents
 * after a workspace-index change (bsw-r1wl). The server wiring is covered by
 * server-republish.test.js; these pin the timing and skip rules with a fake
 * clock, which a running server cannot do deterministically.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DependentDiagnosticsRefresher,
  DEPENDENT_REFRESH_DELAY_MS,
} = require("../dist/diagnostic-refresh");

/** A manual clock: callbacks run only when `advance` passes their due time. */
function fakeTimers() {
  let now = 0;
  let nextHandle = 0;
  const due = new Map();
  return {
    set(callback, delayMs) {
      const handle = ++nextHandle;
      due.set(handle, { at: now + delayMs, callback });
      return handle;
    },
    clear(handle) {
      due.delete(handle);
    },
    advance(ms) {
      now += ms;
      for (const [handle, entry] of [...due]) {
        if (entry.at <= now) {
          due.delete(handle);
          entry.callback();
        }
      }
    },
  };
}

function setup(openUris) {
  const timers = fakeTimers();
  const published = [];
  const refresher = new DependentDiagnosticsRefresher({
    openUris: () => openUris,
    publish: (uri) => published.push(uri),
    timers,
  });
  return { timers, published, refresher };
}

describe("DependentDiagnosticsRefresher", () => {
  it("republishes every other open document, importer or not, once the delay passes", () => {
    // c imports nothing, but folder-wide rules (missing-import) can still change
    // its result, so it is refreshed alongside a.
    const { timers, published, refresher } = setup([
      "file:///a.stm",
      "file:///b.stm",
      "file:///c.stm",
    ]);
    refresher.indexChanged("file:///b.stm");
    timers.advance(DEPENDENT_REFRESH_DELAY_MS - 1);
    assert.deepEqual(published, [], "nothing is sent before the delay elapses");
    timers.advance(1);
    assert.deepEqual(published, ["file:///a.stm", "file:///c.stm"]);
  });

  it("coalesces a burst of edits into one refresh pass", () => {
    // Each keystroke restarts the wait, so typing does not recompute every
    // open document's diagnostics on every key.
    const { timers, published, refresher } = setup(["file:///a.stm", "file:///b.stm"]);
    for (let i = 0; i < 5; i++) {
      refresher.indexChanged("file:///b.stm");
      timers.advance(DEPENDENT_REFRESH_DELAY_MS - 1);
    }
    assert.deepEqual(published, []);
    timers.advance(1);
    assert.deepEqual(published, ["file:///a.stm"]);
  });

  it("refreshes a document published for an earlier change in the burst", () => {
    // a was published when a changed, but b changed afterwards and may have
    // altered a's result; only the latest change's document is up to date.
    const { timers, published, refresher } = setup(["file:///a.stm", "file:///b.stm"]);
    refresher.indexChanged("file:///a.stm");
    refresher.indexChanged("file:///b.stm");
    timers.advance(DEPENDENT_REFRESH_DELAY_MS);
    assert.deepEqual(published, ["file:///a.stm"]);
  });

  it("refreshes every open document when no document was published for the change", () => {
    // A closed file changed on disk, or a document was closed: nothing the
    // user sees is current.
    const { timers, published, refresher } = setup(["file:///a.stm", "file:///b.stm"]);
    refresher.indexChanged(null);
    timers.advance(DEPENDENT_REFRESH_DELAY_MS);
    assert.deepEqual(published, ["file:///a.stm", "file:///b.stm"]);
  });

  it("matches the skipped document across URI spellings", () => {
    // Open-document keys are canonical, but the client may spell the edited
    // URI differently (Windows drive letters, sl-ku3c); the edited document
    // must still be skipped rather than published twice.
    const { timers, published, refresher } = setup(["file:///C:/p/a.stm", "file:///C:/p/b.stm"]);
    refresher.indexChanged("file:///c%3A/p/b.stm");
    timers.advance(DEPENDENT_REFRESH_DELAY_MS);
    assert.deepEqual(published, ["file:///C:/p/a.stm"]);
  });
});

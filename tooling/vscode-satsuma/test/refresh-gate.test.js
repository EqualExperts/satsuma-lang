/**
 * refresh-gate.test.js — latest-wins ordering for overlapping viz loads.
 *
 * sl-jar4: save/editor watchers plus manual refresh can trigger overlapping
 * LSP loads with no cancellation, so a slow earlier response could render
 * after a newer one and leave the webview showing stale data. These cases
 * pin the ordering rule the panel relies on: only the newest load (or a
 * dependent request whose base model is still current) may publish.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { RefreshGate } = require("../dist/client/webview/viz/refresh-gate.js");

/** A manually-resolvable promise, to script completion order in tests. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe("RefreshGate", () => {
  it("discards an earlier load that completes after a newer one (sl-jar4)", async () => {
    // The exact bug scenario: load A starts (slow), load B starts (fast),
    // B completes and renders, then A completes — A's result must be dropped
    // so the webview keeps B's newer model.
    const gate = new RefreshGate();
    const rendered = [];

    const slowResponse = deferred();
    const fastResponse = deferred();

    const loadA = (async () => {
      const token = gate.begin();
      const model = await slowResponse.promise;
      if (gate.isCurrent(token)) rendered.push(model);
    })();
    const loadB = (async () => {
      const token = gate.begin();
      const model = await fastResponse.promise;
      if (gate.isCurrent(token)) rendered.push(model);
    })();

    fastResponse.resolve("newer-model");
    await loadB;
    slowResponse.resolve("stale-model");
    await loadA;

    assert.deepEqual(rendered, ["newer-model"]);
  });

  it("lets sequential loads each publish in turn", () => {
    // Non-overlapping refreshes are the common case and must all render —
    // the gate only suppresses results that have been superseded.
    const gate = new RefreshGate();
    const first = gate.begin();
    assert.equal(gate.isCurrent(first), true);
    const second = gate.begin();
    assert.equal(gate.isCurrent(second), true);
    assert.equal(gate.isCurrent(first), false);
  });

  it("invalidates a dependent request when its base model is superseded", () => {
    // Lineage expansion reads the latest token without superseding it: an
    // expansion started against model N must be dropped once a refresh has
    // replaced the model, but must not itself block that refresh.
    const gate = new RefreshGate();
    gate.begin();

    const expansionBase = gate.latest();
    assert.equal(gate.isCurrent(expansionBase), true, "no refresh yet — expansion may publish");

    gate.begin();
    assert.equal(gate.isCurrent(expansionBase), false, "model replaced — expansion is stale");
  });
});

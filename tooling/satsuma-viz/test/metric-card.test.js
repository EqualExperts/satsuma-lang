/**
 * metric-card.test.js — sz-metric-card interaction contract.
 *
 * Collapse and navigation are separate intents on every card component
 * (sl-tw0r established the contract for schema and fragment cards); these
 * tests pin the same contract for metric cards (sl-37f3). On hosts that open
 * documents on navigate (VS Code), a combined handler made it impossible to
 * collapse a metric card without yanking the editor to its source location.
 */
import "./dom-shim.js";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

const loc = { uri: "file:///metrics.stm", line: 7, character: 0 };

/** Minimal MetricCard payload — interaction tests don't need fields or notes. */
const metric = {
  id: "conversion_rate",
  qualifiedId: "conversion_rate",
  label: null,
  source: [],
  grain: null,
  slices: [],
  filter: null,
  fields: [],
  notes: [],
  comments: [],
  location: loc,
};

async function makeCard() {
  const mod = await import("../dist/satsuma-viz.js");
  const card = new mod.SzMetricCard();
  card.metric = metric;
  const navigations = [];
  card.addEventListener("navigate", (e) => navigations.push(e));
  return { card, navigations };
}

describe("sz-metric-card collapse vs navigate intent (sl-37f3)", () => {
  it("collapses on toggle-arrow click without dispatching navigation", async () => {
    const { card, navigations } = await makeCard();

    let propagationStopped = false;
    card._onToggleClick({ stopPropagation: () => { propagationStopped = true; } });

    assert.equal(card._collapsed, true, "arrow click must flip the collapsed state");
    assert.equal(navigations.length, 0, "arrow click must never navigate");
    assert.ok(
      propagationStopped,
      "arrow click must stop propagation so the header navigate handler never sees it",
    );
  });

  it("expands a collapsed card on a second toggle click, still without navigating", async () => {
    const { card, navigations } = await makeCard();
    const click = { stopPropagation: () => {} };

    card._onToggleClick(click);
    card._onToggleClick(click);

    assert.equal(card._collapsed, false, "second arrow click must expand again");
    assert.equal(navigations.length, 0);
  });

  it("navigates to the metric source on header click without toggling collapse", async () => {
    const { card, navigations } = await makeCard();

    card._onHeaderClick();

    assert.equal(navigations.length, 1, "header click is navigation intent");
    assert.deepEqual(navigations[0].location, loc);
    assert.equal(card._collapsed, false, "header click must not collapse the card");
  });
});

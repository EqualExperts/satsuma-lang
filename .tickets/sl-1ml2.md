---
id: sl-1ml2
status: closed
deps: []
links: []
created: 2026-07-31T13:13:41Z
type: chore
priority: 3
assignee: Thorben Louw
parent: sl-3de8
tags: [feature-36, docs]
---
# docs: roadmap note for future playground coverage exposure

PRD 36 open question 1, resolved in user review: exposing coverage mode in the public site playground is a separate future feature. Record it in docs/product-owner/ROADMAP.md so the decision is not lost, referencing feature 36 and the Feature 34 playground UX bar.

## Acceptance Criteria

ROADMAP.md entry added describing the deferred playground exposure and its dependency on feature 36 shipping in harness and VS Code first.


## Notes

**2026-08-05T14:57:45Z**

Cause: PRD 36's open question framed playground exposure of "coverage mode" as one deferred decision, but the coverage overlay toggle is unconditional in satsuma-viz's toolbar and reads model-embedded coverage (ADR-042), so it already works in the playground and harness dev preview with no host wiring; only the field-chain view is actually missing there — the schema card's field-lineage DOM event reaches the harness/playground client (app.ts) but is only recorded for Playwright assertions, never turned into a computed FieldChainModel and an openFieldChain() call the way VS Code's satsuma/fieldChain LSP request does.
Fix: rewrote the ROADMAP.md Feature 36 entry to scope the deferral to the field-chain view only (not coverage, which already ships), name the missing piece (a browser-side computation reusing buildFieldChainFromSources from @satsuma/viz-backend, plus a playground UX decision under Feature 34's playground UX bar), and its dependency on Feature 36 shipping the chain view in the harness (sl-nswc, still open) and VS Code first. (commit immediately after 08a96c72)

**2026-08-05T15:30:21Z**

Superseded same-day: sl-nswc (merged 7f7bfc95) wired the harness client's field-lineage click handler to buildFieldChain/openFieldChain (tooling/satsuma-viz-harness/src/client/app.ts), purely client-side via @satsuma/viz-backend's buildFieldChainFromSources — no host gating. The static playground bundle is that exact same app.js (build-playground.mjs), so the field chain view now works in the playground too, with no separate exposure work. This ticket's premise ("field-chain exposure needs its own future feature") is therefore moot, not just the coverage-overlay half corrected in the earlier note. ROADMAP.md's Feature 36 entry records this when the feature moved to Shipped (commit immediately after 0fc7e6d0, merged into fix/sl-chain-view-connectors).

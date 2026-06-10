---
id: sl-ohxn
status: closed
deps: []
links: []
created: 2026-06-10T07:19:03Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ubbp
tags: [playground, chrome]
---
# Branded minimal playground header: logo + Satsuma, drop internal chrome (R4)

Replace the 'satsuma viz harness' h1 with the Satsuma logo (site/img/satsuma-logo.png) + wordmark 'Satsuma' (user decision 2026-06-10). Remove #view-mode-toggle (lineage/single — default to lineage) and the visible #harness-ready-badge from index.html:423-432. Theme toggle and local-only notice stay. See PRD P4/R4.

## Acceptance Criteria

Header shows logo + 'Satsuma' only; no lineage/single toggle; no visible ready badge; data-ready-state automation attribute unchanged and Playwright helpers updated to wait on it; existing harness tests green.


## Notes

**2026-06-10T08:09:18Z**

Cause: harness chrome kept its internal-test-rig heritage (wordmark "satsuma viz harness", lineage/single toggle, visible ready badge) on a public product surface.
Fix: header is now the Satsuma logo (copied at build time from site/img, served + bundled into the static playground) + "Satsuma" wordmark; view-mode toggle removed (lineage default; automation switches via ?mode= or the new __satsumaHarness.setViewMode hook — 26 Playwright call sites rewritten); ready badge removed (data-ready-state attribute contract unchanged). Verified 89/89 watcher run incl. 2 new chrome tests.

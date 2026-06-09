---
id: sl-xq0k
status: in_progress
deps: [sl-1qte, sl-nopd, sl-kd45, sl-ncu9]
links: []
created: 2026-06-09T21:15:33Z
type: task
priority: 2
assignee: Thorben Louw
tags: [live-editor, testing]
---
# Feature 33 — Playwright static-build project, harness additions, network-isolation test

Add the cross-feature Playwright coverage the live editor needs. (1) A second Playwright project that serves the static /playground/ bundle over a plain file server under a NON-ROOT base path (the current suite only runs Firefox against node dist/server.js) for the static smoke check. (2) Harness additions: live re-render on edit, horizontal-scroll alignment, Open (loads text, no upload), Save (download), collapse/expand reflow of the viz, localStorage seeding + edited-example-survives-reload, and cross-file lineage resolved entirely in-browser. (3) A network-isolation assertion proving NO network request carries source content during edit/Open/Save — the privacy guarantee enforced by a test, not just prose.

## Design

Run via the existing sentinel-watcher workflow (.run-tests / .playwright-results.txt). Apply repo test-quality standards: each case carries a purpose comment, inputs are minimal Satsuma snippets, no smoke/redundant tests. FSA is Chromium-only so the open/save tests exercise the <input>/anchor fallback in Firefox.

## Acceptance Criteria

a static-build Playwright project loads the published bundle under a non-root base path and renders a seeded example; harness tests cover live re-render, horizontal-scroll alignment, Open, Save, collapse reflow, seeding + edited-example-survives-reload, and in-browser cross-file lineage; a network-isolation test asserts no request carries source content during edit/Open/Save.


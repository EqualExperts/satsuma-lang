---
id: sl-ncu9
status: closed
deps: [sl-dn29, sl-kd45]
links: []
created: 2026-06-09T21:15:33Z
type: task
priority: 1
assignee: Thorben Louw
tags: [live-editor, harness, site]
---
# Feature 33 — static server-free 'Try it Live!' build + on-page privacy note

Add a harness build target that emits a server-free static bundle: client app.js, satsuma-viz.js, the two WASM files, index.html, and the bundled examples JSON — everything needed to run with no Node process. The picker is backed entirely by the localStorage library (seeded from the bundled JSON); there is no /api/fixtures or /api/source in this build. The page must visibly state that editing is local-only and source is never uploaded (privacy/trust statement).

## Design

Must work under a non-root GitHub Pages base path (site served from /satsuma-lang/): all asset URLs (WASM via locateFile, scripts, examples JSON) resolve page-relative (./...), not absolute /... roots. The Node dev server's fixture API remains only for the local Playwright harness.

## Acceptance Criteria

a build target emits a static, backend-free /playground/ bundle that runs with no Node process; assets resolve under a non-root base path (page-relative); the picker is backed by the localStorage library with no fixture server; the page visibly states editing is local-only and never uploaded (AC 11).


## Notes

**2026-06-10T01:00:00+01:00**

Cause: Feature work — the playground needed a deployable, backend-free bundle for the website (PRD §"Try it Live"), and index.html still used root-absolute script refs that would 404 under a non-root GitHub Pages base path.
Fix: build:playground assembles dist/playground/ (page, client+viz bundles, both WASM files, examples manifest) via scripts/build-playground.mjs, which validates base-path safety and refuses root-absolute asset refs; script tags made page-relative; always-visible privacy note added (AC 11) with a Playwright assertion (commit 8908ba8)

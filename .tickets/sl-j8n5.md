---
id: sl-j8n5
status: closed
deps: [sl-dn29]
links: []
created: 2026-06-09T21:15:33Z
type: task
priority: 2
assignee: Thorben Louw
tags: [live-editor, testing]
---
# Feature 33 — client==server model-parity test, then retire /api/model

Assert the browser model pipeline and the existing server /api/model produce the same VizModel for canonical fixtures (single-file and lineage), enforcing that moving model-building to the browser did not change output. Keep /api/model as the parity oracle only as long as this test needs it, then retire/scope it once the client pipeline is authoritative (PRD decision #6).

## Acceptance Criteria

a parity test asserts client-built and server-built VizModels match for canonical single-file and cross-file-lineage fixtures; once green and authoritative, /api/model is removed or explicitly scoped to test-only with a note; the file:/// URI standardisation keeps URIs identical across runtimes so the comparison is apples-to-apples.


## Notes

**2026-06-09T22:09:42Z**

**2026-06-09T22:09:42Z**

Cause: model-building moved to the browser in sl-dn29; needed a regression guard that the extraction preserved output, and the server /api/model endpoint became dead code (no client/test consumer).
Fix: added model-parity.test.js deep-equating buildModelFromSources to a frozen transcription of the original server algorithm (single + lineage), then removed /api/model plus the server-side workspace index, indexFixtures, and parser init (commit e6afb1b).

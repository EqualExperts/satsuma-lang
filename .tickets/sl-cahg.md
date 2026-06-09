---
id: sl-cahg
status: open
deps: [sl-dn29, sl-kd45, sl-ncu9]
links: []
created: 2026-06-09T21:15:33Z
type: task
priority: 2
assignee: Thorben Louw
tags: [live-editor, adr]
---
# Feature 33 — ADRs: client-side pipeline + isomorphic resolver, client-only persistence

Draft the ADRs this feature's architectural boundaries require (run /adr-draft to confirm). (1) Client-side VizModel pipeline & server-free playground build — new browser-only consumer topology for the viz packages; records moving parse + buildVizModel into the browser and the static backend-free build, and the isomorphic URL-based import resolver (replacing Node path/url) as load-bearing. Builds on ADR-002/018/020. (2) Client-only document library & persistence (no server storage) — the in-browser localStorage library seeded from bundled examples and the data-residency/privacy decision that content is never transmitted; references and scopes ADR-022 (in-memory vs file-based workspace) WITHOUT superseding it. May be one combined ADR if /adr-draft judges them a single decision (count 1-2). (3) Candidate: no editor framework — zero-dependency highlighted overlay (assess vs capturing in this PRD).

## Design

ADR-022 is NOT superseded and its body stays immutable; the new ADR states the relationship: scope-resolution semantics (import-graph reachability) still hold, only the source medium of documents changes. If /adr-draft finds ADR-002/012/018 genuinely contradicted (not just extended), mark Status lines per the ADR workflow.

## Acceptance Criteria

ADR(s) drafted in adrs/ for the client-side pipeline + isomorphic resolver and the client-only persistence/privacy decision (1-2 ADRs); ADR-022 referenced and scoped, not superseded; the no-framework-overlay decision is captured (standalone ADR or in-PRD per /adr-draft); ADR files included in the feature PR.


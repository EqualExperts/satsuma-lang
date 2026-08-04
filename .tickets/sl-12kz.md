---
id: sl-12kz
status: open
deps: []
links: []
created: 2026-08-03T12:24:14Z
type: epic
priority: 2
assignee: Thorben Louw
tags: [viz, field-lineage]
---
# Feature 40 — shared field lineage view

Field lineage is the only viz surface with no test surface. The renderer lives only in vscode-satsuma (560-line renderer + 284-line panel + 330-line CSS, zero tests); the traversal lives in satsuma-cli/src/commands/field-lineage.ts coupled to CLI-only modules, so no browser host can call it. See features/40-shared-field-lineage-view/PRD.md.

Outcome: one browser-portable traversal, one sz-field-lineage component rendered by BOTH the VS Code panel and the viz harness, and Playwright coverage for the lineage view.


## Notes

**2026-08-03T22:31:14Z**

sl-4871 spike finding — the portable home for the field-lineage traversal.

Full write-up: features/40-shared-field-lineage-view/SPIKE-sl-4871-portable-home.md
(no production code, per the spike's acceptance criteria).

Recommendation: split the work and put both halves in satsuma-core, NOT in
satsuma-viz-backend.

1. traceFieldLineage(edges, start, {depth, direction}) — pure, over a plain edge
   list. Every logged traversal defect (sl-y89y, sg-pufq) lives here and this half
   has no coupling to argue about.
2. buildFieldEdges(source) over a narrow FieldEdgeSource interface (deduplicated
   arrow records, a mappingSides(key) lookup, resolved NL refs) that the CLI
   satisfies from ExtractedWorkspace and viz-backend from WorkspaceIndex — so
   neither index shape enters core. This is the step that deletes the
   graph-builder.ts / field-lineage.ts duplication, which is what sl-prlp's "no
   second copy remains" really asks for. Do not stop after step 1.

Dependency classification: spread-expand portable (its one CLI import is a
re-export of core's resolveScopedEntityRef); nl-ref-extract portable once
index-builder is; index-builder has exactly ONE node:path call (line 439, resolving
import paths) and viz-backend already does that job browser-portably with
new URL(pathText, importerUri) — a precedented one-line substitution, not a
parameter to thread; load-workspace stays in the CLI, it IS the filesystem adapter.

Not viz-backend, because it is a devDependency of satsuma-cli: putting lineage
there would make the published CLI bundle carry the VizModel assembly. Core also
already holds qualifyField, resolveScopedEntityRef and schemaLocalFieldPath, and
has a typecheck gate keeping Node built-ins off its import path.

**2026-08-04T09:28:51Z**

sl-prlp re-planned against the sl-4871 spike and Feature 41 R6 (ticket text only, no code).

Settled: the traversal goes to satsuma-core, in two steps — a pure
traceFieldLineage(edges, start, opts), then the edge builder behind a narrow
FieldEdgeSource interface so no workspace index type enters core. Step 2 is what
deletes the graph-builder.ts / field-lineage.ts duplication and is not optional.

New since the spike: R6 (sl-jyee) put endpoint resolution behind arrowEndpoint in
satsuma-cli/src/field-endpoints.ts, which holds the *undecided* r0-7w76 reading that
core deliberately refuses to make. So that module stays in the CLI and the core
builder takes endpoint resolution as an injected function. sl-prlp must not decide
r0-7w76; its pinned tests go red if it does.

Also raised spr-w98t (P1 bug): sl-y89y's DepthAwareTraversal fix reached
commands/lineage.ts only, so the field traversal still has the first-visit-wins shape
that truncates subtrees reachable within depth via a shorter path. It cannot ride in
sl-prlp (byte-identical output) and Feature 41 R4 asserts depth exactness, so the
chain is now sl-prlp -> spr-w98t -> sl-jsyn.

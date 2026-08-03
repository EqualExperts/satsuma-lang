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

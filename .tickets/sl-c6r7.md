---
id: sl-c6r7
status: closed
deps: [sl-wpa8]
links: []
created: 2026-06-09T21:14:51Z
type: task
priority: 1
assignee: Thorben Louw
tags: [live-editor, harness]
---
# Feature 33 — examples bundled-JSON manifest generator

Add a build step (analogous to scripts/generate-diary-manifest.py) that walks the examples/ corpus and serialises it into a static JSON asset shipped with the playground build: a manifest of { name, path, source } entries plus a librarySeedVersion stamp. This is the seed source for the localStorage document library and the playground picker. Seed the WHOLE corpus (~115 KB / 23 files, well under localStorage quota — PRD decision #7).

## Design

Document URIs in the manifest are derived from each example's path under a file:/// virtual base so they match the resolver's output (see resolver ticket). librarySeedVersion source (corpus content hash vs spec version) is decided here so version-bump re-seeding semantics are well defined.

## Acceptance Criteria

a generator produces a bundled examples JSON from examples/ with { name, path, source } entries and a librarySeedVersion; paths map to file:/// virtual URIs consistent with the resolver; the whole corpus is included; the generator is wired into the harness/static build.


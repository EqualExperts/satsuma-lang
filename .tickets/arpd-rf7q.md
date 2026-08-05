---
id: arpd-rf7q
status: open
deps: [arpd-pa0u]
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 1
assignee: Thorben Louw
parent: arpd-6iis
---
# Bake a section map (not one string) in satsuma-cli prebuild

Rework tooling/satsuma-cli/scripts/prebuild.js to read reference/*.md via a shared composer module (usable by both the CLI prebuild and a future repo-level regenerate script) and bake an ordered section map (id, profiles, content) into src/generated/agent-reference.ts, replacing the single baked string.

## Acceptance Criteria

src/generated/agent-reference.ts exports a section map with id/profile metadata plus a helper to compose the full doc; existing CLI build passes; no hand-written duplication of reference/ content in the generated file's authoring (only serialized data).


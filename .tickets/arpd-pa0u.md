---
id: arpd-pa0u
status: closed
deps: []
links: []
created: 2026-08-05T09:56:50Z
type: task
priority: 1
assignee: Thorben Louw
parent: arpd-6iis
---
# Extract canonical reference/ sections from AI-AGENT-REFERENCE.md

Split AI-AGENT-REFERENCE.md into 8 canonical section files under reference/: grammar.md, conventions.md, mistakes.md, examples.md, cli-index.md, cli-composition.md, workflow-generate.md, workflow-read.md. Cut by exact line ranges so no content is rewritten and concatenating all 8 in order reproduces the current file byte-for-byte.

## Acceptance Criteria

reference/ dir contains the 8 files; a test (or throwaway script run now) proves concatenating them in canonical order == current AI-AGENT-REFERENCE.md content byte-for-byte; no prose edited.


## Notes

**2026-08-05T09:59:37Z**

## Notes

**2026-08-05T10:15:00Z**

Cause: AI-AGENT-REFERENCE.md was a single hand-maintained file with no mechanism behind its own "include this section only if..." instruction — satsuma-cli's prebuild.js baked it whole into one exported string, so `satsuma agent-reference` could only print everything or nothing.
Fix: split the file into 8 canonical reference/*.md files (grammar, conventions, mistakes, examples, cli-index, cli-composition, workflow-generate, workflow-read) cut on exact line boundaries with no prose rewritten; added reference/manifest.mjs (section registry + profile assignment) and reference/compose.mjs (composeFull/composeProfile/composeSection helpers); added scripts/agent-reference-compose.test.mjs proving composeFull reproduces AI-AGENT-REFERENCE.md byte-for-byte (commit immediately after 00c5039e).

---
id: sl-m5yl
status: closed
deps: []
links: []
created: 2026-03-26T07:18:48Z
type: chore
priority: 2
assignee: Thorben Louw
tags: [docs, cleanup]
---
# Remove stale tree-sitter-ambiguities.md

docs/tree-sitter-ambiguities.md is a pre-implementation planning doc from before the grammar was built. All high-risk ambiguities have been resolved in the grammar or describe features never implemented (when clauses, line continuation). The code blocks use v1/hypothetical syntax. Corpus tests now document the resolved grammar. Remove this file.

## Acceptance Criteria

- tree-sitter-ambiguities.md removed
- No other docs reference it (check for broken links)

## Notes

**2026-03-26T08:30:00Z**

Cause: Pre-implementation planning doc with v1/hypothetical syntax; all ambiguities resolved in grammar or never implemented.
Fix: Removed docs/tree-sitter-ambiguities.md. References only exist in archived feature docs and closed tickets — no live doc links broken.

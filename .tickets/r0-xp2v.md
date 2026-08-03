---
id: r0-xp2v
status: open
deps: []
links: []
created: 2026-08-03T10:20:34Z
type: chore
priority: 1
assignee: Thorben Louw
---
# Release v0.12.0 with atomic version and changelog promotion

Prepare the v0.12.0 release and make future release preparation safe. The current bump script omits the independently released LSP package and creates an empty version heading instead of promoting accumulated Unreleased notes.

## Acceptance Criteria

scripts/bump-version.sh updates VERSION plus the CLI, standalone LSP, and VS Code extension package manifests and lockfiles; promoting a version moves the existing Unreleased body beneath a dated v0.12.0 heading while retaining a fresh empty Unreleased section; the release workflow rejects a requested tag that disagrees with VERSION or releasable package versions and rejects placeholder-only notes; automated tests cover LSP synchronization, changelog promotion, and mismatch failures; the repository is bumped to 0.12.0; relevant tests and artifact smoke tests pass.

---
id: r0-xp2v
status: closed
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

## Notes

**2026-08-03T10:30:57Z**

Cause: release preparation duplicated its contract between an incomplete shell package list and an inline workflow extractor. The shell omitted the standalone LSP, referenced a removed VS Code server package, and created a placeholder section without promoting Unreleased notes.
Fix: centralized releasable-package synchronization, atomic changelog promotion, metadata validation, and note extraction in a tested release helper; wired it into the bump script, CI, and release workflow; prepared v0.12.0 across all public artifacts (commit 0da4f263).

**2026-08-03T12:02:00Z**

The release branch was rebased onto main to pick up the nested-lineage fix (nfl-8o6u), which merged after this ticket closed and shipped without release notes. Its entry is now recorded under the v0.12.0 heading, verified via 'release-metadata.mjs notes v0.12.0'.

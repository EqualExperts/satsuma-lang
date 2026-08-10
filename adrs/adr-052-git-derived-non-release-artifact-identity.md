# ADR-052 — Git-Derived Identity for Non-Release Artifacts

**Status:** Accepted
**Date:** 2026-08-10 (sl-13p5)

## Context

Satsuma publishes three user-visible tooling artifacts from the same repository:
the `satsuma` CLI tarball, the standalone `satsuma-lsp` tarball, and the VS Code
extension VSIX. Their committed package manifests carry the canonical version
from `VERSION`, such as `0.13.0`. Before sl-13p5, ordinary builds from `main`
also reported that clean version, so a development artifact could not be
distinguished from the tagged release whose source it followed.

The identity must agree across independently built artifacts. Deriving it in
each package would allow the CLI, LSP, and extension to drift, while rewriting
the committed manifests or root lockfile during every local build would leave a
dirty worktree and blur the boundary between release metadata and build output.
The build graph adds another constraint: a development identity depends on the
current commit, but Git state is not one of Turborepo's file-hashed task inputs.
A cached build from the previous commit could therefore restore a stale version
even when every tracked input file was unchanged.

Three alternatives were considered. Build timestamps would distinguish
artifacts but would make equivalent builds irreproducible and would not identify
their source. CI run numbers would work only in GitHub Actions and would give
local builds a different convention. Making every package derive its own Git
version would avoid shared infrastructure, but would duplicate a release rule
that must remain identical across all published artifacts.

## Decision

Use one build identity for all distributable tooling. An exact `v<VERSION>` Git
tag, or an explicitly forced release build, uses the clean canonical `VERSION`.
Every other build uses the SemVer-compatible form `VERSION-dev.<shortsha>`. A
`BUILD_VERSION` environment variable may carry the already-resolved identity
across independent CI jobs and package build processes.

`scripts/release-metadata.mjs` is the single implementation of derivation and
manifest injection. The CLI bakes the identity into its generated TypeScript
source for `satsuma --version`; the LSP bakes the same identity into its
`initialize` response's `serverInfo.version`. npm tarballs and the VSIX are
assembled from staging directories whose copied manifests receive the derived
version, leaving `VERSION`, the root lockfile, and committed package manifests
unchanged. Release CI resolves the identity once, exports it to all build steps,
and verifies it against the built artifacts.

CLI, LSP, and VS Code extension build tasks that embed the Git-derived identity
must not use Turborepo's output cache. Their build definitions declare
`cache: false`, because the commit SHA is external state that Turborepo cannot
represent as a tracked file input. `VERSION` and the shared release-metadata
module remain global dependencies so changes to the canonical versioning rule
still invalidate the rest of the build graph normally.

## Consequences

**Positive:**

- Users and diagnostics can identify the exact source commit of any development
  CLI, LSP, or VSIX artifact.
- Tagged releases retain the clean version expected by package managers and the
  VS Code Marketplace.
- One derivation rule keeps independently built artifacts consistent in CI and
  local development.
- Staging preserves clean committed manifests and the single root lockfile.

**Negative:**

- The three identity-bearing build tasks always execute instead of receiving a
  Turborepo build-cache hit.
- Packaging code must continue to use the shared derivation and staging path;
  bypassing it can reintroduce an unqualified canonical version.
- Rebuilding the same tracked tree after a new commit produces a different
  artifact by design, even when the package's own source files did not change.

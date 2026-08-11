---
id: mbt-1s1s
status: closed
deps: []
links: []
created: 2026-08-04T20:26:42Z
type: task
priority: 4
assignee: Thorben Louw
---
# docs: CI-WORKFLOWS.md describes release.yml jobs that no longer exist

Found while doing Feature 42's R6 doc pass, but **pre-existing and unrelated to
Feature 42** — left alone so R6's diff stays about the workspaces/Turborepo flow.

`docs/developer/CI-WORKFLOWS.md` documents the release workflow as two jobs,
`build` and `vsix`, each "installing all workspace dependencies, building the WASM
parser…". `.github/workflows/release.yml` actually has `security`, `artifacts` and
`release`, and `artifacts` is a single job that runs `npm run ci:all` then
`./scripts/build-artifacts.sh` to produce all three artifacts.

The R6 pass corrected everything in that file that Feature 42 made false (the
install job, the lint job, the CLI job, the vscode job, the job graph, the caches,
the audit scope, the symlink rationale, the corpus and CLI test counts), so this is
the last known drift in it.

## Acceptance Criteria

- The release-workflow section names the jobs release.yml actually defines, with what each does
- Any other section of CI-WORKFLOWS.md checked against the current workflow files in the same pass


## Notes

**2026-08-11T10:21:00Z**

Cause: `docs/developer/CI-WORKFLOWS.md` had drifted from the workflow files. The release-workflow jobs (`build`/`vsix`) drift named in the ticket was already corrected in a later commit (the section now lists `security`/`artifacts`/`release`), so the remaining drift was elsewhere.

Fix: checked every section of CI-WORKFLOWS.md against the four workflow files in the same pass and corrected three drifts. (1) The Overview sentence named only the CLI tarball and `.vsix`; release.yml builds three artifacts, so added the standalone LSP tarball. (2) The CI job graph omitted the `viz-harness` job entirely (headless-Chromium Playwright suite, feature 30) — added the node to the mermaid graph. (3) Added a `viz-harness` prose subsection alongside the other CI jobs explaining what it runs and why it is its own job rather than a `tooling-modules` shard. The Security, Deploy-Site, and remainder of the CI sections were verified accurate against ci.yml/security.yml/deploy-site.yml and left unchanged. markdownlint and prettier clean. (commit immediately after c11de8c4)

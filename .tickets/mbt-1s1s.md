---
id: mbt-1s1s
status: open
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


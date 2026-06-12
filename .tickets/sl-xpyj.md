---
id: sl-xpyj
status: closed
deps: []
links: []
created: 2026-06-12T08:21:58Z
type: task
priority: 2
assignee: Thorben Louw
---
# Fix stale release-asset filenames in install docs (README, vscode README, CI-WORKFLOWS)

User-reported: 'npm install -g .../releases/download/latest/satsuma-cli.tgz' from README 404s. Release workflow suffixes assets with the release tag (satsuma-cli-latest.tgz, satsuma-cli-v0.9.0.tgz, ...). Site pages already use correct names; README.md, tooling/vscode-satsuma/README.md, and docs/developer/CI-WORKFLOWS.md release-artifacts table do not.

Acceptance criteria:
- README install command uses satsuma-cli-latest.tgz and the URL resolves (HTTP 200)
- vscode-satsuma README references vscode-satsuma-latest.vsix for the GitHub-release install path
- CI-WORKFLOWS release artifacts table documents the tag-suffixed asset names including the LSP tarball


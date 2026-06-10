---
id: sl-qpbx
status: open
deps: []
links: []
created: 2026-06-10T23:18:25Z
type: chore
priority: 1
assignee: Thorben Louw
tags: [security, ci]
---
# Extend npm audit and Dependabot coverage to all package directories

The CI security workflow runs npm audit (--omit=dev --audit-level=high) over only 5 directories: root, tooling/satsuma-cli, tooling/tree-sitter-satsuma, tooling/satsuma-lsp, tooling/vscode-satsuma. Six directories with their own lockfiles and real production dependencies have no continuous dependency monitoring: tooling/satsuma-core, tooling/satsuma-viz, tooling/satsuma-viz-backend, tooling/satsuma-viz-model, tooling/satsuma-viz-harness, and site. The same directories are also missing from .github/dependabot.yml, so they receive no automated update PRs. Found during the 2026-06-11 security review (SECURITY-REPORT.md, 'Known Gaps and Honest Caveats' item 2).

## Acceptance Criteria

security.yml npm-audit job covers every package directory that has a package-lock.json (core, viz, viz-backend, viz-model, viz-harness, site) — or documents an explicit exclusion reason inline. .github/dependabot.yml has an npm entry for each of those directories. CI passes with the expanded matrix. SECURITY-REPORT.md 'Known Gaps' item 2 and the CI controls table updated to reflect the closed gap.


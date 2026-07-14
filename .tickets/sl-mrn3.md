---
id: sl-mrn3
status: in_progress
deps: []
links: []
created: 2026-07-14T08:09:03Z
type: task
priority: 2
assignee: Thorben Louw
---
# Triage Semgrep code-scanning alerts (path traversal + postMessage origin)

19 open code-scanning alerts from Semgrep SARIF uploads: 15x path-join-resolve-traversal across cli/lsp/vscode/viz-harness/tree-sitter scripts, 4x insufficient-postmessage-origin-validation in vscode webview scripts. Fix legitimate findings (origin validation in webviews, path containment in viz-harness HTTP server), dismiss false positives with documented reasons. Acceptance: Security tab shows 0 open alerts; fixes covered by tests where the package has a test suite.


---
id: sl-89id
status: open
deps: []
links: []
created: 2026-06-11T02:43:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, vscode]
---
# vscode: coverage gutter decorations never cleared — stale across runs

vscode-satsuma/src/commands/coverage.ts applies mapped/unmapped gutter decorations per file but never clears previous state; only the status bar hides on editor switch. Running coverage on mapping A then mapping B leaves stale icons in files only in A schema set indefinitely. Also: one showTextDocument call per affected file in a loop churns the visible editor.

## Acceptance Criteria

Decorations cleared on each run (and a way to dismiss them); files from a previous run show no stale icons; editor focus not yanked per file.


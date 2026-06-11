---
id: sl-89id
status: closed
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


## Notes

**2026-06-11T21:45:25Z**

Cause: showCoverage applied gutter decorations per file but nothing ever removed them (only the status bar hid on editor switch), and one showTextDocument call per affected file churned the visible editor.
Fix: Decoration types are created per run and disposed on replace/clear (disposal removes icons from non-visible tabs, which per-editor clearing cannot); markers apply to editors as they become visible instead of force-opening files; added satsuma.clearCoverage command, also bound to the status-bar item. Pure shaping extracted to coverage-logic.ts with unit tests. (commit fcf2bb4)

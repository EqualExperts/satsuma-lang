---
id: le-4tc6
status: closed
deps: []
links: []
created: 2026-06-09T23:24:47Z
type: task
priority: 2
assignee: Thorben Louw
tags: [live-editor, harness]
---
# harness: expanded source pane should take 50% of the window width

The source pane is a fixed 448px column; on wide screens the editor is cramped. Make the expanded source pane 50% of the window width (collapse rail behaviour unchanged).

## Acceptance Criteria

Expanded source pane occupies half the window width; collapse/expand and persistence behaviour unchanged and tests pass.


## Notes

**2026-06-10T00:50:00+01:00**

Cause: The source pane was a fixed 448px column, cramping the editor on wide screens.
Fix: --source-width is now 50%, so the expanded pane takes half the window; collapse-rail behaviour and persistence unchanged (commit 287fcbd)

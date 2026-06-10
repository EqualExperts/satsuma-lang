---
id: sl-i0db
status: open
deps: []
links: []
created: 2026-06-10T07:19:25Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ubbp
tags: [playground, chrome]
---
# Discoverable source-pane collapse affordance (R6)

The bare ◀ collapse button (index.html:474, sl-1qte rail) is not understandable to first-time visitors, and the collapsed re-expand rail is equally opaque. User decision 2026-06-10: keep collapse, make it MORE DISCOVERABLE (labelled handle / splitter with grip / chevron tab + tooltip — pick during implementation). See PRD P6/R6.

## Acceptance Criteria

Both collapse and re-expand affordances self-explanatory without prior knowledge; reachable by mouse and keyboard with aria-labels; sl-1qte Playwright coverage updated to the new affordance.


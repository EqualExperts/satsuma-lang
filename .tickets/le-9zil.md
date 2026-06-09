---
id: le-9zil
status: in_progress
deps: []
links: []
created: 2026-06-09T23:16:33Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [live-editor, harness]
---
# Playground editor: text selection renders as a solid block

Selecting text in the playground source editor shows an opaque block: the overlay editor's textarea text is transparent (colours come from the highlight layer beneath), but #source-input::selection uses the opaque --color-selected background, which covers the coloured tokens.

## Acceptance Criteria

Selecting text in the editor keeps the syntax-highlighted characters visible through a translucent selection highlight, in both themes; a test asserts the selection background is translucent.


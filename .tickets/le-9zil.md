---
id: le-9zil
status: closed
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


## Notes

**2026-06-10T00:30:00+01:00**

Cause: The overlay editor's textarea glyphs are transparent (colours come from the highlight layer beneath), so the opaque --color-selected ::selection background painted over the tokens and selections read as solid blocks.
Fix: Per-theme translucent --editor-selection tint plus explicit `color: transparent` on ::selection so glyphs are never repainted; editor.test.ts pins background alpha < 1 and fully transparent selected-text colour (commit dd888e4)

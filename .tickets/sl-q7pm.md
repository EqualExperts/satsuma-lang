---
id: sl-q7pm
status: closed
deps: []
links: []
created: 2026-10-06T13:13:59Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, viz-backend, core, overview, comments, notes]
---
# viz: overview cards clip the mapping arrow count and hide schema notes; field //! and //? comments never show

Three defects seen on one small workspace (`CustomerRecord` → `MailingList`):

1. The overview mapping pill for `CustomerRecordToMailingList` cuts off its "4 →s" arrow count at the right edge.
2. A schema's `note` shows on the mapping-view schema card but not on the overview card.
3. `//!` and `//?` comments on fields draw no badge in either the mapping view or an expanded overview card.

```satsuma
schema CustomerRecord(note "I am a note") {
    customer_id UUID (pk) //! source system id
    salutation STRING     //? Don't we need more here?
}
```

## Acceptance Criteria

- The mapping pill is sized for its whole label, the count included; past the width cap the name truncates and the count stays whole.
- The compact overview card renders the schema's notes, and the overview layout reserves height for them.
- Trailing `//!` / `//?` comments attach to their own field or arrow in the VizModel, including the last item of a body, and render as badges in both views.
- Unit tests in core, viz-backend and viz, red before the fix; Playwright specs prove the painted result.

## Notes

**2026-10-06T13:13:59Z**

Cause: (1) `estimateOverviewLabelWidth` measured the name alone at too narrow a char width and ignored the count suffix, and the renderer pins the card to that width. (2) The compact schema card filtered `note` from its pills and never rendered the notes section. (3) The backend's `extractComments` found trailing comments with `parent.children.indexOf(node)`, which never matches because web-tree-sitter returns a fresh wrapper per access; a comment on a body's last item is also hoisted by the grammar out of the body and was credited to the block.
Fix: the width estimate now includes the shared `overviewMappingCountText` suffix and the count no longer shrinks; the compact card renders the notes section with matching layout height; new `@satsuma/core` module `comment-attachment.ts` attaches trailing comments by position and the backend uses it. Tests: core `comment-attachment.test.js`, backend comment tests rewritten to pin the owner, viz layout tests, and Playwright `overview-mapping-pill.test.ts` and `card-annotations.test.ts` (run outside the agent sandbox, where Chromium cannot launch) (commit immediately after 0c5c0071).
On rebase onto main's sl-zevx (a full card hides a label that repeats its note), the rule moved to `schemaLabelShown` in notes.ts so the layout asks the same question: `preambleHeight` now reserves the label line only when the card paints it, which the compact card never does. Without this every overview card with a note carried an empty 24px line above its notes.

**2026-10-06T15:52:14Z**

Cause: Committing this fix stalled in the pre-commit hook: the grammar package's Python fixture and CST-summary tests called `tree-sitter parse --wasm -p .`, and `-p` implies `--rebuild`, so every test recompiled the grammar with clang and downloaded wasi-sdk into a private `.cache/` when it was missing or half-written. CI's Playwright job also failed: the navigate test clicked the overview card's centre, which is the newly rendered note rather than the header.
Fix: new `scripts/print-tree.mjs` prints the tree in the CLI's format from the built `tree-sitter-satsuma.wasm` via web-tree-sitter; `print_tree.py` replaces `tree_sitter_bin.py` for both Python modules, so they need no C toolchain. The navigate test now clicks the header name. `test-stats.json` refreshed (commit immediately after 671eb55b).

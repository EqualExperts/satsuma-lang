---
id: bsw-n5p0
status: open
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [bug-sweep-2026-10, docs, release]
---
# CHANGELOG: Unreleased section is missing most user-visible changes since v0.13.0

`CHANGELOG.md` `## Unreleased` lists only sl-u3x8, sl-110g, sl-0j8b and sl-13p5. `release-metadata.mjs bump` promotes that section verbatim to the release notes. Missing (no CHANGELOG hit for any of these ids):

- Language: caf9dd77 ADR-053 `^.` / `$.` ancestor-escape paths in each/flatten (sl-8vqk), new `examples/ancestor-escape/`.
- Core/docs: afa7cb5e enclosing-level path hint (gh-525); 909b8788 / tced-ewd4 coverage crash on top-level `each x -> .y` fixed and leading-dot behaviour reversed.
- CLI: 6dc9c11d fully qualified nested-path `arrows` query is exact (gpt-qhfo).
- Lint: b9f82ea7 `unenumerated-record-target` skips only unresolved spreads; 1f40ab23 remedy text for multi-source.
- LSP: 473b894f rename updates NL @ref schema segments (gpt-fjo7); f7efed6b go-to-definition at three more usage kinds.
- Viz: a912f890 unknown-field vs no-lineage (sv-embb); fba794db enum badge overlay (sl-2ne7); ec41d0fe note Markdown everywhere / mapping notes no longer dropped (vnm-*); 398991a1 @refs highlighted in join/filter (sl-yhlj); af203d18 and f2fde976 card/toolbar and empty-state fixes.
- Ops (optional): 74100750 site redeploys after a release (rv-tmb4).

## Acceptance Criteria

- Every user-visible change in `git log v0.13.0..HEAD --no-merges` has an Unreleased entry in the existing CHANGELOG style.
- `node scripts/release-metadata.mjs notes <next>` on a scratch copy shows them.

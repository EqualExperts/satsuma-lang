---
id: bsw-5b3m
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, viz, markdown]
---
# viz: Markdown emphasis runs inside inline code and eats asterisks

`tooling/satsuma-viz/src/markdown.ts:118-122` applies emphasis before inline code. ``renderMarkdown("Use `SELECT * FROM t` then `count(*)`")`` gives `<code>SELECT <em> FROM t</code> then <code>count(</em>)</code>`: asterisks vanish and the tags cross. Plain `amount * 100 * rate` gives `amount <em> 100 </em> rate`. Pre-existing, but ec41d0fe now routes field notes through it too, and SQL in notes is common.

## Acceptance Criteria

- Inline code spans are protected from emphasis; a lone `*` surrounded by spaces is not emphasis. Unit tests for both strings; escaping unchanged.

## Notes

**2026-10-06T10:16:44Z**

Cause: renderMarkdown's inline pass applied emphasis before inline code, and its emphasis pattern accepted any `*...*` pair, so asterisks inside code spans paired up across spans and `a * b * c` became emphasis.
Fix: A new `renderInline` lifts code spans out behind a placeholder before ref marking and emphasis and restores them last; bold and italic now require non-space text just inside each delimiter. Covered by three markdown.test.js cases; escaping is unchanged (commit immediately after f18318e0)

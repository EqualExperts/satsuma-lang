---
id: bsw-5b3m
status: open
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

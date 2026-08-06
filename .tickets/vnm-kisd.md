---
id: vnm-kisd
status: closed
deps: []
links: [vnm-bak4]
created: 2026-08-06T17:23:11Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, notes, markdown, ux]
---
# viz: field notes render Markdown as literal source text (schema, fragment and metric cards)

Reported by a user: a field note written with a triple-quoted Markdown body renders in the visualiser as literal source text — the `**bold**` asterisks, the `#` heading hashes and the `-` bullets all show verbatim, and the line breaks collapse into one run. The user's reasonable follow-up was "if not, why would I use markdown as it doesn't seem to get formatted anywhere?"

Markdown in a `"""` note is the documented contract, not a user misconception. SATSUMA-V2-SPEC.md:43 defines `""" """` as "multiline natural language with Markdown support ... Use for notes with headings, bold, lists, or multi-paragraph content", and the spec's own worked example at SATSUMA-V2-SPEC.md:225-239 is exactly this shape — a `PHONE_NBR VARCHAR(50) (note """ ... """)` whose body is a bulleted list with bold percentages and inline code. The visualiser should render it.

**Where it breaks.** The payload is fine — this is purely a render-side gap:

- `tooling/satsuma-viz/src/components/sz-schema-card.ts:1067-1079` — `_renderField` interpolates `${n.text}` straight into the Lit template. Lit escapes it, so the Markdown source is what a reader sees. The `.field-note` rule (`sz-schema-card.ts:629-640`) also has no `white-space: pre-wrap`, so even the line breaks a `"""` note carries are lost.
- `tooling/satsuma-viz/src/components/sz-fragment-card.ts:257` and `tooling/satsuma-viz/src/components/sz-metric-card.ts:278` — same raw `${n.text}` for entity-level notes on those cards. Same bug class; fix together rather than leaving two known-raw sites behind.

**The inconsistency this creates.** A `renderMarkdown` helper already exists (`tooling/satsuma-viz/src/markdown.ts:28`) and is already wired to entity-level schema notes (`sz-schema-card.ts:940`) and file-level notes (`satsuma-viz.ts:2353` and `:2591`). So the identical `"""` note renders formatted when attached to the schema and raw when attached to a field inside it — which is what makes this read as a bug rather than a missing feature.

`viz-backend` already extracts field notes with the `isMultiline` flag set (`tooling/satsuma-viz-backend/src/viz-model.ts:1327`, and the `extractNoteBlock` doc-comment at `:1380-1384` states outright that the flag exists "so renderers can preserve formatting"). Nothing needs to change in the model or the backend.

**Scope note.** `renderMarkdown` is a deliberately minimal converter (headings, lists, bold, italic, inline code, paragraphs) and escapes HTML — reuse it as-is; do not pull in a Markdown library. Consider whether `highlightAtRefs` should compose with it so `@ref` tokens inside a note still get their emphasis, as they do on arrow notes today (`sz-mapping-detail.ts:842`) — `renderMarkdown` currently does not highlight refs, so a note containing both loses one or the other. Field notes are laid out inside cards whose height the ELK layout estimates from geometry constants; `sz-schema-card.ts:99-102` already flags that field-note lines are *not* part of that estimate, so check a multi-line rendered note does not overlap neighbouring cards.

Related: sl-1gqw introduced the shaded field-note row.

## Acceptance Criteria

- A field note written with `"""` renders its Markdown formatted in the schema card — headings, bullet and numbered lists, bold, italic and inline code — matching how the same note renders when attached to the schema itself.
- Multi-line note content keeps its line structure; a single-line `"` note still wraps to the card width as it does today.
- Fragment-card and metric-card entity-level notes render Markdown too, so no note site in the viz is left rendering raw source.
- HTML in note text stays escaped — no injection through a note body (the existing `renderMarkdown` escaping must not be bypassed).
- `@ref` tokens inside a note body remain visually distinguished, or the ticket records explicitly why they are not.
- A rendered multi-line note does not overlap adjacent cards or break the ELK layout's card-height assumption.
- Playwright harness coverage in `tooling/satsuma-viz-harness/test/harness.test.ts` asserts the rendered DOM of a Markdown field note (e.g. a `<ul>`/`<strong>` inside `.field-note`, not the literal `**`). There is no existing `describe` block for note rendering at all and no fixture with a Markdown field note — both need adding. Per AGENTS.md, this is painted output: a unit test on the converter proves the string transform, only a rendered browser proves the field row shows it.


## Notes

**2026-08-06T18:15:18Z**

**2026-08-06T18:20:00Z**

Cause: `renderMarkdown` was wired only to entity-level schema notes and file
notes; field notes (sz-schema-card), fragment-card and metric-card notes
interpolated `${n.text}` raw. A second, deeper cause surfaced during the fix:
note bodies keep their source indentation by design (SATSUMA-V2-SPEC.md:43),
and every block rule in the converter anchors at line start — so simply wiring
`renderMarkdown` in still rendered the spec's own PHONE_NBR example as one flat
paragraph. This also silently affected the file-level notes that already used
`renderMarkdown`.
Fix: added `dedentNoteBody` (trims the first line, whose indentation the
delimiter consumed, then strips the common indent from the rest) and composed
`@ref` marking into the Markdown inline pipeline; extracted the four duplicated
copies of the notes section into `satsuma-viz/src/notes.ts` so the drift that
caused this cannot recur; gave `.field-note` card-scale Markdown child styles.
Verified in a real browser — new "Note rendering" Playwright suite, 136 passed.
(commit immediately after 3bbbcb0b)

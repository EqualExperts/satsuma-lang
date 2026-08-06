---
id: vnm-bak4
status: open
deps: []
links: [vnm-kisd]
created: 2026-08-06T17:23:22Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, notes, markdown, ux]
---
# viz: mapping-level notes are never rendered, and arrow notes ignore Markdown

Reported by the same user, alongside the field-note report: "If I add notes to the mapping sections, should I expect to see them in the visualiser? (i.e. notes including markdown don't actually render on mapping arrows in the mapping view but should)."

There are two distinct defects behind that one sentence, and they should both be fixed here.

**1. Mapping-level `note { }` blocks are extracted and then dropped on the floor.**

SATSUMA-V2-SPEC.md:242 and :553 document `note { }` as a structural block usable "at file top level or inside mapping blocks", and say these "often benefit from `\"\"\"` for rich Markdown content". `viz-backend` honours that: `tooling/satsuma-viz-backend/src/viz-model.ts:855-937` collects notes from both the mapping body and the mapping declaration itself into `MappingBlock.notes`, and the contract declares the field at `tooling/satsuma-viz-model/src/index.ts:198`.

`tooling/satsuma-viz/src/components/sz-mapping-detail.ts` never reads `notes` — grepping the file for the identifier returns nothing. So a mapping-level note travels the whole pipeline into the webview payload and is then invisible to the reader. Top-level file notes *are* rendered (`satsuma-viz.ts:2353`, `:2591`), which is why this reads as an omission rather than a design choice.

**2. Arrow notes render, but never as Markdown.**

An arrow's `(note "...")` does render — `sz-mapping-detail.ts:793` picks the entry out of `a.metadata` and `:839-842` paints it in an `.arrow-note-row` beneath the arrow. But it goes through `highlightAtRefs` only, not `renderMarkdown`. `highlightAtRefs` (`tooling/satsuma-viz/src/markdown.ts:19`) escapes HTML and wraps `@ref` tokens; it does nothing with `**bold**`, lists or headings. A `"""` note on an arrow therefore shows its Markdown source verbatim, exactly as the user described.

**How the two relate.** This is the mapping-view half of the same bug class as the field-note report — a `renderMarkdown` helper exists and is wired to some note sites and not others. Fix them consistently: whatever composition of `renderMarkdown` and `highlightAtRefs` is settled on for field notes should apply here, so a note carrying both Markdown and an `@ref` renders both. Arrow notes are the one site where `@ref` highlighting already works, so it must not regress.

**Design question to settle before implementing.** Where mapping-level notes belong in the detail view is not obvious and is worth a decision rather than a guess. The mapping header already renders declaration metadata alongside source/target/join (see the `MappingBlock.metadata` comment at `viz-model/src/index.ts:194-197`, sl-6x1o), which argues for the header region; but a multi-paragraph `note { }` block is closer in weight to the file-note cards than to a metadata pill, and the arrow table is dense already. A collapsible section — mirroring the `notes-section` / `notes-toggle` pattern the schema card uses at `sz-schema-card.ts:926-948` — is the closest existing precedent and is the suggested starting point. Note that `NoteBlock` carries `isMultiline`, so the two weights are distinguishable in the payload.

## Acceptance Criteria

- A `note { }` block declared inside a mapping body is visible in the mapping detail view; a note on the mapping declaration itself is visible too. Neither is silently dropped.
- Where they render is a deliberate placement (header region vs. a collapsible section), recorded in the ticket notes, not incidental to the first thing that fitted.
- Mapping-level notes render their Markdown formatted — headings, lists, bold, italic, inline code.
- An arrow note written with `"""` renders its Markdown formatted in the `.arrow-note-row`, instead of showing the literal source.
- `@ref` highlighting on arrow notes does not regress, and works in mapping-level notes too.
- HTML in note text stays escaped at every one of these sites.
- A mapping with no notes renders exactly as it does today — no empty section, no extra vertical space.
- Playwright harness coverage in `tooling/satsuma-viz-harness/test/harness.test.ts` asserts the rendered DOM for both a mapping-level note and a Markdown arrow note. No `describe` block covers note rendering today and no fixture carries a mapping-level `note { }` or a Markdown arrow note — both fixtures need adding. Per AGENTS.md, whether a note is painted at all, and whether a collapsible section opens on click, are properties no getter-level test can observe.


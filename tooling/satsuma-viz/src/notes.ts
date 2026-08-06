/**
 * notes.ts — the one rendering of a Satsuma `note` shared by every card and
 * by the mapping detail view.
 *
 * Owns the collapsible "N Notes" section: its markup, its styles, and the
 * decision that note bodies render as Markdown. It does NOT own placement —
 * each component decides where in its own layout the section belongs — and it
 * does not own the shaded single-note row used beneath a field, which is a
 * different visual treatment living in `sz-schema-card`.
 *
 * Extracted because four consumers need it (schema, fragment and metric cards,
 * plus the mapping detail view). Three of them had drifted into rendering note
 * text raw while the fourth rendered Markdown, which is the defect vnm-kisd
 * and vnm-bak4 were filed against; one implementation is what stops that
 * recurring.
 */

import { html, css, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { ifDefined } from "lit/directives/if-defined.js";
import type { NoteBlock } from "./model.js";
import { renderMarkdown } from "./markdown.js";

/**
 * Styles for the collapsible notes section and for rendered Markdown inside a
 * note body. Include in a component's `static styles` array alongside its own.
 *
 * The `.note-content` child rules exist because note bodies are Markdown: a
 * `<p>`/`<ul>`/`<h3>` arriving from {@link renderMarkdown} would otherwise pick
 * up user-agent margins far too large for a card.
 */
export const noteSectionStyles = css`
  .notes-section {
    border-top: 1px dashed var(--sz-card-border);
    padding: 6px 12px;
  }

  .notes-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--sz-text-muted);
    user-select: none;
    padding: 2px 0;
  }

  .notes-toggle:hover {
    color: var(--sz-text);
  }

  .notes-toggle .arrow {
    font-size: 10px;
    transition: transform 0.15s ease;
  }

  .notes-toggle .arrow[data-expanded] {
    transform: rotate(90deg);
  }

  .note-content {
    font-family: var(--sz-font-sans);
    font-size: 12px;
    color: var(--sz-text);
    line-height: 1.5;
    padding: 4px 0 2px 22px;
    word-break: break-word;
    max-width: 400px;
  }

  .note-content p {
    margin: 0 0 6px;
  }

  .note-content p:last-child {
    margin-bottom: 0;
  }

  .note-content h1,
  .note-content h2,
  .note-content h3 {
    font-size: 12px;
    font-weight: 700;
    margin: 6px 0 2px;
  }

  .note-content ul,
  .note-content ol {
    margin: 0 0 6px;
    padding-left: 16px;
  }

  .note-content li {
    margin: 1px 0;
  }

  .note-content code {
    font-family: var(--sz-font-mono);
    font-size: 11px;
    background: var(--sz-row-active-bg);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .note-content strong {
    font-weight: 700;
  }

  .note-content em {
    font-style: italic;
  }

  /* @ref tokens inside a note body, matching their treatment in NL transform
     text so a ref reads the same wherever it is written. */
  .note-content .at-ref {
    font-weight: 600;
    font-style: normal;
    color: var(--sz-at-ref);
  }
`;

/** Inputs to {@link renderNotesSection}. */
export interface NotesSectionOptions {
  /** Note blocks to render. Callers must not call with an empty array — a
   *  notes section with nothing in it is an empty toggle taking up space. */
  notes: NoteBlock[];
  /** Whether the bodies are currently shown. Owned by the calling component. */
  expanded: boolean;
  /** Toggle handler. Should `stopPropagation` — cards navigate on click. */
  onToggle: (e: Event) => void;
  /** Test-id prefix; when given, the section and its toggle become
   *  addressable as `<prefix>-notes` and `<prefix>-notes-toggle`. */
  testIdPrefix?: string;
}

/**
 * Render the collapsible notes section. Note bodies go through
 * {@link renderMarkdown}, so a `"""` note's headings, lists and emphasis
 * render as formatting rather than as literal source text.
 */
export function renderNotesSection(options: NotesSectionOptions): TemplateResult {
  const { notes, expanded, onToggle, testIdPrefix } = options;
  const label = notes.length === 1 ? "Note" : `${notes.length} Notes`;

  return html`
    <div class="notes-section" data-testid=${ifDefined(testIdPrefix && `${testIdPrefix}-notes`)}>
      <div
        class="notes-toggle"
        data-testid=${ifDefined(testIdPrefix && `${testIdPrefix}-notes-toggle`)}
        @click=${onToggle}
      >
        <span class="arrow" ?data-expanded=${expanded}>&#9654;</span>
        <span>&#128221; ${label}</span>
      </div>
      ${
        expanded
          ? notes.map(
              (n) => html`<div class="note-content">${unsafeHTML(renderMarkdown(n.text))}</div>`,
            )
          : ""
      }
    </div>
  `;
}

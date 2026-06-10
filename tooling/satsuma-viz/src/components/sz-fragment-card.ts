import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { FragmentCard, FieldEntry } from "../model.js";
import { SzNavigateEvent } from "../satsuma-viz.js";
import { HEADER_HEIGHT, NAMESPACE_PILL_HEIGHT } from "../layout/geometry.js";

@customElement("sz-fragment-card")
export class SzFragmentCard extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      box-sizing: border-box;
      min-width: var(--sz-card-min-width, 240px);
      max-width: var(--sz-card-max-width, 380px);
      border-radius: var(--sz-card-radius);
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      box-shadow: var(--sz-card-shadow);
      overflow: hidden;
      font-family: var(--sz-font-sans);
    }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      /* Pinned to the shared HEADER_HEIGHT geometry constant: the ELK layout
         sizes nodes and computes edge anchors from it, so the rendered header
         must occupy exactly that box (sl-wixe). Flex centres the content. */
      height: ${HEADER_HEIGHT}px;
      box-sizing: border-box;
      padding: 0 12px;
      background: var(--sz-green);
      color: var(--sz-text-on-accent);
      cursor: pointer;
      user-select: none;
    }

    /* Without a namespace pill row the header is the top of the card and
       owns the top rounding (the host clips when overflow is hidden, but
       this keeps the geometry honest regardless of clipping). */
    .header:first-child {
      border-radius: var(--sz-card-radius) var(--sz-card-radius) 0 0;
    }

    .header-icon {
      font-size: 13px;
      flex-shrink: 0;
    }

    .header-name {
      font-size: 14px;
      font-weight: 600;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-count {
      font-size: 11px;
      opacity: 0.85;
      flex-shrink: 0;
    }

    .header-toggle {
      font-size: 12px;
      flex-shrink: 0;
      transition: transform 0.15s ease;
    }

    .header-toggle[data-collapsed] {
      transform: rotate(-90deg);
    }

    .fields {
      padding: 4px 0;
    }

    .field-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 12px;
      height: var(--sz-field-height);
      cursor: pointer;
    }

    .field-row:hover {
      background: var(--sz-row-hover-bg);
    }

    .spread-icon {
      font-size: 11px;
      color: var(--sz-green);
      flex-shrink: 0;
    }

    .field-name {
      font-family: var(--sz-font-mono);
      font-size: 12px;
      font-weight: 500;
      color: var(--sz-text);
      flex: 1;
    }

    .field-type {
      font-family: var(--sz-font-mono);
      font-size: 11px;
      color: var(--sz-text-muted);
      flex-shrink: 0;
    }

    .badges {
      display: flex;
      gap: 3px;
      flex-shrink: 0;
    }

    .badge {
      font-family: var(--sz-font-sans);
      font-size: 10px;
      font-weight: 500;
      padding: 1px 5px;
      border-radius: var(--sz-badge-radius);
      background: var(--sz-badge-bg);
      color: var(--sz-badge-text);
      line-height: 1.4;
    }

    .collapsed .fields,
    .collapsed .notes-section {
      display: none;
    }

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
      white-space: pre-wrap;
      word-break: break-word;
    }
  `;

  @property({ type: Object })
  fragment: FragmentCard | null = null;

  @property({ type: Boolean })
  compact = false;

  @property({ type: String, attribute: "namespace-label" })
  namespaceLabel: string | null = null;

  @state()
  private _collapsed = false;

  @state()
  private _notesExpanded = false;

  private _renderNamespacePill() {
    // Cards without a namespace render NO row here — the header is the top of
    // the card. (A 24px filler bar used to fill this slot on compact cards;
    // the layout never counted it, so cards overflowed their ELK nodes and
    // edge anchors missed the header — sl-wixe.) The row is pinned to the
    // shared NAMESPACE_PILL_HEIGHT the layout reserves for it.
    if (!this.namespaceLabel) return html``;
    return html`<div style="height:${NAMESPACE_PILL_HEIGHT}px;box-sizing:border-box;display:flex;align-items:end;padding:0 12px;background:var(--sz-green);">
        <span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--sz-namespace-pill-chip-bg);color:var(--sz-orange-dark);">${this.namespaceLabel}</span>
      </div>`;
  }

  override render() {
    const fr = this.fragment;
    if (!fr) return html``;

    if (this.compact) {
      return html`
        <div>
          ${this._renderNamespacePill()}
          <div class="header" @click=${() => this._navigate(fr.location)}>
            <span class="header-icon">&#9674;</span>
            <span class="header-name">${fr.id}</span>
            <span class="header-count">${fr.fields.length} fields</span>
          </div>
        </div>
      `;
    }

    const hasNotes = fr.notes.length > 0;

    return html`
      <div class=${this._collapsed ? "collapsed" : ""}>
        ${this._renderNamespacePill()}
        <div class="header" @click=${this._onHeaderClick}>
          <span class="header-icon">&#9674;</span>
          <span class="header-name">${fr.id}</span>
          <span class="header-count">${fr.fields.length} fields</span>
          <span class="header-toggle" ?data-collapsed=${this._collapsed} @click=${this._onToggleClick}>&#9660;</span>
        </div>
        <div class="fields">
          ${fr.fields.map((f) => this._renderField(f))}
        </div>
        ${hasNotes ? this._renderNotes(fr.notes) : ""}
      </div>
    `;
  }

  private _renderNotes(notes: import("../model.js").NoteBlock[]) {
    return html`
      <div class="notes-section">
        <div class="notes-toggle" @click=${this._toggleNotes}>
          <span class="arrow" ?data-expanded=${this._notesExpanded}>&#9654;</span>
          <span>&#128221; ${notes.length === 1 ? "Note" : `${notes.length} Notes`}</span>
        </div>
        ${this._notesExpanded
          ? notes.map((n) => html`<div class="note-content">${n.text}</div>`)
          : ""}
      </div>
    `;
  }

  private _toggleNotes(e: Event) {
    e.stopPropagation();
    this._notesExpanded = !this._notesExpanded;
  }

  private _renderField(f: FieldEntry) {
    return html`
      <div class="field-row" @click=${() => this._navigate(f.location)}>
        <span class="spread-icon">&#8230;</span>
        <span class="field-name">${f.name}</span>
        <span class="field-type">${f.type}</span>
        <span class="badges">
          ${f.constraints.map(
            (c) => html`<span class="badge">${c}</span>`
          )}
        </span>
      </div>
    `;
  }

  /** Arrow click: collapse/expand only — never navigate (sl-tw0r). */
  private _onToggleClick(e: Event) {
    e.stopPropagation();
    this._collapsed = !this._collapsed;
  }

  /** Header (name/icon) click: navigation intent only (sl-tw0r). */
  private _onHeaderClick() {
    if (this.fragment) {
      this._navigate(this.fragment.location);
    }
  }

  private _navigate(loc: import("../model.js").SourceLocation) {
    this.dispatchEvent(new SzNavigateEvent(loc));
  }
}

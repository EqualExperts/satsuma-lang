import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MetricCard, MetricFieldEntry } from "../model.js";
import { SzNavigateEvent } from "../satsuma-viz.js";
import { HEADER_HEIGHT, NAMESPACE_PILL_HEIGHT } from "../layout/geometry.js";

const MEASURE_ICONS: Record<string, string> = {
  additive: "\u03A3",        // Σ
  non_additive: "\u2248",    // ≈
  semi_additive: "\u00BD",   // ½
};

@customElement("sz-metric-card")
export class SzMetricCard extends LitElement {
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
      background: var(--sz-violet);
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
      font-size: 14px;
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

    .header-toggle {
      font-size: 12px;
      flex-shrink: 0;
      transition: transform 0.15s ease;
    }

    .header-toggle[data-collapsed] {
      transform: rotate(-90deg);
    }

    .meta {
      padding: 4px 12px 6px;
      font-size: 11px;
      color: var(--sz-text-muted);
      border-bottom: 1px solid var(--sz-card-border);
      line-height: 1.5;
    }

    .meta-row {
      display: flex;
      gap: 6px;
    }

    .meta-label {
      opacity: 0.7;
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

    .measure-icon {
      width: 16px;
      text-align: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--sz-violet);
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

    .collapsed .fields,
    .collapsed .meta,
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
  metric: MetricCard | null = null;

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
    return html`<div style="height:${NAMESPACE_PILL_HEIGHT}px;box-sizing:border-box;display:flex;align-items:end;padding:0 12px;background:var(--sz-violet);">
        <span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--sz-namespace-pill-chip-bg);color:var(--sz-orange-dark);">${this.namespaceLabel}</span>
      </div>`;
  }

  override render() {
    const m = this.metric;
    if (!m) return html``;

    if (this.compact) {
      return html`
        <div>
          ${this._renderNamespacePill()}
          <div class="header" @click=${() => this._navigate(m.location)}>
            <span class="header-icon">&#9670;</span>
            <span class="header-name">${m.id}</span>
            <span class="header-toggle">&#9660;</span>
          </div>
        </div>
      `;
    }

    const hasMeta = m.label || m.grain || m.slices.length > 0;
    const hasNotes = m.notes.length > 0;

    return html`
      <div class=${this._collapsed ? "collapsed" : ""}>
        ${this._renderNamespacePill()}
        <div class="header" @click=${this._onHeaderClick}>
          <span class="header-icon">&#9670;</span>
          <span class="header-name">${m.id}</span>
          <span class="header-toggle" ?data-collapsed=${this._collapsed}>&#9660;</span>
        </div>
        ${hasMeta
          ? html`
              <div class="meta">
                ${m.label ? html`<div class="meta-row">"${m.label}"${m.grain ? html` &middot; grain: ${m.grain}` : ""}</div>` : ""}
                ${!m.label && m.grain ? html`<div class="meta-row"><span class="meta-label">grain:</span> ${m.grain}</div>` : ""}
                ${m.slices.length > 0
                  ? html`<div class="meta-row"><span class="meta-label">slice:</span> ${m.slices.join(", ")}</div>`
                  : ""}
              </div>
            `
          : ""}
        <div class="fields">
          ${m.fields.map((f) => this._renderField(f))}
        </div>
        ${hasNotes ? this._renderNotes(m.notes) : ""}
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

  private _renderField(f: MetricFieldEntry) {
    const icon = f.measure ? MEASURE_ICONS[f.measure] ?? "" : "";
    return html`
      <div class="field-row" @click=${() => this._navigate(f.location)}>
        <span class="measure-icon">${icon}</span>
        <span class="field-name">${f.name}</span>
        <span class="field-type">${f.type}</span>
      </div>
    `;
  }

  private _onHeaderClick() {
    this._collapsed = !this._collapsed;
    if (this.metric) {
      this._navigate(this.metric.location);
    }
  }

  private _navigate(loc: import("../model.js").SourceLocation) {
    this.dispatchEvent(new SzNavigateEvent(loc));
  }
}

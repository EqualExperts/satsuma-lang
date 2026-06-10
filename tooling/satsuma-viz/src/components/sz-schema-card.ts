import { LitElement, html, css, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { SchemaCard, FieldEntry } from "../model.js";
import { SzNavigateEvent, SzFieldHoverEvent, SzFieldLineageEvent } from "../satsuma-viz.js";
import { renderMarkdown } from "../markdown.js";
import { isCoveredFieldPath } from "@satsuma/core/coverage-paths";
import { HEADER_HEIGHT, NAMESPACE_PILL_HEIGHT } from "../layout/geometry.js";

/**
 * Detail of the `sz-compact-toggled` CustomEvent a compact card dispatches
 * when its header is clicked. The card does NOT change its own state — the
 * parent visualization owns `compactExpanded` (it must re-run the overview
 * layout at the card's new size) and flips the property in response.
 */
export interface SzCompactToggledDetail {
  /** qualifiedId of the schema whose card was clicked (id if unqualified). */
  schemaId: string;
  /** The state the user asked for: true = expand fields, false = collapse. */
  expanded: boolean;
}

function sanitizeTestIdSegment(value: string): string {
  const lowered = value.toLowerCase();
  let result = "";
  let pendingSeparator = false;

  for (const char of lowered) {
    const isAsciiLetter = char >= "a" && char <= "z";
    const isDigit = char >= "0" && char <= "9";

    if (isAsciiLetter || isDigit) {
      if (pendingSeparator && result) {
        result += "-";
      }
      result += char;
      pendingSeparator = false;
      continue;
    }

    pendingSeparator = result.length > 0;
  }

  return result;
}

@customElement("sz-schema-card")
export class SzSchemaCard extends LitElement {
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

    :host([content-width]) {
      width: max-content;
      max-width: none;
    }

    /*
     * While a compact card is expanded, the overview layout sizes its node
     * from a height ESTIMATE (field-note lines are not estimated), so let any
     * small overshoot paint past the host instead of being clipped.
     */
    :host([compact-expanded]) {
      overflow: visible;
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
      background: var(--sz-orange);
      color: var(--sz-text-on-accent);
      cursor: pointer;
      user-select: none;
    }

    /* Without a namespace pill row the header is the top of the card and
       owns the top rounding. The host normally clips (overflow: hidden), but
       compact-expanded cards set overflow: visible, so the rounding must be
       on the header itself. */
    .header:first-child {
      border-radius: var(--sz-card-radius) var(--sz-card-radius) 0 0;
    }

    .header.report {
      background: var(--sz-report);
    }

    .header-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    .header-name {
      font-size: 14px;
      font-weight: 600;
      flex: 1;
      overflow: var(--sz-header-name-overflow);
      text-overflow: var(--sz-header-name-overflow-mode);
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

    .label {
      padding: 4px 12px 6px;
      font-size: 12px;
      color: var(--sz-text-muted);
      font-style: italic;
      border-bottom: 1px solid var(--sz-card-border);
      max-width: 400px;
      word-break: break-word;
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

    .port {
      width: var(--sz-port-size);
      height: var(--sz-port-size);
      border-radius: 50%;
      flex-shrink: 0;
    }

    .port.mapped {
      background: var(--sz-orange-dark);
    }

    .port.unmapped {
      border: 1.5px solid var(--sz-text-muted);
      background: transparent;
    }

    .field-name {
      font-family: var(--sz-font-mono);
      font-size: 12px;
      font-weight: 500;
      color: var(--sz-text);
      flex: var(--sz-field-name-flex);
      overflow: var(--sz-field-name-overflow);
      text-overflow: var(--sz-field-name-overflow-mode);
      white-space: nowrap;
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

    .badge.pii {
      background: var(--sz-warning-bg);
      color: var(--sz-warning-icon);
    }

    .comment-badge {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
      cursor: help;
    }

    .comment-badge.warning {
      background: var(--sz-warning-bg);
      color: var(--sz-warning-icon);
    }

    .comment-badge.question {
      background: var(--sz-question-bg);
      color: var(--sz-question-icon);
    }

    .nested {
      padding-left: 20px;
    }

    .collapsed .fields {
      display: none;
    }

    .collapsed .label,
    .collapsed .metadata-pills {
      display: none;
    }

    .collapsed .notes-section {
      display: none;
    }

.metadata-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 4px 12px 6px;
      border-bottom: 1px solid var(--sz-card-border);
    }

    .meta-pill {
      font-family: var(--sz-font-sans);
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: var(--sz-badge-radius);
      background: var(--sz-namespace-bg);
      color: var(--sz-text-muted);
      line-height: 1.4;
      white-space: nowrap;
    }

    .meta-pill .meta-key {
      color: var(--sz-orange-dark);
    }

    .spread-indicator {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 12px;
      font-size: 11px;
      color: var(--sz-green);
      border-top: 1px dotted var(--sz-green);
    }

    .spread-indicator .spread-icon {
      font-size: 10px;
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

    .lineage-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: none;
      border-radius: 3px;
      background: transparent;
      color: var(--sz-text-muted);
      cursor: pointer;
      flex-shrink: 0;
      padding: 0;
      opacity: 0;
      transition: opacity 0.1s, background 0.1s;
    }

    .field-row:hover .lineage-btn {
      opacity: 1;
    }

    .lineage-btn:hover {
      background: var(--sz-accent-wash);
      color: var(--sz-orange-dark);
    }

    /* Cross-highlighting */
    :host([has-highlight]) .field-row {
      opacity: 0.5;
      transition: opacity 0.15s ease;
    }

    :host([has-highlight]) .field-row.hl {
      opacity: 1;
    }

    :host([has-highlight]) .field-row.hl.hl-source {
      background: var(--sz-accent-wash);
    }

    :host([has-highlight]) .field-row.hl.hl-target {
      background: var(--sz-green-wash);
    }

    :host([has-highlight]) .field-row.hl .field-name {
      font-weight: 700;
    }

    :host([content-width]) .field-row {
      width: max-content;
      min-width: 100%;
    }

    /* Shaded note row displayed beneath a field that has notes. */
    .field-note {
      font-family: var(--sz-font-sans);
      font-size: 11px;
      font-style: italic;
      color: var(--sz-text-muted);
      line-height: 1.4;
      padding: 2px 12px 4px 38px;
      background: var(--sz-row-hover-bg);
      max-width: 400px;
      word-break: break-word;
    }

    :host([content-width]) .header-name {
      --sz-header-name-overflow: visible;
      --sz-header-name-overflow-mode: clip;
      min-width: max-content;
    }

    :host([content-width]) .field-name {
      --sz-field-name-flex: 0 0 auto;
      --sz-field-name-overflow: visible;
      --sz-field-name-overflow-mode: clip;
      min-width: max-content;
    }
  `;

  @property({ type: Object })
  schema: SchemaCard | null = null;

  /** Set of mapped target field names — set by parent to indicate which fields have arrows. */
  @property({ type: Object })
  mappedFields: Set<string> = new Set();

  /** Compact mode: hides fields, port dots, constraints, spread indicators, lineage buttons.
   *  Shows namespace::name in header when schema has a namespace (qualifiedId contains ::). */
  @property({ type: Boolean })
  compact = false;

  @property({ type: String, attribute: "namespace-label" })
  namespaceLabel: string | null = null;

  @property({ type: String, attribute: "test-id-prefix" })
  testIdPrefix = "schema-card";

  @property({ type: Boolean, attribute: "content-width", reflect: true })
  contentWidth = false;

  /** Set of field names to highlight (peach for source, green for target).
   *  When non-empty, non-highlighted fields dim to ~50% opacity. */
  @property({ type: Object })
  highlightFields: Set<string> = new Set();

  /** Highlight color: "source" for peach, "target" for green. */
  @property({ type: String })
  highlightColor: "source" | "target" | "" = "";

  /**
   * Whether this compact card is expanded to reveal its field list. OWNED BY
   * THE PARENT visualization: the parent must know the expanded set to size
   * this card's node in the overview layout, so a header click only *requests*
   * the toggle (see sz-compact-toggled) and the parent flips this property.
   * Reflected so the stylesheet can lift the host's overflow while expanded.
   */
  @property({ type: Boolean, attribute: "compact-expanded", reflect: true })
  compactExpanded = false;

  @state()
  private _collapsed = false;

  @state()
  private _notesExpanded = true;

  override updated(changed: Map<string, unknown>) {
    if (changed.has("highlightFields")) {
      if (this.highlightFields.size > 0) {
        this.setAttribute("has-highlight", "");
      } else {
        this.removeAttribute("has-highlight");
      }
    }
  }

  private _isReport(s: SchemaCard): boolean {
    return s.metadata.some((m) => m.key === "report" || m.key === "model");
  }

  private _renderNamespacePill() {
    // Cards without a namespace render NO row here — the header is the top of
    // the card. (A 24px filler bar used to fill this slot on compact cards;
    // the layout never counted it, so cards overflowed their ELK nodes and
    // edge anchors missed the header — sl-wixe.)
    if (!this.namespaceLabel) return html``;

    // The namespace pill is the only visual marker that distinguishes a
    // namespaced schema card from a vanilla one. Expose a stable test id
    // (sl-3c2w) so Playwright can assert qualified namespace rendering
    // without text matching against a positioned <span>. The row is pinned
    // to the shared NAMESPACE_PILL_HEIGHT the layout reserves for it.
    return html`<div
        style="height:${NAMESPACE_PILL_HEIGHT}px;box-sizing:border-box;display:flex;align-items:end;padding:0 12px;background:var(--sz-orange);"
        data-testid=${`${this.testIdPrefix}-namespace-pill`}
      >
        <span
          data-testid=${`${this.testIdPrefix}-namespace-label`}
          style="display:inline-block;font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--sz-namespace-pill-chip-bg);color:var(--sz-orange-dark);"
        >${this.namespaceLabel}</span>
      </div>`;
  }

  private _headerIcon(isReport: boolean) {
    if (isReport) {
      // Chart/report icon
      return html`<svg class="header-icon" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="2" width="14" height="12" rx="2" opacity="0.9"/>
        <rect x="4" y="8" width="2" height="4" rx="0.5" fill="var(--sz-icon-overlay-soft)"/>
        <rect x="7" y="5" width="2" height="7" rx="0.5" fill="var(--sz-icon-overlay-soft)"/>
        <rect x="10" y="7" width="2" height="5" rx="0.5" fill="var(--sz-icon-overlay-soft)"/>
      </svg>`;
    }
    // Table/schema icon
    return html`<svg class="header-icon" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="12" rx="2" opacity="0.9"/>
      <line x1="1" y1="6" x2="15" y2="6" stroke="var(--sz-icon-divider)" stroke-width="1"/>
    </svg>`;
  }

  override render() {
    const s = this.schema;
    if (!s) return html``;

    if (this.compact) return this._renderCompact(s);

    const totalFields = this._countFields(s.fields);
    const mappedCount = this._countMapped(s.fields);
    const hasNotes = s.notes.length > 0;
    const metaPills = s.metadata.filter((m) => m.key !== "note");
    const isReport = this._isReport(s);

    return html`
      <div class=${this._collapsed ? "collapsed" : ""} data-testid=${this.testIdPrefix}>
        ${this._renderNamespacePill()}
        <div class="header ${isReport ? "report" : ""}" data-testid=${`${this.testIdPrefix}-header`} @click=${this._onHeaderClick}>
          ${this._headerIcon(isReport)}
          <span class="header-name">${s.id}</span>
          <span class="header-count">${mappedCount}/${totalFields}</span>
          <span class="header-toggle" ?data-collapsed=${this._collapsed}>&#9660;</span>
        </div>
        ${s.label ? html`<div class="label">${s.label}</div>` : ""}
        ${metaPills.length > 0
          ? html`<div class="metadata-pills">
              ${metaPills.map(
                (m) => html`<span class="meta-pill"><span class="meta-key">${m.key}</span> ${m.value}</span>`
              )}
            </div>`
          : ""}
        <div class="fields" data-testid=${`${this.testIdPrefix}-fields`}>
          ${s.fields.map((f) => this._renderField(f, 0))}
        </div>
        ${s.spreads.length > 0
          ? s.spreads.map(
              (sp) => html`<div class="spread-indicator"><span class="spread-icon">&#8230;</span> spreads ${sp}</div>`
            )
          : ""}
        ${hasNotes ? this._renderNotes(s.notes) : ""}
      </div>
    `;
  }

  private _onFieldHover(fieldPath: string | null) {
    const schemaId = this.schema?.qualifiedId ?? "";
    this.dispatchEvent(new SzFieldHoverEvent(schemaId, fieldPath));
  }

  private _renderNotes(notes: import("../model.js").NoteBlock[]) {
    return html`
      <div class="notes-section" data-testid=${`${this.testIdPrefix}-notes`}>
        <div
          class="notes-toggle"
          data-testid=${`${this.testIdPrefix}-notes-toggle`}
          @click=${this._toggleNotes}
        >
          <span class="arrow" ?data-expanded=${this._notesExpanded}>&#9654;</span>
          <span>&#128221; ${notes.length === 1 ? "Note" : `${notes.length} Notes`}</span>
        </div>
        ${this._notesExpanded
          ? notes.map((n) => html`<div class="note-content">${unsafeHTML(renderMarkdown(n.text))}</div>`)
          : ""}
      </div>
    `;
  }

  private _toggleNotes(e: Event) {
    e.stopPropagation();
    this._notesExpanded = !this._notesExpanded;
  }

  private _renderField(f: FieldEntry, depth: number, prefix = ""): TemplateResult {
    const fieldPath = prefix ? `${prefix}.${f.name}` : f.name;
    const isMapped = isCoveredFieldPath(fieldPath, this.mappedFields);
    const hasWarning = f.comments.some((c) => c.kind === "warning");
    const hasQuestion = f.comments.some((c) => c.kind === "question");
    const hasPii = f.constraints.includes("pii");
    const isHighlighted = this.highlightFields.has(fieldPath);
    const hlClass = isHighlighted
      ? `hl ${this.highlightColor === "target" ? "hl-target" : "hl-source"}`
      : "";
    // Use the dotted path so nested customer.email is distinguishable from a
    // sibling top-level email field (sl-eikr).
    const fieldTestId = `${this.testIdPrefix}-field-${sanitizeTestIdSegment(fieldPath)}`;
    const coverageState = isMapped ? "mapped" : "unmapped";

    return html`
      <div
        class="field-row ${depth > 0 ? "nested" : ""} ${hlClass}"
        data-testid=${fieldTestId}
        data-coverage=${coverageState}
        style=${depth > 0 ? `padding-left: ${12 + depth * 20}px` : ""}
        @click=${() => this._navigate(f.location)}
        @mouseenter=${() => this._onFieldHover(fieldPath)}
        @mouseleave=${() => this._onFieldHover(null)}
        title=${f.name + ": " + f.type}
      >
        <span class="port ${isMapped ? "mapped" : "unmapped"}"></span>
        <span class="field-name">${f.name}</span>
        <span class="field-type">${f.type}</span>
        <span class="badges">
          ${f.constraints
            .filter((c) => c !== "pii")
            .map(
              (c) => html`<span class="badge">${c}</span>`
            )}
          ${hasPii ? html`<span class="badge pii" title="PII">&#128737; pii</span>` : ""}
        </span>
        ${hasWarning
          ? html`<span class="comment-badge warning" title=${this._commentText(f, "warning")}>&#9888;</span>`
          : ""}
        ${hasQuestion
          ? html`<span class="comment-badge question" title=${this._commentText(f, "question")}>?</span>`
          : ""}
        <button
          class="lineage-btn"
          data-testid=${`${fieldTestId}-lineage`}
          title="Show field lineage"
          @click=${(e: Event) => { e.stopPropagation(); this._onFieldLineage(fieldPath); }}
        ><svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="2" cy="6" r="1.5" fill="currentColor"/>
          <circle cx="10" cy="3" r="1.5" fill="currentColor"/>
          <circle cx="10" cy="9" r="1.5" fill="currentColor"/>
          <line x1="3.5" y1="5.3" x2="8.5" y2="3.7" stroke="currentColor" stroke-width="1.2"/>
          <line x1="3.5" y1="6.7" x2="8.5" y2="8.3" stroke="currentColor" stroke-width="1.2"/>
        </svg></button>
      </div>
      ${f.notes.length > 0
        ? f.notes.map((n) => html`<div class="field-note" style=${depth > 0 ? `padding-left: ${38 + depth * 20}px` : ""}>${n.text}</div>`)
        : ""}
      ${f.children.map((child) => this._renderField(child, depth + 1, fieldPath))}
    `;
  }

  private _commentText(f: FieldEntry, kind: "warning" | "question"): string {
    return f.comments
      .filter((c) => c.kind === kind)
      .map((c) => c.text)
      .join("\n");
  }

  private _countFields(fields: FieldEntry[]): number {
    let count = 0;
    for (const f of fields) {
      count++;
      count += this._countFields(f.children);
    }
    return count;
  }

  private _countMapped(fields: FieldEntry[], prefix = ""): number {
    let count = 0;
    for (const f of fields) {
      const fieldPath = prefix ? `${prefix}.${f.name}` : f.name;
      if (isCoveredFieldPath(fieldPath, this.mappedFields)) count++;
      count += this._countMapped(f.children, fieldPath);
    }
    return count;
  }

  private _renderCompact(s: SchemaCard) {
    const displayName = s.id;
    const totalFields = this._countFields(s.fields);
    const metaPills = s.metadata.filter((m) => m.key !== "note");
    const isReport = this._isReport(s);

    return html`
      <div>
        ${this._renderNamespacePill()}
        <div class="header ${isReport ? "report" : ""}" @click=${this._onCompactHeaderClick}>
          ${this._headerIcon(isReport)}
          <span class="header-name">${displayName}</span>
          <span class="header-toggle" ?data-collapsed=${!this.compactExpanded}>&#9660;</span>
          <span class="header-count">${totalFields} fields</span>
        </div>
        ${metaPills.length > 0
          ? html`<div class="metadata-pills">
              ${metaPills.map(
                (m) => html`<span class="meta-pill"><span class="meta-key">${m.key}</span> ${m.value}</span>`
              )}
            </div>`
          : ""}
        ${this.compactExpanded
          ? html`<div class="fields">
              ${s.fields.map((f) => this._renderField(f, 0))}
            </div>`
          : ""}
      </div>
    `;
  }

  private _onCompactHeaderClick() {
    // Request the toggle rather than flipping local state: the parent owns
    // compactExpanded because it must re-run the overview layout with this
    // card's new size (expansion re-flows neighbours; it never overlays them).
    this.dispatchEvent(
      new CustomEvent<SzCompactToggledDetail>("sz-compact-toggled", {
        detail: {
          schemaId: this.schema?.qualifiedId ?? this.schema?.id ?? "",
          expanded: !this.compactExpanded,
        },
        bubbles: true,
        composed: true,
      }),
    );
    if (this.schema) {
      this._navigate(this.schema.location);
    }
  }

  private _onHeaderClick() {
    this._collapsed = !this._collapsed;
    if (this.schema) {
      this._navigate(this.schema.location);
    }
  }

  private _onFieldLineage(fieldName: string) {
    const schemaId = this.schema?.qualifiedId ?? this.schema?.id ?? "";
    this.dispatchEvent(new SzFieldLineageEvent(schemaId, fieldName));
  }

  private _navigate(loc: import("../model.js").SourceLocation) {
    this.dispatchEvent(new SzNavigateEvent(loc));
  }
}

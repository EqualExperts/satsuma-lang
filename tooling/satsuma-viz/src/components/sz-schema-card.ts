import { LitElement, html, css, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { SchemaCard, FieldEntry } from "../model.js";
import { SzNavigateEvent, SzFieldHoverEvent, SzFieldLineageEvent } from "../satsuma-viz.js";
import { renderMarkdown } from "../markdown.js";
import { isCoveredFieldPath } from "@satsuma/core/coverage-paths";

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
      border-radius: var(--sz-card-radius, 8px);
      background: var(--sz-card-bg, #fff);
      border: 1px solid var(--sz-card-border, rgba(45, 42, 38, 0.08));
      box-shadow: var(--sz-card-shadow, 0 2px 8px rgba(45, 42, 38, 0.06));
      overflow: hidden;
      font-family: var(--sz-font-sans, system-ui);
    }

    :host([content-width]) {
      width: max-content;
      max-width: none;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--sz-orange, #F2913D);
      color: #fff;
      cursor: pointer;
      user-select: none;
    }

    .header.report {
      background: var(--sz-report, #4A90B8);
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
      overflow: var(--sz-header-name-overflow, hidden);
      text-overflow: var(--sz-header-name-overflow-mode, ellipsis);
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
      color: var(--sz-text-muted, #6B6560);
      font-style: italic;
      border-bottom: 1px solid var(--sz-card-border, rgba(45, 42, 38, 0.08));
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
      height: var(--sz-field-height, 28px);
      cursor: pointer;
    }

    .field-row:hover {
      background: rgba(45, 42, 38, 0.03);
    }

    .port {
      width: var(--sz-port-size, 8px);
      height: var(--sz-port-size, 8px);
      border-radius: 50%;
      flex-shrink: 0;
    }

    .port.mapped {
      background: var(--sz-orange-dark, #D97726);
    }

    .port.unmapped {
      border: 1.5px solid var(--sz-text-muted, #6B6560);
      background: transparent;
    }

    .field-name {
      font-family: var(--sz-font-mono, monospace);
      font-size: 12px;
      font-weight: 500;
      color: var(--sz-text, #2D2A26);
      flex: var(--sz-field-name-flex, 1);
      overflow: var(--sz-field-name-overflow, hidden);
      text-overflow: var(--sz-field-name-overflow-mode, ellipsis);
      white-space: nowrap;
    }

    .field-type {
      font-family: var(--sz-font-mono, monospace);
      font-size: 11px;
      color: var(--sz-text-muted, #6B6560);
      flex-shrink: 0;
    }

    .badges {
      display: flex;
      gap: 3px;
      flex-shrink: 0;
    }

    .badge {
      font-family: var(--sz-font-sans, system-ui);
      font-size: 10px;
      font-weight: 500;
      padding: 1px 5px;
      border-radius: var(--sz-badge-radius, 4px);
      background: var(--sz-badge-bg, #FFF3E8);
      color: var(--sz-badge-text, #D97726);
      line-height: 1.4;
    }

    .badge.pii {
      background: var(--sz-warning-bg, #FEF3CD);
      color: var(--sz-warning-icon, #C45D22);
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
      background: var(--sz-warning-bg, #FEF3CD);
      color: var(--sz-warning-icon, #C45D22);
    }

    .comment-badge.question {
      background: var(--sz-question-bg, #E8F0FE);
      color: var(--sz-question-icon, #7C6BAE);
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
      border-bottom: 1px solid var(--sz-card-border, rgba(45, 42, 38, 0.08));
    }

    .meta-pill {
      font-family: var(--sz-font-sans, system-ui);
      font-size: 10px;
      font-weight: 500;
      padding: 1px 6px;
      border-radius: var(--sz-badge-radius, 4px);
      background: var(--sz-namespace-bg, #FFF3E8);
      color: var(--sz-text-muted, #6B6560);
      line-height: 1.4;
      white-space: nowrap;
    }

    .meta-pill .meta-key {
      color: var(--sz-orange-dark, #D97726);
    }

    .spread-indicator {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 12px;
      font-size: 11px;
      color: var(--sz-green, #5A9E6F);
      border-top: 1px dotted var(--sz-green, #5A9E6F);
    }

    .spread-indicator .spread-icon {
      font-size: 10px;
    }

    .notes-section {
      border-top: 1px dashed var(--sz-card-border, rgba(45, 42, 38, 0.08));
      padding: 6px 12px;
    }

    .notes-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 12px;
      color: var(--sz-text-muted, #6B6560);
      user-select: none;
      padding: 2px 0;
    }

    .notes-toggle:hover {
      color: var(--sz-text, #2D2A26);
    }

    .notes-toggle .arrow {
      font-size: 10px;
      transition: transform 0.15s ease;
    }

    .notes-toggle .arrow[data-expanded] {
      transform: rotate(90deg);
    }

    .note-content {
      font-family: var(--sz-font-sans, system-ui);
      font-size: 12px;
      color: var(--sz-text, #2D2A26);
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
      font-family: var(--sz-font-mono, monospace);
      font-size: 11px;
      background: rgba(45, 42, 38, 0.06);
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
      color: var(--sz-text-muted, #6B6560);
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
      background: rgba(242, 145, 61, 0.12);
      color: var(--sz-orange-dark, #D97726);
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
      background: rgba(242, 145, 61, 0.12);
    }

    :host([has-highlight]) .field-row.hl.hl-target {
      background: rgba(90, 158, 111, 0.12);
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
      font-family: var(--sz-font-sans, system-ui);
      font-size: 11px;
      font-style: italic;
      color: var(--sz-text-muted, #6B6560);
      line-height: 1.4;
      padding: 2px 12px 4px 38px;
      background: rgba(45, 42, 38, 0.03);
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

  @state()
  private _collapsed = false;

  /** Whether a compact card has been expanded by the user to reveal its fields. */
  @state()
  private _compactExpanded = false;

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
    if (this.namespaceLabel) {
      // The namespace pill is the only visual marker that distinguishes a
      // namespaced schema card from a vanilla one. Expose a stable test id
      // (sl-3c2w) so Playwright can assert qualified namespace rendering
      // without text matching against a positioned <span>.
      return html`<div
          style="padding: 8px 12px 0; background: var(--sz-orange, #F2913D);"
          data-testid=${`${this.testIdPrefix}-namespace-pill`}
        >
          <span
            data-testid=${`${this.testIdPrefix}-namespace-label`}
            style="display:inline-block;font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,0.88);color:var(--sz-orange-dark, #D97726);"
          >${this.namespaceLabel}</span>
        </div>`;
    }
    if (this.compact) {
      const bg = this.schema && this._isReport(this.schema)
        ? "var(--sz-report, #4A90B8)"
        : "var(--sz-orange, #F2913D)";
      return html`<div style="height:24px;background:${bg};border-radius:var(--sz-card-radius, 8px) var(--sz-card-radius, 8px) 0 0;"></div>`;
    }
    return html``;
  }

  private _headerIcon(isReport: boolean) {
    if (isReport) {
      // Chart/report icon
      return html`<svg class="header-icon" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="2" width="14" height="12" rx="2" opacity="0.9"/>
        <rect x="4" y="8" width="2" height="4" rx="0.5" fill="rgba(255,255,255,0.6)"/>
        <rect x="7" y="5" width="2" height="7" rx="0.5" fill="rgba(255,255,255,0.6)"/>
        <rect x="10" y="7" width="2" height="5" rx="0.5" fill="rgba(255,255,255,0.6)"/>
      </svg>`;
    }
    // Table/schema icon
    return html`<svg class="header-icon" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="12" rx="2" opacity="0.9"/>
      <line x1="1" y1="6" x2="15" y2="6" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
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
          <span class="header-toggle" ?data-collapsed=${!this._compactExpanded}>&#9660;</span>
          <span class="header-count">${totalFields} fields</span>
        </div>
        ${metaPills.length > 0
          ? html`<div class="metadata-pills">
              ${metaPills.map(
                (m) => html`<span class="meta-pill"><span class="meta-key">${m.key}</span> ${m.value}</span>`
              )}
            </div>`
          : ""}
        ${this._compactExpanded
          ? html`<div class="fields">
              ${s.fields.map((f) => this._renderField(f, 0))}
            </div>`
          : ""}
      </div>
    `;
  }

  private _onCompactHeaderClick() {
    this._compactExpanded = !this._compactExpanded;
    this.style.overflow = this._compactExpanded ? "visible" : "";
    // Notify the parent viz so it can grow the canvas to fit the expanded fields.
    this.dispatchEvent(new Event("sz-compact-toggled", { bubbles: true, composed: true }));
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

import { LitElement, html, css, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { SchemaCard, FieldEntry } from "../model.js";
import { SzNavigateEvent, SzFieldHoverEvent, SzFieldLineageEvent } from "../satsuma-viz.js";
import { renderMarkdown } from "../markdown.js";
import type { FieldCoverageEntry } from "@satsuma/core/coverage";
import { uncoveredFieldCoverage } from "@satsuma/core/coverage";
import { toCoverageFields } from "../field-coverage.js";
import { summarizeFieldCoverage, countContainerStates } from "@satsuma/core/coverage-rollup";
import type { CoverageTotals, ContainerStateCounts } from "@satsuma/core/coverage-rollup";
import {
  HEADER_HEIGHT,
  META_PILL_ROW_GAP,
  META_PILL_ROW_HEIGHT,
  NAMESPACE_PILL_HEIGHT,
} from "../layout/geometry.js";

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
      /* The arrow is its own click target (toggle only, never navigate —
         sl-tw0r); pad it so the hit area is comfortably larger than the
         12px glyph. */
      padding: 4px 6px;
      margin: -4px -6px;
      cursor: pointer;
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

    /* Coverage not computed: neither filled nor the hollow ring that reads as a
       gap. A dashed, faded outline says "no verdict" rather than "no coverage"
       — see the coverage property's doc comment. */
    .port.unknown {
      border: 1.5px dashed var(--sz-text-muted);
      background: transparent;
      opacity: 0.45;
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

    /* Field-level metadata pill (sl-6x1o): same chip shape as constraint
       badges; the key is emphasised so "sensitivity internal" reads as
       key + value at a glance. */
    .badge.field-meta .badge-key {
      font-weight: 700;
      opacity: 0.85;
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
      /* Pills stack one per row and are EXCLUDED from the card's intrinsic
         width (contain: inline-size) — a long metadata value such as a
         namespace URI must never widen the card beyond what its field rows
         need (sl-dw9x). Overlong values end-truncate; the full text lives in
         each pill's title tooltip. Row heights are pinned to the shared
         geometry constants the layout estimates with. */
      contain: inline-size;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: ${META_PILL_ROW_GAP}px;
      padding: 4px 12px 6px;
      border-bottom: 1px solid var(--sz-card-border);
    }

    .meta-pill {
      font-family: var(--sz-font-sans);
      font-size: 10px;
      font-weight: 500;
      height: ${META_PILL_ROW_HEIGHT}px;
      box-sizing: border-box;
      padding: 1px 6px;
      border-radius: var(--sz-badge-radius);
      background: var(--sz-namespace-bg);
      color: var(--sz-text-muted);
      line-height: 1.4;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
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
      transition:
        opacity 0.1s,
        background 0.1s;
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

  /**
   * This schema's field coverage, as computed by `@satsuma/core` and carried in
   * the model — one entry per declared field, in declaration order.
   *
   * **Set by the parent; never derived here.** The card used to receive a set of
   * covered paths and work the rest out itself, which quietly cost it two
   * coverage rules it had no way to see: the resolved NL `@ref` tier (ADR-036)
   * and whole-structure conferral (ADR-037). Both live in core, and the card
   * disagreed with `satsuma coverage` on twelve shipped examples until it began
   * consuming core's verdicts instead (sl-46wr, sl-csrs).
   *
   * **`null` means "not computed", which is not "nothing is mapped".** The card
   * then shows a plain field count in place of a ratio and leaves every row
   * unmarked, because `0/N` would assert a completeness figure nobody produced.
   * A schema that genuinely no mapping references arrives as an all-uncovered
   * list instead, and does show `0/N`.
   */
  @property({ type: Array })
  coverage: FieldCoverageEntry[] | null = null;

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
        >${this.namespaceLabel}</span
      >
    </div>`;
  }

  private _headerIcon(isReport: boolean) {
    if (isReport) {
      // Chart/report icon
      return html`<svg class="header-icon" viewBox="0 0 16 16" fill="currentColor">
        <rect x="1" y="2" width="14" height="12" rx="2" opacity="0.9" />
        <rect x="4" y="8" width="2" height="4" rx="0.5" fill="var(--sz-icon-overlay-soft)" />
        <rect x="7" y="5" width="2" height="7" rx="0.5" fill="var(--sz-icon-overlay-soft)" />
        <rect x="10" y="7" width="2" height="5" rx="0.5" fill="var(--sz-icon-overlay-soft)" />
      </svg>`;
    }
    // Table/schema icon
    return html`<svg class="header-icon" viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="12" rx="2" opacity="0.9" />
      <line x1="1" y1="6" x2="15" y2="6" stroke="var(--sz-icon-divider)" stroke-width="1" />
    </svg>`;
  }

  override render() {
    const s = this.schema;
    if (!s) return html``;

    if (this.compact) return this._renderCompact(s);

    const coverage = this._coverage();
    const hasNotes = s.notes.length > 0;
    const metaPills = s.metadata.filter((m) => m.key !== "note");
    const isReport = this._isReport(s);

    return html`
      <div class=${this._collapsed ? "collapsed" : ""} data-testid=${this.testIdPrefix}>
        ${this._renderNamespacePill()}
        <div
          class="header ${isReport ? "report" : ""}"
          data-testid=${`${this.testIdPrefix}-header`}
          @click=${this._onHeaderClick}
        >
          ${this._headerIcon(isReport)}
          <span class="header-name">${s.id}</span>
          <!-- No ratio when coverage was not computed: a plain field count states
               what is known, where "0/N" would assert completeness nobody
               measured (ADR-042). -->
          <span
            class="header-count"
            data-testid=${`${this.testIdPrefix}-header-count`}
            data-coverage-available=${coverage !== null}
            title=${
              coverage
                ? this._coverageTitle(coverage.totals, coverage.containers)
                : "Coverage not computed for this schema"
            }
            >${
              coverage
                ? `${coverage.totals.covered}/${coverage.totals.total}`
                : `${this._leafCount(s)} fields`
            }</span
          >
          <span
            class="header-toggle"
            ?data-collapsed=${this._collapsed}
            @click=${this._onToggleClick}
            >&#9660;</span
          >
        </div>
        ${s.label ? html`<div class="label">${s.label}</div>` : ""}
        ${
          metaPills.length > 0
            ? html`<div class="metadata-pills">
                ${metaPills.map(
                  (m) =>
                    html`<span class="meta-pill" title=${`${m.key} ${m.value}`}
                      ><span class="meta-key">${m.key}</span> ${m.value}</span
                    >`,
                )}
              </div>`
            : ""
        }
        <div class="fields" data-testid=${`${this.testIdPrefix}-fields`}>
          ${s.fields.map((f) => this._renderField(f, 0))}
        </div>
        ${
          s.spreads.length > 0
            ? s.spreads.map(
                (sp) =>
                  html`<div class="spread-indicator">
                    <span class="spread-icon">&#8230;</span> spreads ${sp}
                  </div>`,
              )
            : ""
        }
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
        ${
          this._notesExpanded
            ? notes.map(
                (n) => html`<div class="note-content">${unsafeHTML(renderMarkdown(n.text))}</div>`,
              )
            : ""
        }
      </div>
    `;
  }

  private _toggleNotes(e: Event) {
    e.stopPropagation();
    this._notesExpanded = !this._notesExpanded;
  }

  private _renderField(f: FieldEntry, depth: number, prefix = ""): TemplateResult {
    const fieldPath = prefix ? `${prefix}.${f.name}` : f.name;
    // Three states, not two. With `coverage` null nothing was computed, and a row
    // must not then read as a gap: the header says no figure was produced, and a
    // hollow "unmapped" dot beside it would contradict it — a reader would see
    // every field as unmapped, and automation could not tell those rows from real
    // uncovered results.
    const unavailable = this.coverage === null;
    const entry = unavailable ? undefined : this._coverageByPath().get(fieldPath);
    // A record is "mapped" as soon as anything beneath it is, which is the
    // threshold a port dot has always painted on; `state` carries the finer
    // distinction for anyone who needs it.
    const isMapped = entry?.mapped ?? false;
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
    // `unknown` rather than `unmapped`/`uncovered`: those two are verdicts, and
    // there is no verdict here. Automation keys on these, so the third state has
    // to be nameable.
    const coverageState = unavailable ? "unknown" : isMapped ? "mapped" : "unmapped";
    const portClass = unavailable ? "unknown" : isMapped ? "mapped" : "unmapped";

    return html`
      <div
        class="field-row ${depth > 0 ? "nested" : ""} ${hlClass}"
        data-testid=${fieldTestId}
        data-coverage=${coverageState}
        data-coverage-state=${unavailable ? "unknown" : (entry?.state ?? "uncovered")}
        data-coverage-tier=${entry?.tier ?? ""}
        style=${depth > 0 ? `padding-left: ${12 + depth * 20}px` : ""}
        @click=${() => this._navigate(f.location)}
        @mouseenter=${() => this._onFieldHover(fieldPath)}
        @mouseleave=${() => this._onFieldHover(null)}
        title=${this._fieldTitle(f, entry)}
      >
        <span class="port ${portClass}"></span>
        <span class="field-name">${f.name}</span>
        <span class="field-type">${f.type}</span>
        <span class="badges">
          ${f.constraints
            .filter((c) => c !== "pii")
            .map((c) => html`<span class="badge">${c}</span>`)}
          ${hasPii ? html`<span class="badge pii" title="PII">&#128737; pii</span>` : ""}
          ${this._fieldMetaPills(f).map(
            (m) =>
              html`<span class="badge field-meta" title=${`${m.key} ${m.value}`.trim()}
                ><span class="badge-key">${m.key}</span>${m.value ? ` ${m.value}` : ""}</span
              >`,
          )}
        </span>
        ${
          hasWarning
            ? html`<span class="comment-badge warning" title=${this._commentText(f, "warning")}
                >&#9888;</span
              >`
            : ""
        }
        ${
          hasQuestion
            ? html`<span class="comment-badge question" title=${this._commentText(f, "question")}
                >?</span
              >`
            : ""
        }
        <button
          class="lineage-btn"
          data-testid=${`${fieldTestId}-lineage`}
          title="Show field lineage"
          @click=${(e: Event) => {
            e.stopPropagation();
            this._onFieldLineage(fieldPath);
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle cx="2" cy="6" r="1.5" fill="currentColor" />
            <circle cx="10" cy="3" r="1.5" fill="currentColor" />
            <circle cx="10" cy="9" r="1.5" fill="currentColor" />
            <line x1="3.5" y1="5.3" x2="8.5" y2="3.7" stroke="currentColor" stroke-width="1.2" />
            <line x1="3.5" y1="6.7" x2="8.5" y2="8.3" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>
      ${
        f.notes.length > 0
          ? f.notes.map(
              (n) =>
                html`<div
                  class="field-note"
                  style=${depth > 0 ? `padding-left: ${38 + depth * 20}px` : ""}
                >
                  ${n.text}
                </div>`,
            )
          : ""
      }
      ${f.children.map((child) => this._renderField(child, depth + 1, fieldPath))}
    `;
  }

  /**
   * Metadata entries to render as pills on a field row: everything the author
   * wrote except entries already rendered elsewhere on the row (sl-6x1o).
   * Key-value entries always render — `sensitivity internal` and
   * `access_group property_facilities` must be visible, and a kv whose key is
   * also a constraint tag (e.g. `encrypt aes`) carries a value the badge
   * alone would hide. Excluded:
   *   - bare tags already shown as constraint badges
   *   - `note` entries, which render as the shaded field-note row below the
   *     field (sl-1gqw) — same dedupe the schema-level pills apply
   */
  private _fieldMetaPills(f: FieldEntry) {
    // Tolerate models serialized before FieldEntry carried metadata (older
    // LSP servers, cached webview payloads) — render no pills, don't crash.
    return (f.metadata ?? []).filter(
      (m) => m.key !== "note" && !(m.value === "" && f.constraints.includes(m.key)),
    );
  }

  private _commentText(f: FieldEntry, kind: "warning" | "question"): string {
    return f.comments
      .filter((c) => c.kind === kind)
      .map((c) => c.text)
      .join("\n");
  }

  /**
   * `coverage` indexed by field path, for the row renderer.
   *
   * Rebuilt only when the `coverage` array identity changes: `_renderField` runs
   * once per row and a linear scan per row would make rendering quadratic in the
   * field count, which a wide schema card notices.
   */
  private _coverageIndex: Map<string, FieldCoverageEntry> | null = null;
  private _coverageIndexFor: FieldCoverageEntry[] | null | undefined = undefined;

  private _coverageByPath(): Map<string, FieldCoverageEntry> {
    if (this._coverageIndexFor !== this.coverage || this._coverageIndex === null) {
      this._coverageIndex = new Map((this.coverage ?? []).map((entry) => [entry.path, entry]));
      this._coverageIndexFor = this.coverage;
    }
    return this._coverageIndex;
  }

  /**
   * The card's coverage figures, counted by core from the entries it was given.
   *
   * **The card computes neither the verdicts nor the denominator.** It used to do
   * both, and lost a rule each time one was added. `_countFields`/`_countMapped`
   * counted every node, records included, so a schema of `amount` plus `address
   * record { city, line1, postcode }` with only `address.city` mapped read as 2/5
   * — 40% — where `satsuma coverage` reported 25% (sl-hcan); coverage is counted
   * in *leaves* because a record is structure, not data. Deriving the covered set
   * from the model's arrows then missed the NL `@ref` tier and whole-structure
   * conferral (sl-46wr, sl-csrs). Both jobs now belong to core, and this method
   * is the whole of what is left.
   *
   * Container states come back beside the ratio rather than inside it — a
   * reviewer wants to know two records are partly mapped, but that fact must not
   * enter the number.
   *
   * `null` when coverage was not computed — see {@link coverage}. Callers must
   * render the absence rather than substitute zeroes.
   */
  private _coverage(): {
    totals: CoverageTotals;
    containers: ContainerStateCounts;
  } | null {
    if (this.coverage === null) return null;
    return {
      totals: summarizeFieldCoverage(this.coverage),
      containers: countContainerStates(this.coverage),
    };
  }

  /**
   * The schema's leaf count, for the header when there is no ratio to show.
   *
   * Counted by core from an all-uncovered projection of the declared fields, not
   * by the card: "how many fields?" must be answered in leaves, the same unit the
   * ratio is denominated in (ADR-034), or a compact card and an expanded one
   * disagree about the same schema (sl-hcan).
   */
  private _leafCount(s: SchemaCard): number {
    return summarizeFieldCoverage(
      uncoveredFieldCoverage(toCoverageFields(s.fields), s.location.uri),
    ).total;
  }

  /**
   * A field row's tooltip: its type, plus how it came to be covered when that is
   * not the ordinary case.
   *
   * The NL tier is called out because ADR-036 requires a consumer to *show* the
   * distinction rather than let a reader assume every covered field has an arrow:
   * a hop inferred from prose is a weaker claim than a declared one, and a
   * reviewer has to be able to tell which they are looking at. `partial` is
   * called out for the same reason — a record row's dot says "something under
   * here is mapped" and cannot say "not all of it".
   *
   * When coverage was not computed the row says so, rather than saying nothing
   * and leaving the bare type to be read alongside an unmarked dot as a gap.
   */
  private _fieldTitle(f: FieldEntry, entry: FieldCoverageEntry | undefined): string {
    const base = `${f.name}: ${f.type}`;
    if (this.coverage === null) return `${base} — coverage not computed`;
    if (!entry?.mapped) return base;
    const how = entry.tier === "nl" ? "mapped via an @ref in prose" : "mapped";
    return entry.state === "partial" ? `${base} — partly ${how}` : `${base} — ${how}`;
  }

  /**
   * Tooltip spelling out what the `covered/total` header count means, since the
   * bare ratio cannot say that records are excluded from it, nor that some of
   * them are partly mapped. Partly-mapped records are the reviewable state — a
   * record every leaf of which is covered needs no attention, and one with no
   * covered leaf is already visible as uncovered rows — so only that count is
   * worth a phrase of its own.
   */
  private _coverageTitle(totals: CoverageTotals, containers: ContainerStateCounts): string {
    const ratio = `${totals.covered}/${totals.total} leaf fields mapped (${totals.pct}%)`;
    if (containers.partial === 0) return ratio;
    const noun = containers.partial === 1 ? "record" : "records";
    return `${ratio} — ${containers.partial} ${noun} partly mapped`;
  }

  private _renderCompact(s: SchemaCard) {
    const displayName = s.id;
    // Leaf count, the same unit the expanded card's ratio is denominated in
    // (ADR-034). One card must not answer "how many fields?" two ways depending
    // on whether it happens to be compact — and the compact header shows a count
    // rather than a ratio, so it needs no coverage at all.
    const totalFields = this._leafCount(s);
    const metaPills = s.metadata.filter((m) => m.key !== "note");
    const isReport = this._isReport(s);

    return html`
      <div>
        ${this._renderNamespacePill()}
        <div class="header ${isReport ? "report" : ""}" @click=${this._onHeaderClick}>
          ${this._headerIcon(isReport)}
          <span class="header-name">${displayName}</span>
          <span
            class="header-toggle"
            ?data-collapsed=${!this.compactExpanded}
            @click=${this._onToggleClick}
            >&#9660;</span
          >
          <span class="header-count">${totalFields} fields</span>
        </div>
        ${
          metaPills.length > 0
            ? html`<div class="metadata-pills">
                ${metaPills.map(
                  (m) =>
                    html`<span class="meta-pill" title=${`${m.key} ${m.value}`}
                      ><span class="meta-key">${m.key}</span> ${m.value}</span
                    >`,
                )}
              </div>`
            : ""
        }
        ${
          this.compactExpanded
            ? html`<div class="fields">${s.fields.map((f) => this._renderField(f, 0))}</div>`
            : ""
        }
      </div>
    `;
  }

  // Header clicks carry two distinct intents that used to be conflated on one
  // handler: the toggle arrow expands/collapses, the rest of the header
  // navigates to the schema source. Hosts that open documents on navigate
  // (VS Code) made the combined handler unusable — expanding a card yanked
  // the editor to the source file and hid the panel (sl-tw0r).

  /** Arrow click: expand/collapse only — never navigate. */
  private _onToggleClick(e: Event) {
    // Stop the click before the header's navigate handler sees it.
    e.stopPropagation();
    if (this.compact) {
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
    } else {
      this._collapsed = !this._collapsed;
    }
  }

  /** Header (name/icon) click: navigation intent only. */
  private _onHeaderClick() {
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

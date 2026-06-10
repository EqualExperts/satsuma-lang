import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, property, state } from "lit/decorators.js";
import type {
  MappingBlock,
  SchemaCard,
  ArrowEntry,
  EachBlock,
  FlattenBlock,
} from "../model.js";
import { SzNavigateEvent, SzFieldHoverEvent } from "../satsuma-viz.js";
import { resolveSchemaLocalFieldPath } from "../field-coverage.js";
import { highlightAtRefs } from "../markdown.js";

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

/**
 * Three-column mapping detail view.
 *
 * Left:   source schema cards (full fields)
 * Center: mapping header + arrow table
 * Right:  target schema card (full fields)
 *
 * Supports bidirectional hover cross-highlighting between the arrow table
 * and the schema cards.
 */
@customElement("sz-mapping-detail")
export class SzMappingDetail extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: var(--sz-font-sans);
    }

    .layout {
      display: grid;
      grid-template-columns: max-content max-content max-content;
      gap: 16px;
      align-items: start;
      width: max-content;
      min-width: 100%;
    }

    /* Let schema cards grow to their content width instead of truncating to the viewport. */
    .column sz-schema-card {
      --sz-card-max-width: none;
      width: max-content;
      box-sizing: border-box;
    }

    .column {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: max-content;
      min-width: 280px;
    }

    .column-header {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--sz-text-muted);
      padding: 0 4px 4px;
      border-bottom: 1px solid var(--sz-card-border);
    }

    /* Mapping header */
    .mapping-header {
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      border-radius: var(--sz-card-radius);
      box-shadow: var(--sz-card-shadow);
      overflow: hidden;
      width: max-content;
      min-width: 100%;
    }

    .mapping-title {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--sz-orange);
      color: var(--sz-text-on-accent);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }

    .mapping-title:hover {
      filter: brightness(0.95);
    }

    .mapping-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--sz-card-border);
    }

    .mapping-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: flex-start;
    }

    .meta-tag {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--sz-badge-bg);
      color: var(--sz-text-muted);
      max-width: 100%;
    }

    .meta-tag .label {
      color: var(--sz-orange-dark);
      font-weight: 500;
    }

    .meta-tag.wrap {
      max-width: 600px;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    /* Arrow table */
    .arrow-table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
    }

    .arrow-table th {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--sz-text-muted);
      text-align: left;
      padding: 6px 12px;
      border-bottom: 2px solid var(--sz-card-border);
    }

    .arrow-table td {
      padding: 5px 12px;
      border-bottom: 1px solid var(--sz-card-border);
      font-size: 12px;
      vertical-align: top;
    }

    .arrow-table tr {
      cursor: pointer;
      transition: opacity 0.15s ease, background 0.15s ease;
    }

    .arrow-table tr:hover {
      background: var(--sz-row-hover-bg);
    }

    /* Cross-highlighting on arrow rows */
    :host([has-highlight]) .arrow-table tr.arrow-row {
      opacity: 0.5;
    }

    :host([has-highlight]) .arrow-table tr.arrow-row.hl {
      opacity: 1;
      background: var(--sz-accent-wash);
    }

    :host([has-highlight]) .arrow-table tr.arrow-row.hl .field-ref {
      font-weight: 700;
    }

    .field-ref {
      font-family: var(--sz-font-mono, monospace);
      font-size: 12px;
      font-weight: 500;
      color: var(--sz-text);
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .source-ref-list {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      max-width: 280px;
    }

    .source-ref-item {
      display: block;
    }

    .transform-cell {
      width: 400px;
      max-width: 400px;
      min-width: 320px;
      text-align: left;
    }

    .transform-nl {
      display: inline-block;
      font-style: italic;
      font-size: 11px;
      color: var(--sz-green);
      max-width: 400px;
      white-space: normal;
      word-break: break-word;
      overflow-wrap: anywhere;
      text-align: left;
    }

    .transform-bare {
      font-size: 11px;
      color: var(--sz-text-muted);
    }

    /* @ref highlights inside NL transform text */
    .at-ref {
      font-weight: 600;
      font-style: normal;
      color: var(--sz-at-ref);
    }

    .arrow-icon {
      color: var(--sz-text-muted);
      font-size: 11px;
    }

    /* Note row displayed beneath an arrow that carries a (note "...") tag. */
    .arrow-note-row td {
      padding: 0 12px 6px;
    }

    .arrow-note {
      font-family: var(--sz-font-sans);
      font-size: 11px;
      font-style: italic;
      color: var(--sz-text-muted);
      line-height: 1.4;
      padding: 2px 8px;
      background: var(--sz-row-hover-bg);
      border-radius: 3px;
      max-width: 400px;
      word-break: break-word;
    }

    /* Scope sections (each/flatten) */
    .scope-section {
      margin: 4px 0;
    }

    .scope-label {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--sz-text-muted);
      background: var(--sz-namespace-bg);
      border-top: 1px dashed var(--sz-card-border);
    }

    .scope-label .scope-tag {
      font-family: var(--sz-font-mono);
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--sz-orange-dark);
      color: var(--sz-text-on-accent);
    }

    .scope-fields {
      font-family: var(--sz-font-mono);
      font-size: 11px;
      color: var(--sz-text);
    }
  `;

  @property({ type: Object })
  mapping: MappingBlock | null = null;

  /** Source schema cards to show on the left. */
  @property({ type: Array })
  sourceSchemas: SchemaCard[] = [];

  /** Target schema card to show on the right. */
  @property({ type: Object })
  targetSchema: SchemaCard | null = null;

  /** Set of mapped field names for source schemas. */
  @property({ type: Object })
  sourceMappedFields: Map<string, Set<string>> = new Map();

  /** Set of mapped field names for the target schema. */
  @property({ type: Object })
  targetMappedFields: Set<string> = new Set();

  @property({ type: String, attribute: "namespace-label" })
  namespaceLabel: string | null = null;

  @property({ type: String, attribute: "test-id-prefix" })
  testIdPrefix = "mapping-detail";

  /** Currently hovered arrow (from table row hover). */
  @state()
  private _hoveredArrow: ArrowEntry | null = null;

  /** Field name hovered from a schema card (via field-hover event). */
  @state()
  private _hoveredCardField: string | null = null;

  /** Schema ID of the card whose field is hovered. */
  @state()
  private _hoveredCardSchema: string | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener("field-hover", this._onFieldHover as EventListener);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("field-hover", this._onFieldHover as EventListener);
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has("_hoveredArrow") || changed.has("_hoveredCardField")) {
      if (this._hoveredArrow || this._hoveredCardField) {
        this.setAttribute("has-highlight", "");
      } else {
        this.removeAttribute("has-highlight");
      }
    }
  }

  private _onFieldHover = ((e: SzFieldHoverEvent) => {
    this._hoveredCardSchema = e.schemaId;
    this._hoveredCardField = e.fieldName;
    // Clear table row hover when card field is hovered
    if (e.fieldName) this._hoveredArrow = null;
  }) as EventListener;

  /** Compute which source fields should be highlighted. */
  private get _sourceHighlightFields(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const m = this.mapping;
    if (!m) return result;
    const sourceSchemaById = new Map(
      this.sourceSchemas.map((schema) => [schema.qualifiedId, schema] as const),
    );

    if (this._hoveredArrow) {
      for (const sr of m.sourceRefs) {
        const fields = new Set<string>();
        const schema = sourceSchemaById.get(sr);
        if (!schema) continue;
        for (const sf of this._hoveredArrow.sourceFields) {
          const localPath = resolveSchemaLocalFieldPath(sf, schema, m.sourceRefs);
          if (localPath) fields.add(localPath);
        }
        if (fields.size > 0) result.set(sr, fields);
      }
    } else if (this._hoveredCardField && this._hoveredCardSchema) {
      if (this._hoveredCardSchema === m.targetRef) {
        return this._findSourceFieldsForTarget(this._hoveredCardField, m);
      } else if (m.sourceRefs.includes(this._hoveredCardSchema)) {
        result.set(
          this._hoveredCardSchema,
          new Set([this._hoveredCardField])
        );
      }
    }

    return result;
  }

  /** Compute which target fields should be highlighted. */
  private get _targetHighlightFields(): Set<string> {
    const m = this.mapping;
    if (!m) return new Set();
    const targetSchema = this.targetSchema;

    if (this._hoveredArrow) {
      if (!targetSchema) return new Set();
      const localPath = resolveSchemaLocalFieldPath(
        this._hoveredArrow.targetField,
        targetSchema,
        [m.targetRef],
      );
      return localPath ? new Set([localPath]) : new Set();
    }

    if (this._hoveredCardField && this._hoveredCardSchema) {
      if (m.sourceRefs.includes(this._hoveredCardSchema)) {
        return this._findTargetFieldsForSource(
          this._hoveredCardField,
          this._hoveredCardSchema,
          m,
        );
      } else if (this._hoveredCardSchema === m.targetRef) {
        return new Set([this._hoveredCardField]);
      }
    }

    return new Set();
  }

  /** Find source fields that map to a given target field, grouped by schema id. */
  private _findSourceFieldsForTarget(targetField: string, m: MappingBlock): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const sourceSchemaById = new Map(
      this.sourceSchemas.map((schema) => [schema.qualifiedId, schema] as const),
    );
    const search = (arrows: ArrowEntry[]) => {
      for (const a of arrows) {
        const targetSchema = this.targetSchema;
        const localTargetPath = targetSchema
          ? resolveSchemaLocalFieldPath(a.targetField, targetSchema, [m.targetRef])
          : null;
        if (localTargetPath === targetField) {
          for (const sourceSchema of this.sourceSchemas) {
            for (const sf of a.sourceFields) {
              const localSourcePath = resolveSchemaLocalFieldPath(sf, sourceSchema, m.sourceRefs);
              if (!localSourcePath) continue;
              if (!result.has(sourceSchema.qualifiedId)) result.set(sourceSchema.qualifiedId, new Set());
              result.get(sourceSchema.qualifiedId)!.add(localSourcePath);
            }
          }
        }
      }
    };
    search(m.arrows);
    for (const eb of m.eachBlocks) search(eb.arrows);
    for (const fb of m.flattenBlocks) search(fb.arrows);
    return result;
  }

  /** Find target fields that a given source field maps to. */
  private _findTargetFieldsForSource(sourceField: string, sourceSchemaId: string, m: MappingBlock): Set<string> {
    const result = new Set<string>();
    const sourceSchema = this.sourceSchemas.find((schema) => schema.qualifiedId === sourceSchemaId);
    const targetSchema = this.targetSchema;
    if (!sourceSchema || !targetSchema) return result;
    const search = (arrows: ArrowEntry[]) => {
      for (const a of arrows) {
        const sourceMatches = a.sourceFields.some((sf) => {
          const localSourcePath = resolveSchemaLocalFieldPath(sf, sourceSchema, m.sourceRefs);
          return localSourcePath === sourceField;
        });
        if (sourceMatches) {
          const localTargetPath = resolveSchemaLocalFieldPath(a.targetField, targetSchema, [m.targetRef]);
          if (localTargetPath) result.add(localTargetPath);
        }
      }
    };
    search(m.arrows);
    for (const eb of m.eachBlocks) search(eb.arrows);
    for (const fb of m.flattenBlocks) search(fb.arrows);
    return result;
  }

  /** Check if an arrow row should be highlighted. */
  private _isArrowHighlighted(a: ArrowEntry): boolean {
    if (this._hoveredArrow === a) return true;
    if (!this._hoveredCardField || !this._hoveredCardSchema) return false;

    const m = this.mapping!;
    if (m.sourceRefs.includes(this._hoveredCardSchema)) {
      const sourceSchema = this.sourceSchemas.find((schema) => schema.qualifiedId === this._hoveredCardSchema);
      return !!sourceSchema && a.sourceFields.some((sf) => {
        const localSourcePath = resolveSchemaLocalFieldPath(sf, sourceSchema, m.sourceRefs);
        return localSourcePath === this._hoveredCardField;
      });
    } else if (this._hoveredCardSchema === m.targetRef) {
      const targetSchema = this.targetSchema;
      if (!targetSchema) return false;
      const localTargetPath = resolveSchemaLocalFieldPath(a.targetField, targetSchema, [m.targetRef]);
      return localTargetPath === this._hoveredCardField;
    }
    return false;
  }

  override render() {
    const m = this.mapping;
    if (!m) return html`<div>No mapping selected</div>`;

    const sourceHL = this._sourceHighlightFields;
    const targetHL = this._targetHighlightFields;

    // Distinct test-id prefixes for source vs target schema cards keep
    // Playwright selectors unambiguous when the same schema id appears as both
    // a source somewhere and a target elsewhere (sl-eikr).
    const sourcePrefix = `${this.testIdPrefix}-source-schema-card`;
    const targetPrefix = `${this.testIdPrefix}-target-schema-card`;

    return html`
      <div class="layout" data-testid=${this.testIdPrefix}>
        <div class="column" data-testid=${`${this.testIdPrefix}-source-column`}>
          <div class="column-header">Sources</div>
          ${this.sourceSchemas.map((s) => html`
            <sz-schema-card
              .schema=${s}
              .mappedFields=${this.sourceMappedFields.get(s.qualifiedId) ?? new Set()}
              .highlightFields=${sourceHL.get(s.qualifiedId) ?? new Set()}
              highlightColor="source"
              test-id-prefix=${`${sourcePrefix}-${sanitizeTestIdSegment(s.qualifiedId)}`}
              content-width
            ></sz-schema-card>
          `)}
        </div>

        <div class="column" data-testid=${`${this.testIdPrefix}-mapping-column`}>
          <div class="column-header">Mapping</div>
          ${this._renderMappingHeader(m)}
          ${this._renderArrowTable(m)}
        </div>

        <div class="column" data-testid=${`${this.testIdPrefix}-target-column`}>
          <div class="column-header">Target</div>
          ${this.targetSchema
            ? html`<sz-schema-card
                .schema=${this.targetSchema}
                .mappedFields=${this.targetMappedFields}
                .highlightFields=${targetHL}
                highlightColor="target"
                test-id-prefix=${`${targetPrefix}-${sanitizeTestIdSegment(this.targetSchema.qualifiedId)}`}
                content-width
              ></sz-schema-card>`
            : nothing}
        </div>
      </div>
    `;
  }

  private _renderMappingHeader(m: MappingBlock) {
    const sb = m.sourceBlock;

    return html`
      <div class="mapping-header" data-testid=${`${this.testIdPrefix}-header`}>
        ${this.namespaceLabel
          ? html`<div style="padding: 8px 12px 0; background: var(--sz-orange);">
              <span
                class="meta-tag"
                data-testid=${`${this.testIdPrefix}-namespace-label`}
                style="display:inline-block;font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--sz-namespace-pill-chip-bg);color:var(--sz-orange-dark);"
              >${this.namespaceLabel}</span>
            </div>`
          : nothing}
        <div class="mapping-title" @click=${() => this._navigate(m.location)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 4h5l2 2h5v8H2V4z" opacity="0.9"/>
          </svg>
          ${m.id}
        </div>
        <div class="mapping-meta">
          ${m.sourceRefs.map((s) => html`
            <div class="mapping-meta-row">
              <span class="meta-tag"><span class="label">source</span> ${s}</span>
            </div>
          `)}
          <div class="mapping-meta-row">
            <span class="meta-tag"><span class="label">target</span> ${m.targetRef}</span>
          </div>
          ${sb?.joinDescription
            ? html`
                <div class="mapping-meta-row">
                  <span class="meta-tag wrap"><span class="label">join</span> ${sb.joinDescription}</span>
                </div>
              `
            : nothing}
          ${(sb?.filters ?? []).map((f) => html`
            <div class="mapping-meta-row">
              <span class="meta-tag wrap"><span class="label">filter</span> ${f}</span>
            </div>
          `)}
          ${m.metadata.map((entry) => html`
            <div class="mapping-meta-row" data-testid=${`${this.testIdPrefix}-meta-${sanitizeTestIdSegment(entry.key)}`}>
              <span class="meta-tag wrap"><span class="label">${entry.key}</span> ${entry.value}</span>
            </div>
          `)}
        </div>
      </div>
    `;
  }

  private _renderArrowTable(m: MappingBlock) {
    return html`
      <div class="mapping-header" style="padding: 0;">
        <table class="arrow-table" data-testid=${`${this.testIdPrefix}-arrow-table`}>
          <thead>
            <tr>
              <th>Source</th>
              <th></th>
              <th>Transform</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            ${m.arrows.map((a) => this._renderArrowRow(a, ""))}
            ${m.eachBlocks.map((eb) => this._renderEachSection(eb, ""))}
            ${m.flattenBlocks.map((fb) => this._renderFlattenSection(fb, ""))}
          </tbody>
        </table>
      </div>
    `;
  }

  // sectionPrefix disambiguates arrow rows that share a target field across
  // nested each/flatten sections (sl-eikr). Empty string for top-level rows.
  private _renderArrowRow(a: ArrowEntry, sectionPrefix: string): TemplateResult {
    const hl = this._isArrowHighlighted(a) ? "hl" : "";
    const noteEntry = a.metadata.find((m) => m.key === "note");
    const targetId = sanitizeTestIdSegment(a.targetField);
    const rowTestId = sectionPrefix
      ? `${this.testIdPrefix}-arrow-row-${sectionPrefix}-${targetId}`
      : `${this.testIdPrefix}-arrow-row-${targetId}`;

    return html`
      <tr
        class="arrow-row ${hl}"
        data-testid=${rowTestId}
        @click=${() => this._navigate(a.location)}
        @mouseenter=${() => { this._hoveredArrow = a; this._hoveredCardField = null; }}
        @mouseleave=${() => { this._hoveredArrow = null; }}
      >
        <td>
          <div class="source-ref-list">
            ${a.sourceFields.map((sourceField) => html`
              <span class="field-ref source-ref-item">${sourceField}</span>
            `)}
          </div>
        </td>
        <td><span class="arrow-icon">&#x2192;</span></td>
        <td class="transform-cell">${this._renderTransform(a)}</td>
        <td><span class="field-ref">${a.targetField}</span></td>
      </tr>
      ${noteEntry
        ? html`<tr
            class="arrow-note-row"
            data-testid=${`${rowTestId}-note`}
          ><td colspan="4"><span class="arrow-note">${unsafeHTML(highlightAtRefs(noteEntry.value))}</span></td></tr>`
        : ""}
    `;
  }

  private _renderTransform(a: ArrowEntry): TemplateResult {
    if (!a.transform) {
      return html`<span class="transform-bare">direct</span>`;
    }

    const t = a.transform;
    // After Feature 28, all transforms render uniformly as NL text.
    // @refs (e.g. @status, @arr_value) are wrapped in bold spans for emphasis.
    return html`<span class="transform-nl">${unsafeHTML(highlightAtRefs(t.text))}</span>`;
  }

  private _renderEachSection(eb: EachBlock, parentPrefix: string): TemplateResult {
    const sectionId = sanitizeTestIdSegment(`each-${eb.targetField}`);
    const sectionPrefix = parentPrefix ? `${parentPrefix}-${sectionId}` : sectionId;
    return html`
      <tr
        class="scope-section"
        data-testid=${`${this.testIdPrefix}-${sectionPrefix}`}
      >
        <td colspan="4">
          <div class="scope-label">
            <span class="scope-tag">each</span>
            <span class="scope-fields">${eb.sourceField} &#x2192; ${eb.targetField}</span>
          </div>
        </td>
      </tr>
      ${eb.arrows.map((a) => this._renderArrowRow(a, sectionPrefix))}
      ${eb.nestedEach.map((ne) => this._renderEachSection(ne, sectionPrefix))}
    `;
  }

  private _renderFlattenSection(fb: FlattenBlock, parentPrefix: string): TemplateResult {
    const sectionId = sanitizeTestIdSegment(`flatten-${fb.sourceField}`);
    const sectionPrefix = parentPrefix ? `${parentPrefix}-${sectionId}` : sectionId;
    return html`
      <tr
        class="scope-section"
        data-testid=${`${this.testIdPrefix}-${sectionPrefix}`}
      >
        <td colspan="4">
          <div class="scope-label">
            <span class="scope-tag">flatten</span>
            <span class="scope-fields">${fb.sourceField}</span>
          </div>
        </td>
      </tr>
      ${fb.arrows.map((a) => this._renderArrowRow(a, sectionPrefix))}
    `;
  }

  private _navigate(loc: import("../model.js").SourceLocation) {
    this.dispatchEvent(new SzNavigateEvent(loc));
  }
}

import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, property, state } from "lit/decorators.js";
import type {
  MappingBlock,
  SchemaCard,
  ArrowEntry,
  EachBlock,
  FlattenBlock,
  NestedArrowBlock,
  NoteBlock,
} from "../model.js";
import { SzNavigateEvent, SzFieldHoverEvent } from "../satsuma-viz.js";
import {
  MAPPING_BODY_SCOPE,
  forEachMappingArrow,
  resolveSchemaLocalFieldPath,
  scopeWithin,
} from "../field-coverage.js";
import type { ContainerScope, MappingArrowVisit } from "../field-coverage.js";
import { highlightAtRefs, renderMarkdown } from "../markdown.js";
import { noteSectionStyles, renderNotesSection } from "../notes.js";
import { qualifyChildArrowPath } from "@satsuma/core/extract";
import { extractAtRefs } from "@satsuma/core/nl-ref";
import type { SchemaCoverage } from "../field-coverage.js";

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
 * Metadata key carrying note text. A `note` may be written either as a
 * structural `note { }` block or as a `( note "..." )` metadata entry
 * (SATSUMA-V2-SPEC.md:225 and :242); the two are the same thing to a reader,
 * so both render in the notes section and neither renders as a metadata pill.
 */
const NOTE_METADATA_KEY = "note";

/**
 * Adapt a mapping's `( note "..." )` metadata entries into note blocks so they
 * render beside the structural `note { }` blocks.
 *
 * `isMultiline` is false because a metadata note is written inline; the
 * mapping's own location is reused since a `MetadataEntry` carries none, and
 * the notes section does not navigate.
 */
function metadataNotesAsBlocks(m: MappingBlock): NoteBlock[] {
  return (m.metadata ?? [])
    .filter((entry) => entry.key === NOTE_METADATA_KEY)
    .map((entry) => ({ text: entry.value, isMultiline: false, location: m.location }));
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
  static override styles = [
    noteSectionStyles,
    css`
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

      /* Stated empty state for a mapping with no field arrows (sl-jetk). Muted
       and italic so it reads as an explanation, not as table content. */
      .arrow-table-empty {
        padding: 10px 12px;
        font-size: 12px;
        font-style: italic;
        line-height: 1.5;
        color: var(--sz-text-muted);
      }

      .arrow-table td {
        padding: 5px 12px;
        border-bottom: 1px solid var(--sz-card-border);
        font-size: 12px;
        vertical-align: top;
      }

      .arrow-table tr {
        cursor: pointer;
        transition:
          opacity 0.15s ease,
          background 0.15s ease;
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

      /* Marker for an arrow with no source field (sl-k7i4). Deliberately not a
       .field-ref: sans-serif, italic and muted so it cannot be misread as a
       field path, and so highlight styling for real paths never applies to it. */
      .source-derived {
        font-family: var(--sz-font-sans);
        font-size: 11px;
        font-style: italic;
        color: var(--sz-text-muted);
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

      /*
       * An arrow note's body is Markdown like any other note (vnm-bak4), so the
       * block elements renderMarkdown emits need spacing tuned for a row
       * squeezed between two arrows. Margins are tighter than .note-content's
       * for that reason, and the last child drops its margin so a one-line note
       * — by far the common case — keeps the compact single-line row it had
       * before Markdown rendering was wired up.
       */
      .arrow-note p {
        margin: 0 0 4px;
      }

      .arrow-note p:last-child,
      .arrow-note ul:last-child,
      .arrow-note ol:last-child {
        margin-bottom: 0;
      }

      .arrow-note h1,
      .arrow-note h2,
      .arrow-note h3 {
        font-size: 11px;
        font-weight: 700;
        font-style: normal;
        margin: 4px 0 2px;
      }

      .arrow-note ul,
      .arrow-note ol {
        margin: 0 0 4px;
        padding-left: 16px;
      }

      .arrow-note li {
        margin: 1px 0;
      }

      .arrow-note code {
        font-family: var(--sz-font-mono);
        font-style: normal;
        font-size: 10px;
        background: var(--sz-row-active-bg);
        padding: 1px 4px;
        border-radius: 3px;
      }

      .arrow-note strong {
        font-weight: 700;
        color: var(--sz-text);
      }

      /* The mapping-level notes section sits under the mapping header, so it
         needs the card border treatment the shared styles assume plus a
         background matching the surrounding mapping column. */
      .mapping-notes {
        background: var(--sz-card-bg);
        border-bottom: 1px solid var(--sz-card-border);
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
    `,
  ];

  @property({ type: Object })
  mapping: MappingBlock | null = null;

  /** Source schema cards to show on the left. */
  @property({ type: Array })
  sourceSchemas: SchemaCard[] = [];

  /** Target schema card to show on the right. */
  @property({ type: Object })
  targetSchema: SchemaCard | null = null;

  /**
   * Core's coverage entries for each source schema, keyed by `qualifiedId`.
   *
   * Source and target coverage are separate properties because they answer
   * separate questions — what this mapping *reads* versus what it *writes* — and
   * one schema can legitimately appear on both sides of one mapping.
   */
  @property({ type: Object })
  sourceCoverage: Map<string, SchemaCoverage> = new Map();

  /** Core's coverage entries for the target schema, or null when not computed. */
  @property({ type: Array })
  targetCoverage: SchemaCoverage = null;

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

  /**
   * Whether the mapping-level notes section is expanded.
   *
   * Defaults to open, matching `sz-schema-card` rather than the fragment and
   * metric cards: a mapping's `note { }` block is the context a reader needs
   * *before* reading its arrows, and it is the entity-level documentation for
   * the thing the whole view is about.
   */
  @state()
  private _notesExpanded = true;

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener("field-hover", this._onFieldHover);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("field-hover", this._onFieldHover);
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

  /**
   * Absolute paths for `_hoveredArrow`, resolved by re-running the same walk
   * every other resolution surface uses and matching on object identity.
   *
   * `_hoveredArrow` is set straight from `ArrowEntry.sourceFields`/`targetField`
   * on mouseenter, which are authored paths — `.adults` under a `flatten`
   * heading, not `transects.sightings.adults`. Resolving against a schema's
   * declared fields needs the absolute form, the same requirement that sent
   * `_isArrowHighlighted` through `qualifyChildArrowPath` two functions below.
   * Re-walking here (rather than caching a scope alongside `_hoveredArrow`)
   * keeps this getter as the only place besides `_isArrowHighlighted` that
   * knows arrows need qualifying before resolution (sl-rj78).
   */
  private _resolveHoveredArrow(m: MappingBlock): MappingArrowVisit | null {
    let found: MappingArrowVisit | null = null;
    forEachMappingArrow(m, (entry) => {
      if (entry.arrow === this._hoveredArrow) found = entry;
    });
    return found;
  }

  /** Compute which source fields should be highlighted. */
  private get _sourceHighlightFields(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    const m = this.mapping;
    if (!m) return result;
    const sourceSchemaById = new Map(
      this.sourceSchemas.map((schema) => [schema.qualifiedId, schema] as const),
    );

    if (this._hoveredArrow) {
      const hovered = this._resolveHoveredArrow(m);
      const sourceFields = hovered?.sourceFields ?? this._hoveredArrow.sourceFields;
      // A computed arrow's NL transform names its sources by @ref rather than
      // by ArrowEntry.sourceFields — the pipe chain produces the value, so
      // extraction leaves sourceFields empty (viz-model.ts's extractComputedArrow).
      // Parsing the same text highlightAtRefs highlights for display finds the
      // fields those @refs actually name (sl-d7fz).
      const atRefs = extractAtRefs(this._hoveredArrow.transform?.text ?? "").map((r) => r.ref);
      for (const sr of m.sourceRefs) {
        const fields = new Set<string>();
        const schema = sourceSchemaById.get(sr);
        if (!schema) continue;
        for (const fieldRef of [...sourceFields, ...atRefs]) {
          const localPath = resolveSchemaLocalFieldPath(fieldRef, schema, m.sourceRefs);
          if (localPath) fields.add(localPath);
        }
        if (fields.size > 0) result.set(sr, fields);
      }
    } else if (this._hoveredCardField && this._hoveredCardSchema) {
      if (this._hoveredCardSchema === m.targetRef) {
        return this._findSourceFieldsForTarget(this._hoveredCardField, m);
      } else if (m.sourceRefs.includes(this._hoveredCardSchema)) {
        result.set(this._hoveredCardSchema, new Set([this._hoveredCardField]));
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
      const hovered = this._resolveHoveredArrow(m);
      const targetField = hovered?.targetField ?? this._hoveredArrow.targetField;
      const localPath = resolveSchemaLocalFieldPath(targetField, targetSchema, [m.targetRef]);
      return localPath ? new Set([localPath]) : new Set();
    }

    if (this._hoveredCardField && this._hoveredCardSchema) {
      if (m.sourceRefs.includes(this._hoveredCardSchema)) {
        return this._findTargetFieldsForSource(this._hoveredCardField, this._hoveredCardSchema, m);
      } else if (this._hoveredCardSchema === m.targetRef) {
        return new Set([this._hoveredCardField]);
      }
    }

    return new Set();
  }

  /** Find source fields that map to a given target field, grouped by schema id. */
  private _findSourceFieldsForTarget(
    targetField: string,
    m: MappingBlock,
  ): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    // forEachMappingArrow recurses into every nested each/flatten combination —
    // hand-rolled loops over the top-level collections missed nested-each arrows
    // (sl-fm0q), and nestedEach-only recursion missed flatten-inside-each
    // (sl-vu22).
    forEachMappingArrow(m, ({ sourceFields, targetField: arrowTarget }) => {
      const targetSchema = this.targetSchema;
      const localTargetPath = targetSchema
        ? resolveSchemaLocalFieldPath(arrowTarget, targetSchema, [m.targetRef])
        : null;
      if (localTargetPath === targetField) {
        for (const sourceSchema of this.sourceSchemas) {
          for (const sf of sourceFields) {
            const localSourcePath = resolveSchemaLocalFieldPath(sf, sourceSchema, m.sourceRefs);
            if (!localSourcePath) continue;
            let paths = result.get(sourceSchema.qualifiedId);
            if (!paths) {
              paths = new Set();
              result.set(sourceSchema.qualifiedId, paths);
            }
            paths.add(localSourcePath);
          }
        }
      }
    });
    return result;
  }

  /** Find target fields that a given source field maps to. */
  private _findTargetFieldsForSource(
    sourceField: string,
    sourceSchemaId: string,
    m: MappingBlock,
  ): Set<string> {
    const result = new Set<string>();
    const sourceSchema = this.sourceSchemas.find((schema) => schema.qualifiedId === sourceSchemaId);
    const targetSchema = this.targetSchema;
    if (!sourceSchema || !targetSchema) return result;
    // forEachMappingArrow recurses into every nested each/flatten combination —
    // hand-rolled loops over the top-level collections missed nested-each arrows
    // (sl-fm0q), and nestedEach-only recursion missed flatten-inside-each
    // (sl-vu22).
    forEachMappingArrow(m, ({ sourceFields, targetField }) => {
      const sourceMatches = sourceFields.some((sf) => {
        const localSourcePath = resolveSchemaLocalFieldPath(sf, sourceSchema, m.sourceRefs);
        return localSourcePath === sourceField;
      });
      if (sourceMatches) {
        const localTargetPath = resolveSchemaLocalFieldPath(targetField, targetSchema, [
          m.targetRef,
        ]);
        if (localTargetPath) result.add(localTargetPath);
      }
    });
    return result;
  }

  /** Check if an arrow row should be highlighted. */
  private _isArrowHighlighted(a: ArrowEntry, scope: ContainerScope): boolean {
    if (this._hoveredArrow === a) return true;
    if (!this._hoveredCardField || !this._hoveredCardSchema || !this.mapping) return false;

    const m = this.mapping;
    // Card fields are declared paths, so the arrow's authored path has to be
    // qualified against its container before the two can be compared — without
    // it, hovering `parcels.line1` never lit the `.line1 -> .line1` row that
    // populates it (3cdd-yavi).
    if (m.sourceRefs.includes(this._hoveredCardSchema)) {
      const sourceSchema = this.sourceSchemas.find(
        (schema) => schema.qualifiedId === this._hoveredCardSchema,
      );
      return (
        !!sourceSchema &&
        a.sourceFields.some((sf) => {
          const qualified = qualifyChildArrowPath(sf, scope.source);
          const localSourcePath = resolveSchemaLocalFieldPath(
            qualified,
            sourceSchema,
            m.sourceRefs,
          );
          return localSourcePath === this._hoveredCardField;
        })
      );
    } else if (this._hoveredCardSchema === m.targetRef) {
      const targetSchema = this.targetSchema;
      if (!targetSchema) return false;
      const localTargetPath = resolveSchemaLocalFieldPath(
        qualifyChildArrowPath(a.targetField, scope.target),
        targetSchema,
        [m.targetRef],
      );
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
          ${this.sourceSchemas.map(
            (s) => html`
              <sz-schema-card
                .schema=${s}
                .coverage=${this.sourceCoverage.get(s.qualifiedId) ?? null}
                .highlightFields=${sourceHL.get(s.qualifiedId) ?? new Set()}
                highlightColor="source"
                test-id-prefix=${`${sourcePrefix}-${sanitizeTestIdSegment(s.qualifiedId)}`}
                content-width
              ></sz-schema-card>
            `,
          )}
        </div>

        <div class="column" data-testid=${`${this.testIdPrefix}-mapping-column`}>
          <div class="column-header">Mapping</div>
          ${this._renderMappingHeader(m)} ${this._renderMappingNotes(m)}
          ${this._renderArrowTable(m)}
        </div>

        <div class="column" data-testid=${`${this.testIdPrefix}-target-column`}>
          <div class="column-header">Target</div>
          ${
            this.targetSchema
              ? html`<sz-schema-card
                  .schema=${this.targetSchema}
                  .coverage=${this.targetCoverage}
                  .highlightFields=${targetHL}
                  highlightColor="target"
                  test-id-prefix=${`${targetPrefix}-${sanitizeTestIdSegment(this.targetSchema.qualifiedId)}`}
                  content-width
                ></sz-schema-card>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private _renderMappingHeader(m: MappingBlock) {
    const sb = m.sourceBlock;

    return html`
      <div class="mapping-header" data-testid=${`${this.testIdPrefix}-header`}>
        ${
          this.namespaceLabel
            ? html`<div style="padding: 8px 12px 0; background: var(--sz-orange);">
                <span
                  class="meta-tag"
                  data-testid=${`${this.testIdPrefix}-namespace-label`}
                  style="display:inline-block;font-size:10px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--sz-namespace-pill-chip-bg);color:var(--sz-orange-dark);"
                  >${this.namespaceLabel}</span
                >
              </div>`
            : nothing
        }
        <div class="mapping-title" @click=${() => this._navigate(m.location)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 4h5l2 2h5v8H2V4z" opacity="0.9" />
          </svg>
          ${m.id}
        </div>
        <div class="mapping-meta">
          ${m.sourceRefs.map(
            (s) => html`
              <div class="mapping-meta-row">
                <span class="meta-tag"><span class="label">source</span> ${s}</span>
              </div>
            `,
          )}
          <div class="mapping-meta-row">
            <span class="meta-tag"><span class="label">target</span> ${m.targetRef}</span>
          </div>
          ${
            sb?.joinDescription
              ? html`
                  <div class="mapping-meta-row">
                    <span class="meta-tag wrap"
                      ><span class="label">join</span>
                      ${unsafeHTML(highlightAtRefs(sb.joinDescription))}</span
                    >
                  </div>
                `
              : nothing
          }
          ${(sb?.filters ?? []).map(
            (f) => html`
              <div class="mapping-meta-row">
                <span class="meta-tag wrap"
                  ><span class="label">filter</span> ${unsafeHTML(highlightAtRefs(f))}</span
                >
              </div>
            `,
          )}
          ${
            // `note` is withheld here and rendered by _renderMappingNotes
            // instead — the same dedupe the schema card applies to its own
            // note metadata, and the reason a `( note """...""" )` no longer
            // shows as a raw multi-line blob inside a pill (vnm-bak4).
            (m.metadata ?? [])
              .filter((entry) => entry.key !== NOTE_METADATA_KEY)
              .map(
                (entry) => html`
                  <div
                    class="mapping-meta-row"
                    data-testid=${`${this.testIdPrefix}-meta-${sanitizeTestIdSegment(entry.key)}`}
                  >
                    <span class="meta-tag wrap"
                      ><span class="label">${entry.key}</span> ${entry.value}</span
                    >
                  </div>
                `,
              )
          }
        </div>
      </div>
    `;
  }

  /**
   * The mapping's own notes, rendered between the header and the arrow table.
   *
   * Two sources reach the reader here (vnm-bak4):
   *   - `note { }` blocks in the mapping body or on the mapping itself, which
   *     the backend collects into `MappingBlock.notes`
   *   - a `note "..."` entry in the mapping's `( )` metadata block, which
   *     {@link _renderMappingHeader} deliberately withholds from its pill row
   *     so the two render in one place instead of two
   *
   * Renders nothing at all when the mapping carries no notes — an empty
   * toggle would take vertical space from the arrow table for no information.
   */
  private _renderMappingNotes(m: MappingBlock) {
    // Tolerate models serialized before MappingBlock carried notes (older LSP
    // servers, cached webview payloads) — render no notes, don't take the
    // whole detail view down with a spread over undefined. Same defence
    // `sz-schema-card` applies to a field's metadata.
    const notes = [...(m.notes ?? []), ...metadataNotesAsBlocks(m)];
    if (notes.length === 0) return nothing;

    return html`
      <div class="mapping-notes">
        ${renderNotesSection({
          notes,
          expanded: this._notesExpanded,
          onToggle: (e: Event) => this._toggleNotes(e),
          testIdPrefix: this.testIdPrefix,
        })}
      </div>
    `;
  }

  private _toggleNotes(e: Event) {
    e.stopPropagation();
    this._notesExpanded = !this._notesExpanded;
  }

  /**
   * True when the mapping declares no field-level arrows in any form.
   *
   * Report and model consumers legitimately declare `source {schemas}` and
   * `target {schema}` and nothing else, so this is a valid mapping shape rather
   * than a missing-data case — see {@link _renderArrowTable}.
   */
  private _hasNoArrows(m: MappingBlock): boolean {
    return (
      m.arrows.length === 0 &&
      m.eachBlocks.length === 0 &&
      m.flattenBlocks.length === 0 &&
      m.nestedArrows.length === 0
    );
  }

  private _renderArrowTable(m: MappingBlock) {
    // A mapping with no arrows used to render the four column headers over an
    // empty <tbody>, which reads as a half-loaded panel (sl-jetk). Headers head
    // rows; with no rows, say what the mapping declares instead.
    if (this._hasNoArrows(m)) {
      return html`
        <div class="mapping-header" style="padding: 0;">
          <div class="arrow-table-empty" data-testid=${`${this.testIdPrefix}-arrow-table-empty`}>
            This mapping declares no field-level arrows — it maps whole schemas only.
          </div>
        </div>
      `;
    }

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
            ${m.arrows.map((a) => this._renderArrowRow(a, "", MAPPING_BODY_SCOPE))}
            ${m.eachBlocks.map((eb) => this._renderEachSection(eb, "", MAPPING_BODY_SCOPE))}
            ${m.flattenBlocks.map((fb) => this._renderFlattenSection(fb, "", MAPPING_BODY_SCOPE))}
            ${m.nestedArrows.map((na) =>
              this._renderNestedArrowSection(na, "", MAPPING_BODY_SCOPE),
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  // sectionPrefix disambiguates arrow rows that share a target field across
  // nested each/flatten sections (sl-eikr). Empty string for top-level rows.
  //
  // `scope` is the container the row sits in. The row *renders* the paths as
  // authored — `.line1` under its `each` heading is what the author wrote — but
  // deciding whether it lights up when a card field is hovered is a resolution
  // question, and resolution needs the absolute path (3cdd-yavi).
  private _renderArrowRow(
    a: ArrowEntry,
    sectionPrefix: string,
    scope: ContainerScope,
  ): TemplateResult {
    const hl = this._isArrowHighlighted(a, scope) ? "hl" : "";
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
        @mouseenter=${() => {
          this._hoveredArrow = a;
          this._hoveredCardField = null;
        }}
        @mouseleave=${() => {
          this._hoveredArrow = null;
        }}
      >
        <td>
          <div class="source-ref-list">
            ${
              a.sourceFields.length === 0
                ? // A target-only arrow (`-> is_closed { "..." }`) has no source
                  // field by design. An empty cell was indistinguishable from a
                  // source path the viz had failed to resolve (sl-k7i4), so name
                  // the construct instead.
                  html`<span
                    class="source-derived"
                    data-testid=${`${rowTestId}-source-derived`}
                    title="No source field: this target is derived from the transform"
                    >derived</span
                  >`
                : a.sourceFields.map(
                    (sourceField) => html`
                      <span class="field-ref source-ref-item">${sourceField}</span>
                    `,
                  )
            }
          </div>
        </td>
        <td><span class="arrow-icon">&#x2192;</span></td>
        <td class="transform-cell">${this._renderTransform(a)}</td>
        <td><span class="field-ref">${a.targetField}</span></td>
      </tr>
      ${
        noteEntry
          ? html`<tr class="arrow-note-row" data-testid=${`${rowTestId}-note`}>
              <td colspan="4">
                <div class="arrow-note">${unsafeHTML(renderMarkdown(noteEntry.value))}</div>
              </td>
            </tr>`
          : ""
      }
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

  private _renderEachSection(
    eb: EachBlock,
    parentPrefix: string,
    parentScope: ContainerScope,
  ): TemplateResult {
    const sectionId = sanitizeTestIdSegment(`each-${eb.targetField}`);
    const sectionPrefix = parentPrefix ? `${parentPrefix}-${sectionId}` : sectionId;
    const scope = scopeWithin(parentScope, eb);
    return html`
      <tr class="scope-section" data-testid=${`${this.testIdPrefix}-${sectionPrefix}`}>
        <td colspan="4">
          <div class="scope-label">
            <span class="scope-tag">each</span>
            <span class="scope-fields">${eb.sourceField} &#x2192; ${eb.targetField}</span>
          </div>
        </td>
      </tr>
      ${eb.arrows.map((a) => this._renderArrowRow(a, sectionPrefix, scope))}
      ${eb.nestedEach.map((ne) => this._renderEachSection(ne, sectionPrefix, scope))}
      ${eb.nestedFlatten.map((nf) => this._renderFlattenSection(nf, sectionPrefix, scope))}
      ${eb.nestedArrows.map((na) => this._renderNestedArrowSection(na, sectionPrefix, scope))}
    `;
  }

  private _renderFlattenSection(
    fb: FlattenBlock,
    parentPrefix: string,
    parentScope: ContainerScope,
  ): TemplateResult {
    const sectionId = sanitizeTestIdSegment(`flatten-${fb.sourceField}`);
    const sectionPrefix = parentPrefix ? `${parentPrefix}-${sectionId}` : sectionId;
    const scope = scopeWithin(parentScope, fb);
    return html`
      <tr class="scope-section" data-testid=${`${this.testIdPrefix}-${sectionPrefix}`}>
        <td colspan="4">
          <div class="scope-label">
            <span class="scope-tag">flatten</span>
            <span class="scope-fields">
              ${fb.sourceField}${fb.targetField ? html` &#x2192; ${fb.targetField}` : nothing}
            </span>
          </div>
        </td>
      </tr>
      ${fb.arrows.map((a) => this._renderArrowRow(a, sectionPrefix, scope))}
      ${fb.nestedEach.map((ne) => this._renderEachSection(ne, sectionPrefix, scope))}
      ${fb.nestedFlatten.map((nf) => this._renderFlattenSection(nf, sectionPrefix, scope))}
      ${fb.nestedArrows.map((na) => this._renderNestedArrowSection(na, sectionPrefix, scope))}
    `;
  }

  // A nested_arrow (`addr -> address { .line1 -> .line1 }`) groups a record's
  // arrows the way each/flatten group a list's, so it renders as the same kind
  // of scope section. Before svdfe-s6we these blocks were absent from the model
  // and their arrows simply missing from this table.
  private _renderNestedArrowSection(
    na: NestedArrowBlock,
    parentPrefix: string,
    parentScope: ContainerScope,
  ): TemplateResult {
    const sectionId = sanitizeTestIdSegment(`nested-${na.targetField}`);
    const sectionPrefix = parentPrefix ? `${parentPrefix}-${sectionId}` : sectionId;
    const scope = scopeWithin(parentScope, na);
    return html`
      <tr class="scope-section" data-testid=${`${this.testIdPrefix}-${sectionPrefix}`}>
        <td colspan="4">
          <div class="scope-label">
            <span class="scope-tag">nested</span>
            <span class="scope-fields">${na.sourceField} &#x2192; ${na.targetField}</span>
          </div>
        </td>
      </tr>
      ${na.arrows.map((a) => this._renderArrowRow(a, sectionPrefix, scope))}
      ${na.nestedEach.map((ne) => this._renderEachSection(ne, sectionPrefix, scope))}
      ${na.nestedFlatten.map((nf) => this._renderFlattenSection(nf, sectionPrefix, scope))}
      ${na.nestedArrows.map((nn) => this._renderNestedArrowSection(nn, sectionPrefix, scope))}
    `;
  }

  private _navigate(loc: import("../model.js").SourceLocation) {
    this.dispatchEvent(new SzNavigateEvent(loc));
  }
}

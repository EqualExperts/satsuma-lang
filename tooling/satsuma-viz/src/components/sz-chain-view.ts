/**
 * sz-chain-view.ts — the "biography of one field": a left-to-right rail.
 *
 * Renders a {@link FieldChainModel} (PRD 36 R3) as ordered upstream hops,
 * then the focus field anchored in the centre, then ordered downstream hops.
 * This component only renders; it never traces lineage itself — the model is
 * always supplied by a host (`satsuma-viz`'s `openFieldChain`, ultimately fed
 * by `@satsuma/viz-backend` in the browser or the LSP in VS Code), matching
 * the same host-supplied-model contract already used for the coverage
 * overlay (PRD 36 R1). It owns none of the app-level view-mode switching or
 * back navigation — those live in `satsuma-viz.ts`, alongside the equivalent
 * machinery for the mapping detail view.
 */
import { LitElement, html, css, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// Narrow submodule imports, not the package root: the root barrel re-exports
// parser/extraction code that needs Node's tree-sitter bindings, which
// esbuild cannot bundle into this browser component (mirrors
// sz-mapping-detail.ts's @satsuma/core/extract import).
import { fieldEndpointPath, fieldEndpointSchema } from "@satsuma/core/reference-stages";
import type { CanonicalFieldEndpoint } from "@satsuma/core/reference-stages";
import type { Classification } from "@satsuma/core/types";
import type { FieldChainHop, FieldChainModel } from "../model.js";
import { SzFieldLineageEvent, sanitizeTestIdSegment } from "../satsuma-viz.js";

/**
 * A namespace group within one depth column is collapsed to a summary chip
 * once it holds more than this many hops (PRD 36 R4: "collapse by namespace
 * with expand-on-click", user decision on PRD open question 2). Chosen as the
 * largest fan that still reads comfortably as a single column of cards
 * without scrolling past the viewport on a typical review screen.
 */
const NAMESPACE_GROUP_COLLAPSE_THRESHOLD = 3;

/** One direction's hops bucketed into left-to-right columns by hop distance. */
interface ChainColumn {
  depth: number;
  hops: FieldChainHop[];
}

/**
 * One rendered rail position — an upstream/downstream column or the centred
 * focus card — carrying a stable `id` so the connector between two adjacent
 * positions can be given a testid derived from both sides.
 */
interface RailSegment {
  id: string;
  content: TemplateResult;
}

/** One namespace's hops within a single column, before collapse is decided. */
interface NamespaceGroup {
  namespace: string | null;
  hops: FieldChainHop[];
}

/** A hop's field decomposed for display and for re-dispatching a trace request. */
interface EndpointParts {
  namespace: string | null;
  schemaName: string;
  fieldPath: string;
}

/** Split a canonical field endpoint into namespace, schema name, and field path. */
function splitEndpoint(endpoint: CanonicalFieldEndpoint): EndpointParts {
  const schemaRef = fieldEndpointSchema(endpoint);
  const separator = schemaRef.indexOf("::");
  return {
    namespace: separator === 0 ? null : schemaRef.slice(0, separator),
    schemaName: schemaRef.slice(separator + 2),
    fieldPath: fieldEndpointPath(endpoint) ?? "",
  };
}

/** The `qualifiedId` spelling (no leading `::`) that SchemaCard and events use. */
function qualifiedIdOf(parts: EndpointParts): string {
  return parts.namespace ? `${parts.namespace}::${parts.schemaName}` : parts.schemaName;
}

/** Drop a global mapping's leading `::` for a compact display label. */
function shortMappingName(viaMapping: string): string {
  return viaMapping.startsWith("::") ? viaMapping.slice(2) : viaMapping;
}

/** Bucket hops by hop distance, ascending, so each depth becomes one rail column. */
function toColumns(hops: readonly FieldChainHop[]): ChainColumn[] {
  const byDepth = new Map<number, FieldChainHop[]>();
  for (const hop of hops) {
    const bucket = byDepth.get(hop.depth);
    if (bucket) bucket.push(hop);
    else byDepth.set(hop.depth, [hop]);
  }
  return [...byDepth.entries()]
    .sort(([a], [b]) => a - b)
    .map(([depth, columnHops]) => ({ depth, hops: columnHops }));
}

/** Group one column's hops by the namespace of the field they reach. */
function toNamespaceGroups(hops: readonly FieldChainHop[]): NamespaceGroup[] {
  const byNamespace = new Map<string, NamespaceGroup>();
  for (const hop of hops) {
    const { namespace } = splitEndpoint(hop.field);
    const key = namespace ?? "";
    const group = byNamespace.get(key);
    if (group) group.hops.push(hop);
    else byNamespace.set(key, { namespace, hops: [hop] });
  }
  return [...byNamespace.values()];
}

/** Mapping label click — asks the host to resolve and open that mapping's detail view. */
export class SzChainOpenMappingEvent extends Event {
  readonly viaMapping: string;
  constructor(viaMapping: string) {
    super("chain-open-mapping", { bubbles: true, composed: true });
    this.viaMapping = viaMapping;
  }
}

@customElement("sz-chain-view")
export class SzChainView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: var(--sz-font-sans);
    }

    .chain-rail {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 8px;
      width: max-content;
      min-width: 100%;
    }

    /* Decorative flow arrow between two rail segments (bug scvc-8n4r): a
     * short line with a triangular head, reusing the namespace-fan chip's
     * border colour so it stays visible against both card backgrounds
     * without introducing a new token. */
    .chain-connector {
      flex-shrink: 0;
      align-self: center;
      width: 28px;
      height: 2px;
      background: var(--sz-card-border-strong);
    }

    .chain-connector::after {
      content: "";
      display: block;
      margin-left: 26px;
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 6px solid var(--sz-card-border-strong);
      transform: translateY(-3px);
    }

    .chain-column {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chain-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .chain-group-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--sz-text-muted);
    }

    .chain-group-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      border: 1px dashed var(--sz-card-border-strong);
      border-radius: var(--sz-card-radius);
      background: var(--sz-namespace-bg);
      color: var(--sz-text-muted);
      font-family: inherit;
      font-size: 12px;
      padding: 8px 12px;
      cursor: pointer;
    }

    .chain-group-chip:hover {
      background: var(--sz-row-hover-bg);
      color: var(--sz-text);
    }

    .hop-card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      min-width: 160px;
      padding: 8px 10px;
      border: 1px solid var(--sz-card-border);
      border-radius: var(--sz-card-radius);
      background: var(--sz-card-bg);
      box-shadow: var(--sz-card-shadow);
    }

    .focus-card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      min-width: 180px;
      padding: 12px 14px;
      border: 2px solid var(--sz-orange);
      border-radius: var(--sz-card-radius);
      background: var(--sz-accent-wash);
      flex-shrink: 0;
    }

    .hop-via {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
    }

    .hop-mapping {
      border: none;
      background: transparent;
      color: var(--sz-text-muted);
      font-family: inherit;
      font-size: 11px;
      padding: 0;
      cursor: pointer;
      text-decoration: underline dotted;
    }

    .hop-mapping:hover {
      color: var(--sz-orange-dark);
    }

    .classification-badge {
      border-radius: var(--sz-badge-radius);
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
    }

    /* Declared, transformed arrow (classification "nl") — same green as the
     * dashed NL edge stroke used elsewhere in the overview/detail views. */
    .classification-badge.nl {
      background: var(--sz-green-wash);
      color: var(--sz-green);
    }

    /* Implicit hop inferred from an @ref in prose, not a declared arrow — the
     * one classification with no rendering precedent elsewhere in this
     * package (sl-4czz design note). Reuses the "question" palette: an
     * inferred connection carries the same "read the prose to be sure"
     * caveat as an open question on a field. */
    .classification-badge.nl-derived {
      background: var(--sz-question-bg);
      color: var(--sz-question-icon);
    }

    .hop-field {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      border: none;
      background: transparent;
      font-family: inherit;
      padding: 0;
      cursor: pointer;
      text-align: left;
    }

    .hop-field:hover .hop-schema,
    .hop-field:hover .hop-path {
      color: var(--sz-orange-dark);
    }

    .focus-card .hop-schema,
    .focus-card .hop-path {
      cursor: default;
    }

    .hop-namespace {
      font-size: 10px;
      color: var(--sz-text-muted);
    }

    .hop-schema {
      font-size: 13px;
      font-weight: 600;
      color: var(--sz-text);
    }

    .hop-path {
      font-family: var(--sz-font-mono);
      font-size: 12px;
      color: var(--sz-text-muted);
    }

    /* Depth-limit affordance (sl-4czz): reuses the "warning" palette because,
     * like a warning badge, it flags that the picture may be incomplete —
     * this hop sits exactly on the traversal's depth cap and may have
     * further, untraced neighbours (no-silent-truncation rule). */
    .depth-limit-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border-radius: var(--sz-badge-radius);
      background: var(--sz-warning-bg);
      color: var(--sz-warning-icon);
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
    }

    .chain-empty {
      padding: 24px;
      color: var(--sz-text-muted);
      font-size: 13px;
    }

    /* Unknown-field state (sv-embb): reuses the "warning" palette, like the
     * depth-limit badge, because it flags a chain the reader should not read
     * as "no lineage" — the focus field itself could not be resolved. */
    .chain-unknown {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 24px;
      color: var(--sz-warning-icon);
      font-size: 13px;
    }
  `;

  /** The traversal to render, supplied by the host. Null renders nothing but an empty state. */
  @property({ type: Object })
  chain: FieldChainModel | null = null;

  /**
   * Namespace groups the user has expanded past their default collapse
   * (`${direction}:${depth}:${namespace}` keys). Intentionally never pruned
   * against `chain` changes: re-collapsing a group the user just opened, the
   * moment a host refreshes the chain after an edit, would be surprising.
   */
  @state()
  private _expandedGroups = new Set<string>();

  override render() {
    if (!this.chain) {
      return html`<div class="chain-empty" data-testid="chain-empty">No field selected</div>`;
    }

    if (this.chain.resolved === false) {
      // Composed as one string before binding: a lit template attribute or
      // text node mixing literal text with more than one `${}` slot
      // serializes as separate string/value runs under the tests'
      // template-flattening helper (see `_renderColumn`'s testId for the same
      // rule).
      const parts = splitEndpoint(this.chain.field);
      const message = `Field not found: ${qualifiedIdOf(parts)}.${parts.fieldPath}`;
      return html`
        <div class="chain-unknown" data-testid="chain-unknown-field">&#9888; ${message}</div>
      `;
    }

    // Upstream renders furthest-first so hop distance increases moving away
    // from the focus card, matching the downstream rail's natural order.
    const upstreamColumns = toColumns(this.chain.upstream).reverse();
    const downstreamColumns = toColumns(this.chain.downstream);

    // Every segment sits left-to-right in the direction data actually flows:
    // an upstream column feeds the column (or focus card) to its right, and
    // the focus card feeds the first downstream column, and so on. A
    // connector between each adjacent pair therefore always points right —
    // see `_renderConnector`.
    const segments: RailSegment[] = [
      ...upstreamColumns.map((column) => ({
        id: `upstream-${column.depth}`,
        content: this._renderColumn(column, "upstream"),
      })),
      { id: "focus", content: this._renderFocus(this.chain.field) },
      ...downstreamColumns.map((column) => ({
        id: `downstream-${column.depth}`,
        content: this._renderColumn(column, "downstream"),
      })),
    ];

    return html`
      <div class="chain-rail" data-testid="chain-view">
        ${segments.map((segment, index) => {
          const previous = segments[index - 1];
          return previous
            ? html`${this._renderConnector(previous.id, segment.id)}${segment.content}`
            : segment.content;
        })}
      </div>
    `;
  }

  /**
   * A flow arrow between two adjacent rail segments (PRD 36's "connected by
   * edges" design note). Purely visual: the actual edge data — which mapping,
   * and its classification — already renders inside the hop card on the
   * near side of the arrow (`_renderHop`'s `.hop-via`); this only makes the
   * left-to-right chain legible as a chain rather than a row of unrelated
   * cards.
   */
  private _renderConnector(fromId: string, toId: string): TemplateResult {
    const testId = `chain-connector-${fromId}-to-${toId}`;
    return html`<span class="chain-connector" data-testid=${testId} aria-hidden="true"></span>`;
  }

  private _renderFocus(field: CanonicalFieldEndpoint): TemplateResult {
    const parts = splitEndpoint(field);
    return html`
      <div class="focus-card" data-testid="chain-focus">
        ${parts.namespace ? html`<span class="hop-namespace">${parts.namespace}</span>` : ""}
        <span class="hop-schema">${parts.schemaName}</span>
        <span class="hop-path">${parts.fieldPath}</span>
      </div>
    `;
  }

  private _renderColumn(column: ChainColumn, direction: "upstream" | "downstream") {
    const groups = toNamespaceGroups(column.hops);
    // Composed as one JS string, then bound as a single interpolation: an
    // attribute mixing literal text with more than one `${}` slot serializes
    // as separate string/value runs under the tests' template-flattening
    // helper (and every sibling component already follows this rule).
    const testId = `chain-column-${direction}-${column.depth}`;
    return html`
      <div class="chain-column" data-testid=${testId}>
        ${groups.map((group) => this._renderGroup(group, direction, column.depth))}
      </div>
    `;
  }

  private _renderGroup(group: NamespaceGroup, direction: "upstream" | "downstream", depth: number) {
    const key = `${direction}:${depth}:${group.namespace ?? ""}`;
    const collapsed =
      group.hops.length > NAMESPACE_GROUP_COLLAPSE_THRESHOLD && !this._expandedGroups.has(key);

    if (collapsed) {
      const testId = `chain-group-${key}`;
      return html`
        <button
          class="chain-group-chip"
          data-testid=${testId}
          @click=${() => this._expandGroup(key)}
        >
          ${group.namespace ?? "global"} (${group.hops.length} fields) &#9656;
        </button>
      `;
    }

    return html`
      <div class="chain-group">
        ${group.namespace ? html`<span class="chain-group-label">${group.namespace}</span>` : ""}
        ${group.hops.map((hop) => this._renderHop(hop, direction))}
      </div>
    `;
  }

  private _renderHop(hop: FieldChainHop, direction: "upstream" | "downstream") {
    const parts = splitEndpoint(hop.field);
    const qualifiedId = qualifiedIdOf(parts);
    const atDepthLimit = this.chain !== null && hop.depth === this.chain.maxDepth;
    // A column can hold more than one hop below the namespace-fan collapse
    // threshold (e.g. two sibling fields on the same source schema at the
    // same depth) — direction+depth alone collides for those, so the field
    // itself breaks the tie. Regex-based unit tests only ever assert a
    // testid's presence as a substring and cannot see a real DOM collision;
    // only Playwright driving an actual click proves each hop is individually
    // addressable (the same class of gap noted in AGENTS.md's viz-testing rule).
    const hopId = sanitizeTestIdSegment(`${qualifiedId}.${parts.fieldPath}`);
    const cardTestId = `chain-hop-${direction}-${hop.depth}-${hopId}`;
    const mappingTestId = `chain-hop-mapping-${direction}-${hop.depth}-${hopId}`;
    const fieldTestId = `chain-hop-field-${direction}-${hop.depth}-${hopId}`;
    const depthLimitTestId = `chain-depth-limit-${direction}-${hop.depth}-${hopId}`;
    const mappingTitle = `Open mapping ${hop.via_mapping}`;
    const fieldTitle = `Trace ${qualifiedId}.${parts.fieldPath}`;

    return html`
      <div class="hop-card" data-testid=${cardTestId} data-classification=${hop.classification}>
        <div class="hop-via">
          <button
            class="hop-mapping"
            data-testid=${mappingTestId}
            title=${mappingTitle}
            @click=${() => this._openMapping(hop.via_mapping)}
          >
            ${shortMappingName(hop.via_mapping)}
          </button>
          ${this._renderClassificationBadge(hop.classification)}
        </div>
        <button
          class="hop-field"
          data-testid=${fieldTestId}
          title=${fieldTitle}
          @click=${() => this._focusField(qualifiedId, parts.fieldPath)}
        >
          ${parts.namespace ? html`<span class="hop-namespace">${parts.namespace}</span>` : ""}
          <span class="hop-schema">${parts.schemaName}</span>
          <span class="hop-path">${parts.fieldPath}</span>
        </button>
        ${
          atDepthLimit
            ? html`<span
                class="depth-limit-badge"
                data-testid=${depthLimitTestId}
                title="Depth limit reached — this hop may have further, untraced neighbours"
                >&#8942; depth limit</span
              >`
            : ""
        }
      </div>
    `;
  }

  private _renderClassificationBadge(classification: Classification) {
    if (classification === "none") return "";
    if (classification === "nl") {
      return html`<span class="classification-badge nl" title="Declared arrow with a transform"
        >NL</span
      >`;
    }
    return html`<span
      class="classification-badge nl-derived"
      title="Inferred from an @ref in natural-language text — not a declared arrow"
      >NL-derived</span
    >`;
  }

  private _expandGroup(key: string) {
    this._expandedGroups = new Set(this._expandedGroups).add(key);
  }

  private _focusField(schemaId: string, fieldName: string) {
    this.dispatchEvent(new SzFieldLineageEvent(schemaId, fieldName));
  }

  private _openMapping(viaMapping: string) {
    this.dispatchEvent(new SzChainOpenMappingEvent(viaMapping));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sz-chain-view": SzChainView;
  }
}

import { LitElement, html, svg, css, unsafeCSS } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { VizModel, SourceLocation, NamespaceGroup, MappingBlock, SchemaCard } from "./model.js";
import { computeLayout, computeOverviewLayout, type LayoutResult, type OverviewLayoutResult, type SourceBlockLayout } from "./layout/elk-layout.js";
import { SzOpenMappingEvent } from "./edges/sz-overview-edge-layer.js";
import tokens from "./tokens.css";
import { renderMarkdown } from "./markdown.js";
import { buildMappedFieldsIndex, buildMappingCoveredFields } from "./field-coverage.js";
import { metricAsSchemaCard } from "./metric-adapter.js";

export { VizModel } from "./model.js";
export type { NamespaceGroup } from "./model.js";

import type { SzCompactToggledDetail } from "./components/sz-schema-card.js";

// Re-export components so they register when the bundle loads
export { SzSchemaCard } from "./components/sz-schema-card.js";
export type { SzCompactToggledDetail } from "./components/sz-schema-card.js";
export { SzMetricCard } from "./components/sz-metric-card.js";
export { SzFragmentCard } from "./components/sz-fragment-card.js";
export { SzEdgeLayer } from "./edges/sz-edge-layer.js";
export { SzOverviewEdgeLayer, SzOpenMappingEvent } from "./edges/sz-overview-edge-layer.js";
export { SzMappingDetail } from "./components/sz-mapping-detail.js";
export { computeLayout, computeOverviewLayout } from "./layout/elk-layout.js";
export {
  HEADER_HEIGHT,
  META_PILL_ROW_GAP,
  META_PILL_ROW_HEIGHT,
  METADATA_PILLS_CHROME,
  NAMESPACE_PILL_HEIGHT,
} from "./layout/geometry.js";
export { buildMappingCoveredFields, buildMappedFieldsIndex, resolveSchemaLocalFieldPath, schemaHasFieldPath } from "./field-coverage.js";
export { metricAsSchemaCard, metricFieldEntries } from "./metric-adapter.js";
export type { LayoutResult, LayoutNode, LayoutEdge, SourceBlockLayout, OverviewLayoutResult, OverviewEdge } from "./layout/elk-layout.js";

/**
 * Replace every `var(--*)` reference in an exported SVG with the literal
 * value the active theme resolves it to. The component's stylesheets are not
 * shipped with the exported file, so unresolved custom properties would
 * render as browser defaults (black strokes, invisible fills) outside the
 * component (sl-7pdf). References that resolve to nothing are left intact
 * rather than silently emptied.
 */
export function inlineCssVariables(
  svg: string,
  resolve: (name: string) => string,
): string {
  return svg.replace(/var\((--[\w-]+)\)/g, (whole, name: string) => {
    const value = resolve(name).trim();
    return value === "" ? whole : value;
  });
}

/**
 * Escape a user-controlled string for interpolation into SVG/XML markup.
 * Satsuma backtick names legally contain `& < > " '` (grammar backtick_name),
 * so anything authored — schema ids, field names — must pass through here
 * before landing in an exported document, or the file won't parse as XML
 * (sl-6m5k).
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Extra canvas margin (px) added around the layout bounds in an exported SVG. */
const EXPORT_SVG_PADDING = 48;

/**
 * Build the standalone SVG document for an overview export: the live edge
 * layer's paths plus one simplified card (body, header band, name) per
 * layout node. Authored names are XML-escaped (sl-6m5k); colours are still
 * `var(--sz-*)` references — the caller inlines them against the active
 * theme before saving (sl-7pdf). `edgeSvgContent` is markup already
 * serialized from the component's own SVG layer, not authored text, so it
 * is embedded verbatim.
 */
export function buildExportSvg(layout: LayoutResult, edgeSvgContent: string): string {
  const w = layout.width + EXPORT_SVG_PADDING;
  const h = layout.height + EXPORT_SVG_PADDING;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>
    .edge-path { fill: none; stroke-width: 1.5; }
    .edge-path.nl { stroke: var(--sz-arrow-nl-stroke); stroke-dasharray: 6 3; }
    .edge-path.bare { stroke: var(--sz-edge-bare-stroke); stroke-width: 1; }
    .scope-label { font-family: monospace; font-size: 9px; font-weight: 600; fill: var(--sz-edge-bare-stroke); text-anchor: middle; }
    .gear-circle { fill: var(--sz-gear-bg); stroke: var(--sz-edge-bare-stroke); stroke-width: 1; }
    .gear-icon { fill: var(--sz-edge-bare-stroke); font-size: 10px; text-anchor: middle; dominant-baseline: central; }
    rect.card { fill: var(--sz-card-bg); stroke: var(--sz-card-border); rx: 8; }
    rect.header { rx: 8; }
    text.card-name { font-family: system-ui; font-size: 14px; font-weight: 600; fill: var(--sz-text-on-accent); }
    text.field-name { font-family: monospace; font-size: 12px; fill: var(--sz-text); }
    text.field-type { font-family: monospace; font-size: 11px; fill: var(--sz-text-muted); }
  </style>
  <rect width="${w}" height="${h}" fill="var(--sz-bg)"/>
  ${edgeSvgContent}
  ${[...layout.nodes.values()].map((n) => `
  <g transform="translate(${n.x},${n.y})">
    <rect class="card" width="${n.width}" height="${n.height}" fill="var(--sz-card-bg)" stroke="var(--sz-card-border)" rx="8"/>
    <rect class="header" width="${n.width}" height="40" fill="var(--sz-orange)" rx="8"/>
    <rect x="0" y="32" width="${n.width}" height="8" fill="var(--sz-orange)"/>
    <text class="card-name" x="12" y="26">${escapeXml(n.id)}</text>
  </g>`).join("")}
</svg>`;
}

/** Navigate event — dispatched when the user clicks a source-linked element. */
export class SzNavigateEvent extends Event {
  readonly location: SourceLocation;
  constructor(location: SourceLocation) {
    super("navigate", { bubbles: true, composed: true });
    this.location = location;
  }
}

/** Field hover event — dispatched when a field row is hovered to highlight connected arrows. */
export class SzFieldHoverEvent extends Event {
  readonly schemaId: string;
  readonly fieldName: string | null;
  constructor(schemaId: string, fieldName: string | null) {
    super("field-hover", { bubbles: true, composed: true });
    this.schemaId = schemaId;
    this.fieldName = fieldName;
  }
}

/** Expand lineage event — dispatched when the user clicks an expand button on a schema card. */
export class SzExpandLineageEvent extends Event {
  readonly schemaId: string;
  constructor(schemaId: string) {
    super("expand-lineage", { bubbles: true, composed: true });
    this.schemaId = schemaId;
  }
}

/** Field lineage event — dispatched when the user clicks the lineage icon on a field row. */
export class SzFieldLineageEvent extends Event {
  readonly schemaId: string;
  readonly fieldName: string;
  constructor(schemaId: string, fieldName: string) {
    super("field-lineage", { bubbles: true, composed: true });
    this.schemaId = schemaId;
    this.fieldName = fieldName;
  }
}

export type VizAutomationReadyState = "empty" | "loading" | "ready" | "fallback";
export type VizAutomationRenderMode = "empty" | "overview" | "detail" | "fallback";

export interface VizAutomationState {
  /** Stable renderer readiness state for browser automation. */
  readyState: VizAutomationReadyState;
  /** Which major UI surface is currently rendered. */
  renderMode: VizAutomationRenderMode;
  /** Current user-facing view mode. */
  viewMode: "overview" | "detail";
}

export function sanitizeTestIdSegment(value: string): string {
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

export function describeVizAutomationState(args: {
  hasModel: boolean;
  hasOverviewLayout: boolean;
  hasDetailLayout: boolean;
  layoutError: boolean;
  viewMode: "overview" | "detail";
}): VizAutomationState {
  if (!args.hasModel) {
    return { readyState: "empty", renderMode: "empty", viewMode: args.viewMode };
  }
  if (args.layoutError) {
    return { readyState: "fallback", renderMode: "fallback", viewMode: args.viewMode };
  }
  if (!args.hasOverviewLayout && !args.hasDetailLayout) {
    return { readyState: "loading", renderMode: "empty", viewMode: args.viewMode };
  }
  return {
    readyState: "ready",
    renderMode: args.viewMode === "detail" ? "detail" : "overview",
    viewMode: args.viewMode,
  };
}

@customElement("satsuma-viz")
export class SatsumaViz extends LitElement {
  static override styles = css`
    ${unsafeCSS(tokens)}

    :host {
      display: flex;
      flex-direction: column;
      background: var(--sz-bg);
      color: var(--sz-text);
      font-family: var(--sz-font-sans);
      height: 100%;
      min-height: 100%;
      overflow: hidden;
    }

    .canvas {
      position: relative;
      min-width: 100%;
      min-height: 100%;
    }

    .card-layer {
      position: relative;
      z-index: 10;
    }

    .positioned-card {
      position: absolute;
    }

    .positioned-card.mapping-node {
      cursor: pointer;
      z-index: 25;
    }

    .overview-mapping-card {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      /* Fill the wrapper, which is pinned to the ELK node height — edge
         anchors are computed from that height, so the rendered card must
         occupy exactly the same box (sl-wixe). Content centres vertically. */
      height: 100%;
      padding: 0 40px 0 12px;
      border-radius: var(--sz-card-radius);
      background: var(--sz-overview-mapping-bg), var(--sz-overview-mapping-gloss);
      border: 1px solid var(--sz-overview-mapping-border);
      color: var(--sz-text-on-accent);
      box-shadow: var(--sz-overview-mapping-shadow);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }

    .overview-mapping-card:hover {
      filter: brightness(1.03);
    }

    .overview-mapping-icon {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      opacity: 0.92;
    }

    .overview-mapping-name {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* View transition fade */
    .view-content {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* Flexbox fallback when no layout computed yet */
    .flex-canvas {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sz-card-gap);
      padding: 24px;
      align-items: flex-start;
    }

    .namespace-group {
      display: flex;
      flex-wrap: wrap;
      gap: var(--sz-card-gap);
      padding: 16px;
      border: 2px dashed var(--sz-namespace-border);
      background: var(--sz-namespace-bg);
      border-radius: var(--sz-card-radius);
      position: relative;
    }

    .namespace-group > .namespace-label {
      position: absolute;
      top: -10px;
      left: 12px;
    }

    .empty {
      color: var(--sz-text-muted);
      font-size: 14px;
      padding: 48px;
      text-align: center;
    }

    .loading {
      color: var(--sz-text-muted);
      font-size: 14px;
      padding: 48px;
      text-align: center;
    }

    .file-notes {
      margin: 16px 24px 0;
      border-radius: var(--sz-card-radius);
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      box-shadow: var(--sz-card-shadow);
      overflow: hidden;
    }

    .file-notes-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
      font-weight: 600;
      color: var(--sz-text);
    }

    .file-notes-toggle:hover {
      background: var(--sz-row-hover-bg);
    }

    .file-notes-toggle .arrow {
      font-size: 10px;
      transition: transform 0.15s ease;
    }

    .file-notes-toggle .arrow[data-expanded] {
      transform: rotate(90deg);
    }

    .file-note-item {
      padding: 8px 12px 8px 34px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--sz-text);
      white-space: pre-wrap;
      word-break: break-word;
      border-top: 1px solid var(--sz-card-border);
    }

    /* Toolbar */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 6px 12px;
      background: var(--sz-card-bg);
      border-bottom: 1px solid var(--sz-card-border);
      font-family: var(--sz-font-sans);
      font-size: 12px;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .toolbar-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--sz-text);
      margin-right: 12px;
      padding: 4px 0;
    }

    .toolbar-sep {
      width: 1px;
      height: 20px;
      background: var(--sz-card-border);
      margin: 0 6px;
    }

    .toolbar-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: var(--sz-text-muted);
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      user-select: none;
      white-space: nowrap;
    }

    .toolbar-btn:hover {
      background: var(--sz-row-active-bg);
      color: var(--sz-text);
    }

    .toolbar-btn[data-active] {
      background: var(--sz-badge-bg);
      color: var(--sz-orange-dark);
      border-color: var(--sz-orange-dark);
    }

    .toolbar-spacer {
      flex: 1;
    }

    .toolbar-select {
      padding: 4px 8px;
      border: 1px solid var(--sz-card-border);
      border-radius: 4px;
      background: var(--sz-card-bg);
      color: var(--sz-text);
      font-size: 12px;
      font-family: inherit;
      cursor: pointer;
    }

    /* Hide edges when schema-only mode */
    .schema-only sz-edge-layer {
      display: none;
    }

    /* Hide notes when notes hidden */
    .hide-notes .file-notes,
    .hide-notes .notes-section {
      display: none;
    }

    /* Zoom/pan viewport.
     * Do NOT add height: 100% here — it interacts badly with flex: 1 when the
     * parent's height comes purely from flex layout (no explicit height), causing
     * the viewport to size to its content rather than the available space.  The
     * default align-self: stretch achieves the same cross-axis fill reliably. */
    .viewport {
      overflow: hidden;
      flex: 1;
      min-height: 0;
      position: relative;
      isolation: isolate;
    }

    .detail-scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 16px;
      /* Ensure scroll works within flex layout */
      height: 0;
    }

    .detail-inner {
      width: max-content;
      min-width: 100%;
    }

    .viewport-inner {
      transform-origin: 0 0;
      will-change: transform;
    }

    .zoom-indicator {
      position: fixed;
      bottom: 12px;
      right: 12px;
      font-size: 11px;
      color: var(--sz-text-muted);
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      padding: 2px 8px;
      border-radius: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s;
      z-index: 90;
    }

    .zoom-indicator.visible {
      opacity: 1;
    }

    /* Breadcrumb trail for expanded lineage */
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      background: var(--sz-namespace-bg);
      border-bottom: 1px solid var(--sz-card-border);
      font-size: 11px;
      color: var(--sz-text-muted);
      overflow-x: auto;
    }

    .breadcrumb-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
    }

    .breadcrumb-item:hover {
      border-color: var(--sz-orange-dark);
      color: var(--sz-orange-dark);
    }

    .breadcrumb-item.primary {
      font-weight: 600;
      color: var(--sz-text);
    }

    .breadcrumb-sep {
      color: var(--sz-text-muted);
      font-size: 10px;
    }

    .breadcrumb-collapse {
      margin-left: auto;
      padding: 2px 8px;
      border: 1px solid var(--sz-card-border);
      border-radius: 4px;
      background: transparent;
      color: var(--sz-text-muted);
      cursor: pointer;
      font-size: 11px;
      font-family: inherit;
    }

    .breadcrumb-collapse:hover {
      background: var(--sz-row-active-bg);
      color: var(--sz-text);
    }

    /* Slide-in animation for expanded cards */
    @keyframes slideInLeft {
      from { opacity: 0; transform: translateX(-40px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @keyframes slideInRight {
      from { opacity: 0; transform: translateX(40px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .positioned-card.expanded {
      animation: slideInRight 0.3s ease-out;
    }

    /* Right-side notes pane */
    .notes-pane-wrapper {
      display: flex;
      flex: 1;
      overflow: hidden;
      min-height: 0;
      position: relative;
    }

    .notes-pane-wrapper > .viewport {
      flex: 1;
    }

    .notes-pane {
      width: 280px;
      flex-shrink: 0;
      border-left: 1px solid var(--sz-card-border);
      background: var(--sz-bg);
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .notes-pane-header {
      font-size: 12px;
      font-weight: 600;
      color: var(--sz-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--sz-card-border);
    }

    .notes-pane-section {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--sz-text-muted);
      margin-top: 6px;
    }

    .comment-card {
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.5;
      cursor: pointer;
    }

    .comment-card:hover {
      filter: brightness(0.97);
    }

    .comment-card.warning {
      background: var(--sz-warning-bg);
      border: 1px solid var(--sz-warning-border-soft);
      color: var(--sz-warning-icon);
    }

    .comment-card.question {
      background: var(--sz-question-bg);
      border: 1px solid var(--sz-question-border-soft);
      color: var(--sz-question-icon);
    }

    .comment-card-source {
      font-size: 10px;
      opacity: 0.7;
      margin-top: 2px;
    }

    .note-card {
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.5;
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      color: var(--sz-text);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Block-level comment floating badges */
    .block-comment-badge {
      position: absolute;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      z-index: 50;
      white-space: nowrap;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .block-comment-badge.warning {
      background: var(--sz-warning-bg);
      color: var(--sz-warning-icon);
      border: 1px solid var(--sz-warning-border-strong);
    }

    .block-comment-badge.question {
      background: var(--sz-question-bg);
      color: var(--sz-question-icon);
      border: 1px solid var(--sz-question-border-strong);
    }

    .block-comment-badge:hover {
      filter: brightness(0.95);
      max-width: none;
    }

    /* Source block join/filter labels */
    .source-block-label {
      position: absolute;
      background: var(--sz-badge-bg);
      border: 1px dashed var(--sz-orange-dark);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 10px;
      font-family: var(--sz-font-mono);
      color: var(--sz-orange-dark);
      white-space: nowrap;
      z-index: 40;
    }

    /* Minimap */
    .minimap {
      position: absolute;
      bottom: 12px;
      right: 12px;
      width: 160px;
      height: 100px;
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      border-radius: 4px;
      box-shadow: var(--sz-card-shadow);
      overflow: hidden;
      cursor: pointer;
      z-index: 80;
    }

    .minimap-viewport {
      position: absolute;
      border: 1.5px solid var(--sz-orange);
      background: var(--sz-accent-wash);
      border-radius: 1px;
      pointer-events: none;
    }

    .source-block-filter {
      position: absolute;
      background: var(--sz-question-bg);
      border: 1px solid var(--sz-question-border-soft);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10px;
      font-family: var(--sz-font-mono);
      color: var(--sz-question-icon);
      white-space: nowrap;
      z-index: 40;
    }

    :host([test-mode]),
    :host([reduce-motion]) {
      --sz-motion-enabled: 0;
    }

    :host([test-mode]) *,
    :host([reduce-motion]) * {
      animation: none !important;
      transition: none !important;
      scroll-behavior: auto !important;
    }

    @media (prefers-reduced-motion: reduce) {
      :host * {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    }
  `;

  @property({ type: Object })
  model: VizModel | null = null;

  /**
   * Visual theme. Reflected to the `theme` attribute so the
   * `:host([theme="dark"])` overrides in tokens.css apply — this is the *only*
   * switching mechanism for the palette. Consumers (VS Code webview, harness)
   * detect which theme to use and assign it; the component owns rendering.
   * Default `"light"`, matching the warm cream/orange `:host` token defaults.
   */
  @property({ reflect: true })
  theme: "light" | "dark" = "light";

  @property({ type: Boolean, attribute: "test-mode", reflect: true })
  testMode = false;

  @property({ type: Boolean, attribute: "reduce-motion", reflect: true })
  reduceMotion = false;

  @state()
  private _viewMode: "overview" | "detail" = "overview";

  @state()
  private _layout: LayoutResult | null = null;

  @state()
  private _overviewLayout: OverviewLayoutResult | null = null;

  /**
   * Compact overview cards the user has expanded to show fields, by schema
   * qualifiedId. Drives BOTH each card's `compactExpanded` property and the
   * overview layout's per-node size (computeOverviewLayout expandedSchemaIds),
   * which is what makes expansion re-flow neighbours instead of overlapping
   * them. Survives model rebuilds deliberately: a live-editor keystroke
   * replaces the model, and the user's expanded cards should stay expanded;
   * ids that no longer exist are simply ignored by the layout.
   */
  @state()
  private _compactExpandedIds: ReadonlySet<string> = new Set();

  @state()
  private _selectedMapping: MappingBlock | null = null;

  /**
   * Stable identity of the selected mapping across model rebuilds. Live
   * editing replaces `model` — and every MappingBlock object in it — on each
   * debounced edit, so the detail-view selection must survive by name rather
   * than object identity (sl-2ksz). Format: `<namespace ?? "_">::<mapping id>`,
   * mirroring _overviewMappingNodeId's namespace handling.
   */
  private _selectedMappingKey: string | null = null;

  @state()
  private _layoutError = false;

  @state()
  private _fileNotesExpanded = false;

  @state()
  private _schemaOnly = false;

  @state()
  private _showNotes = true;

  @state()
  private _nsFilter: string | null = null;

  /** File-scope filter: null = show all files (full lineage), URI string = show only that file. */
  @state()
  private _fileFilter: string | null = null;

  @state()
  private _zoom = 1;

  @state()
  private _panX = 0;

  @state()
  private _panY = 0;

  @state()
  private _zoomIndicatorVisible = false;

  private _zoomIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

  /** Currently hovered field for arrow highlighting. */
  @state()
  private _hoveredSchema: string | null = null;

  @state()
  private _hoveredField: string | null = null;

  /** Currently hovered overview node for edge highlighting. */
  @state()
  private _hoveredOverviewNodes: Set<string> = new Set();

  /** Expanded cross-file models keyed by the schema that triggered expansion. */
  @state()
  private _expandedModels = new Map<string, VizModel[]>();

  @state()
  private _mappedFieldsBySchema = new Map<string, Set<string>>();

  @state()
  private _renderedNamespaceBoxes: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];

  private static readonly MIN_ZOOM = 0.2;
  private static readonly MAX_ZOOM = 3;

  private _isPanning = false;
  private _panStartX = 0;
  private _panStartY = 0;
  private _panStartPanX = 0;
  private _panStartPanY = 0;
  /*
   * Container-resize handling (feature 33, sl-1qte).
   *
   * The elk layout is content-driven — node positions do not depend on the
   * viewport size — so a host resize never needs a re-layout.  What a resize
   * DOES invalidate is everything rendered from a live viewport measurement:
   * the minimap's viewport rectangle and the Fit math both read
   * `.viewport` clientWidth/Height.  A plain re-render refreshes those.
   *
   * A host ResizeObserver (not a window listener) is used so the component
   * reacts when its *container* changes size with the window unchanged —
   * e.g. the playground collapsing its editor pane to hand this component the
   * reclaimed width.  Falls back to a window listener in environments without
   * ResizeObserver (the Node test shim).
   */
  private readonly _handleHostResize = () => {
    this.requestUpdate();
  };
  private _resizeObserver: ResizeObserver | null = null;
  private _lastReadySignature: string | null = null;

  override connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute("data-testid")) {
      this.setAttribute("data-testid", "viz-root");
    }
    if (typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(this._handleHostResize);
      this._resizeObserver.observe(this);
    } else {
      window.addEventListener("resize", this._handleHostResize);
    }
    this.addEventListener("field-hover", ((e: SzFieldHoverEvent) => {
      this._hoveredSchema = e.schemaId;
      this._hoveredField = e.fieldName;
    }) as EventListener);
    this.addEventListener("open-mapping", ((e: SzOpenMappingEvent) => {
      this._selectedMapping = e.mapping;
      this._selectedMappingKey = this._mappingKey(e.mapping);
      this._viewMode = "detail";
      this._resetPanZoom();
    }) as EventListener);
  }

  override disconnectedCallback() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    } else {
      window.removeEventListener("resize", this._handleHostResize);
    }
    super.disconnectedCallback();
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has("model") && this.model) {
      this._reconcileViewState(this.model);
      this._runLayout();
    }

    if (
      changed.has("_layout")
      || changed.has("_overviewLayout")
      || changed.has("_viewMode")
      || changed.has("model")
      || changed.has("_nsFilter")
      || changed.has("_fileFilter")
      || changed.has("_showNotes")
    ) {
      requestAnimationFrame(() => this._measureNamespaceBoxes());
    }

    if (
      changed.has("model")
      || changed.has("_layout")
      || changed.has("_overviewLayout")
      || changed.has("_layoutError")
      || changed.has("_viewMode")
    ) {
      this._publishAutomationState();
    }
  }

  /**
   * Carry user view state across a model replacement.
   *
   * Live editing reassigns `model` on every debounced keystroke, so blindly
   * resetting to the overview here would kick the user out of the mapping
   * detail view on every edit (sl-2ksz). Instead:
   *
   * - keep the detail view open when a mapping with the same namespace + id
   *   still exists, re-binding the selection to the new model's object
   *   (pan/zoom is untouched, so the user's viewport survives too);
   * - keep per-schema expansion state for ids that still resolve, dropping
   *   entries for schemas that were renamed or deleted;
   * - fall back to the overview only when the selected mapping is gone.
   */
  private _reconcileViewState(model: VizModel) {
    // Expansion state is keyed by schema/metric/fragment id; prune ids that
    // no longer exist so a rename doesn't pin a stale subgraph or card state.
    const liveIds = new Set<string>();
    for (const ns of model.namespaces) {
      for (const s of ns.schemas) liveIds.add(s.qualifiedId);
      for (const m of ns.metrics) liveIds.add(m.qualifiedId);
      for (const f of ns.fragments) liveIds.add(f.id);
    }
    if (this._expandedModels.size > 0) {
      this._expandedModels = new Map(
        [...this._expandedModels].filter(([schemaId]) => liveIds.has(schemaId)),
      );
    }
    if (this._compactExpandedIds.size > 0) {
      this._compactExpandedIds = new Set(
        [...this._compactExpandedIds].filter((id) => liveIds.has(id)),
      );
    }

    if (this._viewMode === "detail" && this._selectedMappingKey) {
      for (const ns of model.namespaces) {
        for (const m of ns.mappings) {
          if (`${ns.name ?? "_"}::${m.id}` === this._selectedMappingKey) {
            this._selectedMapping = m;
            return;
          }
        }
      }
    }

    // No surviving selection (first load, or the mapping was renamed/deleted).
    this._viewMode = "overview";
    this._selectedMapping = null;
    this._selectedMappingKey = null;
  }

  /** Stable cross-rebuild key for a mapping; see _selectedMappingKey. */
  private _mappingKey(mapping: MappingBlock): string {
    return `${this._namespaceForMapping(mapping) ?? "_"}::${mapping.id}`;
  }

  /** Add expanded cross-file models triggered by a schema card. */
  addExpandedModels(schemaId: string, models: VizModel[]) {
    const next = new Map(this._expandedModels);
    if (next.has(schemaId)) {
      next.delete(schemaId); // toggle off
    } else {
      next.set(schemaId, models);
    }
    this._expandedModels = next;
    this._runLayout();
  }

  /** Get the list of expanded file URIs for breadcrumb display. */
  get expandedFiles(): string[] {
    const uris: string[] = [];
    for (const models of this._expandedModels.values()) {
      for (const m of models) {
        if (!uris.includes(m.uri)) uris.push(m.uri);
      }
    }
    return uris;
  }

  private async _runLayout() {
    if (!this.model) return;

    this._layout = null;
    this._overviewLayout = null;
    this._layoutError = false;
    this._renderedNamespaceBoxes = [];

    // Build a merged model that includes expanded cross-file schemas
    const mergedModel = this._buildMergedModel();

    // Build mapped fields index for card rendering
    this._mappedFieldsBySchema = this._buildMappedFieldsIndex();

    try {
      const [detail, overview] = await Promise.all([
        computeLayout(mergedModel),
        computeOverviewLayout(mergedModel, { expandedSchemaIds: this._compactExpandedIds }),
      ]);
      this._layout = detail;
      this._overviewLayout = overview;
    } catch {
      this._layoutError = true;
    }
  }

  /** Merge the primary model with any expanded cross-file models. */
  private _buildMergedModel(): VizModel {
    if (!this.model || this._expandedModels.size === 0) return this.model!;

    // Collect all namespaces from expanded models, avoiding duplicates
    const seenIds = new Set<string>();
    const primaryNs = this.model.namespaces;
    for (const ns of primaryNs) {
      for (const s of ns.schemas) seenIds.add(s.qualifiedId);
      for (const f of ns.fragments) seenIds.add(f.id);
      for (const m of ns.metrics) seenIds.add(m.qualifiedId);
    }

    const extraNamespaces: NamespaceGroup[] = [];
    for (const models of this._expandedModels.values()) {
      for (const m of models) {
        for (const ns of m.namespaces) {
          const newSchemas = ns.schemas.filter((s) => !seenIds.has(s.qualifiedId));
          const newFragments = ns.fragments.filter((f) => !seenIds.has(f.id));
          const newMetrics = ns.metrics.filter((mt) => !seenIds.has(mt.qualifiedId));

          for (const s of newSchemas) seenIds.add(s.qualifiedId);
          for (const f of newFragments) seenIds.add(f.id);
          for (const mt of newMetrics) seenIds.add(mt.qualifiedId);

          if (newSchemas.length > 0 || newFragments.length > 0 || newMetrics.length > 0) {
            extraNamespaces.push({
              name: ns.name,
              schemas: newSchemas,
              mappings: ns.mappings,
              metrics: newMetrics,
              fragments: newFragments,
            });
          }
        }
      }
    }

    return {
      uri: this.model.uri,
      fileNotes: this.model.fileNotes,
      namespaces: [...primaryNs, ...extraNamespaces],
    };
  }

  override render() {
    const automationState = describeVizAutomationState({
      hasModel: Boolean(this.model),
      hasOverviewLayout: Boolean(this._overviewLayout),
      hasDetailLayout: Boolean(this._layout),
      layoutError: this._layoutError,
      viewMode: this._viewMode,
    });

    if (!this.model) {
      return html`<div class="empty" data-testid="viz-empty" data-ready-state=${automationState.readyState}>No mapping file loaded</div>`;
    }

    const { namespaces } = this.model;
    if (namespaces.length === 0) {
      return html`<div class="empty" data-testid="viz-empty" data-ready-state=${automationState.readyState}>No schemas found in this file</div>`;
    }

    const filtered = this._filterNamespaces(namespaces);
    const toggleClasses = `${this._schemaOnly ? "schema-only" : ""} ${!this._showNotes ? "hide-notes" : ""}`;

    // If layout hasn't computed yet, show loading
    if (!this._layout && !this._overviewLayout && !this._layoutError) {
      return html`
        ${this._renderToolbar(namespaces)}
        <div class="loading" data-testid="viz-loading" data-ready-state=${automationState.readyState}>Computing layout...</div>
      `;
    }

    // If layout failed, fall back to simple flex layout
    if (this._layoutError || (!this._layout && !this._overviewLayout)) {
      return html`
        ${this._renderToolbar(namespaces)}
        <div class=${toggleClasses}>
          ${this._renderFileNotes()}
          ${this._renderFlexFallback(filtered)}
        </div>
      `;
    }

    // Detail view: show mapping detail with source/target schema cards
    if (this._viewMode === "detail" && this._selectedMapping && this._layout) {
      return html`
        ${this._renderToolbar(namespaces)}
        <div class="${toggleClasses} view-content">
          ${this._renderFileNotes()}
          <div class="notes-pane-wrapper">
            <div class="viewport"
              data-testid="viz-viewport"
              @wheel=${this._onWheel}
              @mousedown=${this._onMouseDown}
              @mousemove=${this._onMouseMove}
              @mouseup=${this._onMouseUp}
              @mouseleave=${this._onMouseUp}
            >
              <div class="viewport-inner"
                style="transform: translate(${this._panX}px, ${this._panY}px) scale(${this._zoom});"
              >
                <div class="detail-inner" style="padding: 16px;">
                  ${this._renderMappingDetailView(this._selectedMapping)}
                </div>
              </div>
              <div class="zoom-indicator ${this._zoomIndicatorVisible ? "visible" : ""}">
                ${Math.round(this._zoom * 100)}%
              </div>
              ${this._renderMinimap(this._layout)}
            </div>
          </div>
        </div>
      `;
    }

    // Overview mode: compact schema cards with thick mapping arrows
    if (this._overviewLayout) {
      return html`
        ${this._renderToolbar(namespaces)}
        ${this._renderBreadcrumbs()}
        <div class="${toggleClasses} view-content">
          ${this._renderFileNotes()}
          <div class="notes-pane-wrapper">
            <div class="viewport"
              data-testid="viz-viewport"
              @wheel=${this._onWheel}
              @mousedown=${this._onMouseDown}
              @mousemove=${this._onMouseMove}
              @mouseup=${this._onMouseUp}
              @mouseleave=${this._onMouseUp}
            >
              <div class="viewport-inner"
                style="transform: translate(${this._panX}px, ${this._panY}px) scale(${this._zoom});"
              >
                ${this._renderOverview(this._overviewLayout, filtered)}
              </div>
              <div class="zoom-indicator ${this._zoomIndicatorVisible ? "visible" : ""}">
                ${Math.round(this._zoom * 100)}%
              </div>
              ${this._renderMinimap(this._overviewLayoutAsDetail())}
            </div>
          </div>
        </div>
      `;
    }

    // Fallback to detail layout if overview isn't available
    const allComments = this._collectAllComments();
    const hasComments = allComments.warnings.length > 0 || allComments.questions.length > 0;
    const hasFileNotes = this.model.fileNotes.length > 0;
    const showPane = this._showNotes && (hasComments || hasFileNotes);

    return html`
      ${this._renderToolbar(namespaces)}
      ${this._renderBreadcrumbs()}
      <div class=${toggleClasses}>
        ${this._renderFileNotes()}
        <div class="notes-pane-wrapper">
          <div class="viewport"
            data-testid="viz-viewport"
            @wheel=${this._onWheel}
            @mousedown=${this._onMouseDown}
            @mousemove=${this._onMouseMove}
            @mouseup=${this._onMouseUp}
            @mouseleave=${this._onMouseUp}
          >
            <div class="viewport-inner"
              style="transform: translate(${this._panX}px, ${this._panY}px) scale(${this._zoom});"
            >
              ${this._renderPositioned(this._layout!, filtered)}
            </div>
            <div class="zoom-indicator ${this._zoomIndicatorVisible ? "visible" : ""}">
              ${Math.round(this._zoom * 100)}%
            </div>
            ${this._renderMinimap(this._layout!)}
          </div>
          ${showPane ? this._renderNotesPane(allComments) : ""}
        </div>
      </div>
    `;
  }

  private _renderToolbar(allNamespaces: NamespaceGroup[]) {
    const namedNs = allNamespaces.filter((ns) => ns.name);
    const hasNamespaces = namedNs.length > 0;
    const inDetail = this._viewMode === "detail";

    return html`
      <div class="toolbar">
        ${inDetail
          ? html`
              <button class="toolbar-btn" @click=${this._backToOverview}
                title="Back to overview">&#9664; Overview</button>
              <div class="toolbar-sep"></div>
              <span class="toolbar-title">${this._selectedMapping?.id ?? "Mapping Detail"}</span>
            `
          : html`<span class="toolbar-title">&#9673; Mapping Viz</span>`}
        <div class="toolbar-sep"></div>
        <button
          class="toolbar-btn"
          data-testid="toolbar-toggle-file-notes"
          ?data-active=${this._showNotes}
          @click=${() => { this._showNotes = !this._showNotes; }}
          title="Show or hide file notes"
        >Show File Notes</button>
        <div class="toolbar-sep"></div>
        ${!inDetail
          ? html`<button class="toolbar-btn" data-testid="toolbar-fit" @click=${this._fit} title="Fit all content in viewport">Fit</button>`
          : ""}
        <button class="toolbar-btn" data-testid="toolbar-refresh" @click=${this._refresh} title="Re-fetch visualization data">&#8635; Refresh</button>
        ${!inDetail
          ? html`<button class="toolbar-btn" data-testid="toolbar-export" @click=${this._exportSvg} title="Export the overview as an SVG file">&#x21E9; Export SVG</button>`
          : ""}
        ${hasNamespaces && !inDetail
          ? html`
              <div class="toolbar-sep"></div>
              <select
                class="toolbar-select"
                data-testid="toolbar-namespace-filter"
                @change=${this._onNsFilterChange}
                title="Filter by namespace"
              >
                <option value="" ?selected=${this._nsFilter === null}>All namespaces</option>
                ${namedNs.map(
                  (ns) => html`<option value=${ns.name!} ?selected=${this._nsFilter === ns.name}>${ns.name}</option>`
                )}
              </select>
            `
          : ""}
        ${this._getSourceFiles().length > 1 && !inDetail
          ? html`
              <div class="toolbar-sep"></div>
              <select
                class="toolbar-select"
                data-testid="toolbar-file-filter"
                @change=${this._onFileFilterChange}
                title="Filter by source file"
              >
                <option value="" ?selected=${this._fileFilter === null}>All files</option>
                ${this._getSourceFiles().map(
                  (uri) => {
                    const name = uri.split("/").pop() ?? uri;
                    const isCurrent = uri === this.model?.uri;
                    const label = isCurrent ? `${name} (current)` : name;
                    return html`<option value=${uri} ?selected=${this._fileFilter === uri}>${label}</option>`;
                  }
                )}
              </select>
            `
          : ""}
        <div class="toolbar-spacer"></div>
      </div>
    `;
  }

  private _backToOverview() {
    this._viewMode = "overview";
    this._selectedMapping = null;
    this._selectedMappingKey = null;
    this._resetPanZoom();
  }

  private _resetPanZoom() {
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
  }

  /**
   * A compact card requested an expand/collapse of its field list. The card's
   * size changes, so the overview layout is recomputed with the new node
   * geometry — neighbours move aside and edges re-route rather than the
   * expanded card painting over them, and the canvas height follows the
   * layout symmetrically (it shrinks back on collapse).
   */
  private _onCompactToggled(e: Event) {
    const detail = (e as CustomEvent<SzCompactToggledDetail>).detail;
    if (!detail?.schemaId) return;
    const next = new Set(this._compactExpandedIds);
    if (detail.expanded) {
      next.add(detail.schemaId);
    } else {
      next.delete(detail.schemaId);
    }
    this._compactExpandedIds = next;
    void this._runLayout();
  }

  private _fit() {
    const viewport = this.renderRoot?.querySelector?.(".viewport") as HTMLElement | null;
    const canvas = this.renderRoot?.querySelector?.(".canvas") as HTMLElement | null;
    if (!viewport || !canvas) {
      this._resetPanZoom();
      return;
    }

    const bounds = this._measureContentBounds(canvas);
    if (!bounds) {
      this._resetPanZoom();
      return;
    }

    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      this._resetPanZoom();
      return;
    }

    const zoom = Math.min(
      SatsumaViz.MAX_ZOOM,
      Math.max(
        SatsumaViz.MIN_ZOOM,
        Math.min(viewportWidth / bounds.width, viewportHeight / bounds.height),
      ),
    );

    this._zoom = zoom;
    this._panX = (viewportWidth - bounds.width * zoom) / 2 - bounds.minX * zoom;
    this._panY = (viewportHeight - bounds.height * zoom) / 2 - bounds.minY * zoom;
    this._showZoomIndicator();
  }

  private _refresh() {
    this.dispatchEvent(new Event("refresh", { bubbles: true, composed: true }));
  }

  private _exportSvg() {
    if (!this._layout) return;

    // Capture the canvas HTML and edge SVG
    const canvas = this.renderRoot?.querySelector?.(".canvas") as HTMLElement | null;
    if (!canvas) return;

    // Serialize the canvas content (cards as foreignObject, edges as SVG)
    const edgeSvg = canvas.querySelector("sz-edge-layer")?.shadowRoot?.querySelector("svg");
    const edgeSvgContent = edgeSvg ? edgeSvg.innerHTML : "";

    const svgStr = buildExportSvg(this._layout, edgeSvgContent);

    // Resolve theme tokens to literal colours so the file renders standalone
    // (custom properties are defined by the component's stylesheets, which an
    // exported .svg does not carry — sl-7pdf).
    const styles = getComputedStyle(this);
    const content = inlineCssVariables(svgStr, (name) => styles.getPropertyValue(name));

    this.dispatchEvent(
      new CustomEvent("export", {
        bubbles: true,
        composed: true,
        detail: { format: "svg", content },
      }),
    );
  }

  private _onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom
      const delta = -e.deltaY * 0.002;
      const newZoom = Math.min(
        SatsumaViz.MAX_ZOOM,
        Math.max(SatsumaViz.MIN_ZOOM, this._zoom * (1 + delta)),
      );

      // Zoom toward cursor position
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const scale = newZoom / this._zoom;
      this._panX = mx - scale * (mx - this._panX);
      this._panY = my - scale * (my - this._panY);
      this._zoom = newZoom;

      this._showZoomIndicator();
    } else {
      // Pan
      this._panX -= e.deltaX;
      this._panY -= e.deltaY;
    }
  }

  private _onMouseDown(e: MouseEvent) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle-click or Alt+click to pan
      e.preventDefault();
      this._isPanning = true;
      this._panStartX = e.clientX;
      this._panStartY = e.clientY;
      this._panStartPanX = this._panX;
      this._panStartPanY = this._panY;
      (e.currentTarget as HTMLElement).style.cursor = "grabbing";
    }
  }

  private _onMouseMove(e: MouseEvent) {
    if (!this._isPanning) return;
    this._panX = this._panStartPanX + (e.clientX - this._panStartX);
    this._panY = this._panStartPanY + (e.clientY - this._panStartY);
  }

  private _onMouseUp(e: MouseEvent | Event) {
    if (this._isPanning) {
      this._isPanning = false;
      (e.currentTarget as HTMLElement).style.cursor = "";
    }
  }

  private _showZoomIndicator() {
    this._zoomIndicatorVisible = true;
    if (this._zoomIndicatorTimer) clearTimeout(this._zoomIndicatorTimer);
    this._zoomIndicatorTimer = setTimeout(() => {
      this._zoomIndicatorVisible = false;
    }, 1000);
  }

  private _renderBreadcrumbs() {
    if (this._expandedModels.size === 0) return html``;

    const primaryUri = this.model?.uri ?? "";
    const primaryName = primaryUri.split("/").pop() ?? primaryUri;

    return html`
      <div class="breadcrumbs">
        <span class="breadcrumb-item primary" title=${primaryUri}>${primaryName}</span>
        ${[...this._expandedModels.entries()].flatMap(([schemaId, models]) =>
          models.map((m) => {
            const name = m.uri.split("/").pop() ?? m.uri;
            return html`
              <span class="breadcrumb-sep">&#9654;</span>
              <span class="breadcrumb-item" title="${m.uri} (via ${schemaId})"
                @click=${() => this.addExpandedModels(schemaId, models)}
              >${name}</span>
            `;
          })
        )}
        <button class="breadcrumb-collapse" @click=${this._collapseAll}
          title="Collapse back to single-file view">
          &#10005; Collapse all
        </button>
      </div>
    `;
  }

  /** Render the overview: compact schema cards + thick overview edges. */
  private _renderOverview(overview: OverviewLayoutResult, namespaces: NamespaceGroup[]) {
    return html`
      <div class="canvas" style="width: ${overview.width + 48}px; height: ${overview.height + 48}px; padding: 24px;"
        @sz-compact-toggled=${this._onCompactToggled}>
        <!-- Cards and edges share .card-layer so both use the same coordinate
             origin by construction — a sibling edge layer anchored to the
             canvas padding box renders 24px above the in-flow cards (sl-wixe). -->
        <div class="card-layer">
          <!-- Overview SVG edge layer (filtered to visible nodes) -->
          <sz-overview-edge-layer
            style="z-index: 30;"
            .edges=${this._filterOverviewEdges(overview.edges, namespaces)}
            .width=${overview.width}
            .height=${overview.height}
            .highlightNodes=${this._hoveredOverviewNodes}
          ></sz-overview-edge-layer>
          ${namespaces.flatMap((ns) => [
            ...ns.schemas.map((s) => {
              const node = overview.nodes.find((n) => n.id === s.qualifiedId);
              if (!node) return html``;
              return html`
                <div class="positioned-card" data-node-id=${s.qualifiedId} style="left: ${node.x}px; top: ${node.y}px; width: ${node.width}px;"
                  @mouseenter=${() => this._onOverviewNodeHover(s.qualifiedId)}
                  @mouseleave=${() => this._onOverviewNodeLeave()}>
                  <sz-schema-card
                    data-testid=${`overview-schema-card-${sanitizeTestIdSegment(s.qualifiedId)}`}
                    .testIdPrefix=${`overview-schema-card-${sanitizeTestIdSegment(s.qualifiedId)}`}
                    .schema=${s}
                    .namespaceLabel=${ns.name}
                    .compactExpanded=${this._compactExpandedIds.has(s.qualifiedId)}
                    compact
                  ></sz-schema-card>
                </div>
              `;
            }),
            ...ns.fragments.map((f) => {
              const node = overview.nodes.find((n) => n.id === f.id);
              if (!node) return html``;
              return html`
                <div class="positioned-card" data-node-id=${f.id} style="left: ${node.x}px; top: ${node.y}px; width: ${node.width}px;"
                  @mouseenter=${() => this._onOverviewNodeHover(f.id)}
                  @mouseleave=${() => this._onOverviewNodeLeave()}>
                  <sz-fragment-card .fragment=${f} .namespaceLabel=${ns.name} compact></sz-fragment-card>
                </div>
              `;
            }),
            ...ns.metrics.map((m) => {
              const node = overview.nodes.find((n) => n.id === m.qualifiedId);
              if (!node) return html``;
              return html`
                <div class="positioned-card" data-node-id=${m.qualifiedId} style="left: ${node.x}px; top: ${node.y}px; width: ${node.width}px;"
                  @mouseenter=${() => this._onOverviewNodeHover(m.qualifiedId)}
                  @mouseleave=${() => this._onOverviewNodeLeave()}>
                  <sz-metric-card
                    data-testid=${`overview-metric-card-${sanitizeTestIdSegment(m.qualifiedId)}`}
                    .metric=${m}
                    .namespaceLabel=${ns.name}
                    compact
                  ></sz-metric-card>
                </div>
              `;
            }),
            ...ns.mappings.map((m) => {
              const mappingNodeId = this._overviewMappingNodeId(ns.name, m.id);
              const node = overview.nodes.find((n) => n.id === mappingNodeId);
              if (!node) return html``;
              return html`
                <div
                  class="positioned-card mapping-node"
                  data-testid=${`overview-mapping-node-${sanitizeTestIdSegment(mappingNodeId)}`}
                  data-node-id=${mappingNodeId}
                  style="left: ${node.x}px; top: ${node.y}px; width: ${node.width}px; height: ${node.height}px;"
                  @click=${() => this._openOverviewMapping(m)}
                  @mouseenter=${() => this._onOverviewNodeHover(mappingNodeId)}
                  @mouseleave=${() => this._onOverviewNodeLeave()}
                >
                  <div class="overview-mapping-card" data-testid=${`overview-mapping-card-${sanitizeTestIdSegment(m.id)}`} title=${m.id}>
                    <div style="display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0;">
                      ${ns.name
                        ? html`<span style="display:inline-block;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:var(--sz-namespace-pill-bg);color:var(--sz-namespace-pill-text);">${ns.name}</span>`
                        : ""}
                      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                        <svg class="overview-mapping-icon" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M2 3h3v2H2v2l-2-3 2-3v2z" opacity="0.95"></path>
                          <path d="M14 11h-3V9h3V7l2 3-2 3v-2z" opacity="0.95"></path>
                          <path d="M4.5 5.5h7v1.5h-7z" opacity="0.78"></path>
                          <path d="M4.5 9h7v1.5h-7z" opacity="0.78"></path>
                        </svg>
                        <span class="overview-mapping-name">${m.id}</span>
                        <span style="opacity:0.6;font-size:11px;font-weight:400;">${m.arrows.length + m.eachBlocks.reduce((s, b) => s + b.arrows.length, 0) + m.flattenBlocks.reduce((s, b) => s + b.arrows.length, 0)} &#8594;s</span>
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }),
          ])}
        </div>
      </div>
    `;
  }

  /** Compute namespace bounding boxes from the overview layout. */
  private _computeOverviewNamespaceBoxes(
    overview: OverviewLayoutResult,
    namespaces: NamespaceGroup[]
  ): Array<{ name: string; x: number; y: number; w: number; h: number }> {
    if (this._renderedNamespaceBoxes.length > 0) {
      return this._renderedNamespaceBoxes;
    }
    const boxes: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];

    for (const ns of namespaces) {
      if (!ns.name) continue;

      const ids = [
        ...ns.schemas.map((s) => s.qualifiedId),
        ...ns.fragments.map((f) => f.id),
        ...ns.metrics.map((m) => m.qualifiedId),
        ...ns.mappings.map((m) => this._overviewMappingNodeId(ns.name, m.id)),
      ];

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let found = false;

      for (const id of ids) {
        const node = overview.nodes.find((n) => n.id === id);
        if (!node) continue;
        found = true;
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }

      if (found) {
        const padX = 0;
        const padTop = 0;
        const padBottom = 0;
        const labelPad = 10;
        boxes.push({
          name: ns.name,
          x: minX - padX,
          y: minY - padTop - labelPad,
          w: maxX - minX + padX * 2,
          h: maxY - minY + padTop + padBottom + labelPad,
        });
      }
    }

    return boxes;
  }

  /** Adapt overview layout to LayoutResult shape for minimap reuse. */
  private _overviewLayoutAsDetail(): LayoutResult {
    const ov = this._overviewLayout!;
    const nodes = new Map<string, import("./layout/elk-layout.js").LayoutNode>();
    for (const n of ov.nodes) {
      nodes.set(n.id, n);
    }
    return { nodes, edges: [], sourceBlocks: [], width: ov.width, height: ov.height };
  }

  private _overviewMappingNodeId(namespaceName: string | null, mappingId: string): string {
    return `mapping:${namespaceName ?? "_"}:${mappingId}`;
  }

  private _openOverviewMapping(mapping: MappingBlock) {
    this._selectedMapping = mapping;
    this._selectedMappingKey = this._mappingKey(mapping);
    this._viewMode = "detail";
    this._resetPanZoom();
  }

  private _onOverviewNodeHover(nodeId: string) {
    this._hoveredOverviewNodes = new Set([nodeId]);
  }

  private _onOverviewNodeLeave() {
    this._hoveredOverviewNodes = new Set();
  }

  /** Render the mapping detail view with schema cards and arrow table. */
  /** Expand ...spread references by merging fragment fields into a schema copy. */
  private _expandSpreads(schema: SchemaCard): SchemaCard {
    if (!this.model || schema.spreads.length === 0) return schema;
    const allFragments = this.model.namespaces.flatMap((ns) => ns.fragments);
    const extraFields: import("./model.js").FieldEntry[] = [];
    for (const spreadName of schema.spreads) {
      const frag = allFragments.find((f) => f.id === spreadName);
      if (frag) extraFields.push(...frag.fields);
    }
    if (extraFields.length === 0) return schema;
    return { ...schema, fields: [...schema.fields, ...extraFields] };
  }

  private _renderMappingDetailView(mapping: MappingBlock) {
    if (!this.model) return html``;

    // Mapping endpoints may be schemas OR metrics: a pipeline mapping writes
    // INTO a metric, and a report mapping reads FROM one. Resolving only
    // against schemas rendered an empty column for metric endpoints
    // (sl-cw68), so metrics are adapted to the schema-card shape here.
    const allSchemas = this.model.namespaces.flatMap((ns) => ns.schemas);
    const allMetrics = this.model.namespaces.flatMap((ns) => ns.metrics);
    const resolveEndpoint = (ref: string): SchemaCard | null => {
      const schema = allSchemas.find((s) => s.qualifiedId === ref);
      if (schema) return this._expandSpreads(schema);
      const metric = allMetrics.find((mt) => mt.qualifiedId === ref);
      return metric ? metricAsSchemaCard(metric) : null;
    };

    const sourceSchemas = mapping.sourceRefs
      .map(resolveEndpoint)
      .filter((s): s is SchemaCard => s !== null);
    const expandedTarget = resolveEndpoint(mapping.targetRef);

    const { sourceMapped, targetMapped } = buildMappingCoveredFields(
      mapping,
      sourceSchemas,
      expandedTarget,
    );

    const namespaceLabel = this._namespaceForMapping(mapping);

    return html`
      <sz-mapping-detail
        data-testid=${`mapping-detail-${sanitizeTestIdSegment(mapping.id)}`}
        .testIdPrefix=${`mapping-detail-${sanitizeTestIdSegment(mapping.id)}`}
        .mapping=${mapping}
        .sourceSchemas=${sourceSchemas}
        .targetSchema=${expandedTarget}
        .sourceMappedFields=${sourceMapped}
        .targetMappedFields=${targetMapped}
        .namespaceLabel=${namespaceLabel}
      ></sz-mapping-detail>
    `;
  }

  private _namespaceForMapping(mapping: MappingBlock): string | null {
    if (!this.model) return null;
    for (const ns of this.model.namespaces) {
      if (ns.mappings.includes(mapping)) return ns.name;
    }
    return null;
  }

  private _publishAutomationState() {
    const state = describeVizAutomationState({
      hasModel: Boolean(this.model),
      hasOverviewLayout: Boolean(this._overviewLayout),
      hasDetailLayout: Boolean(this._layout),
      layoutError: this._layoutError,
      viewMode: this._viewMode,
    });
    this.dataset.readyState = state.readyState;
    this.dataset.renderMode = state.renderMode;
    this.dataset.viewMode = state.viewMode;

    if (state.readyState === "loading") return;

    const signature = JSON.stringify(state);
    if (signature === this._lastReadySignature) return;
    this._lastReadySignature = signature;

    const schedule = globalThis.requestAnimationFrame
      ? globalThis.requestAnimationFrame.bind(globalThis)
      : (cb: FrameRequestCallback) => {
          cb(0);
          return 0;
        };

    schedule(() => {
      this.dispatchEvent(
        new CustomEvent("viz-ready", {
          bubbles: true,
          composed: true,
          detail: state,
        }),
      );
    });
  }

  private _collectAllComments(): {
    warnings: Array<{ text: string; source: string; location: SourceLocation }>;
    questions: Array<{ text: string; source: string; location: SourceLocation }>;
  } {
    const warnings: Array<{ text: string; source: string; location: SourceLocation }> = [];
    const questions: Array<{ text: string; source: string; location: SourceLocation }> = [];

    if (!this.model) return { warnings, questions };

    for (const ns of this.model.namespaces) {
      for (const s of ns.schemas) {
        for (const c of s.comments) {
          const entry = { text: c.text, source: s.id, location: c.location };
          if (c.kind === "warning") warnings.push(entry);
          else questions.push(entry);
        }
      }
      for (const m of ns.mappings) {
        for (const c of m.comments) {
          const entry = { text: c.text, source: `mapping ${m.id}`, location: c.location };
          if (c.kind === "warning") warnings.push(entry);
          else questions.push(entry);
        }
      }
    }

    return { warnings, questions };
  }

  private _renderNotesPane(allComments: {
    warnings: Array<{ text: string; source: string; location: SourceLocation }>;
    questions: Array<{ text: string; source: string; location: SourceLocation }>;
  }) {
    const fileNotes = this.model?.fileNotes ?? [];

    return html`
      <div class="notes-pane">
        <div class="notes-pane-header">Notes &amp; Comments</div>
        ${fileNotes.length > 0
          ? html`
              <div class="notes-pane-section">File Notes</div>
              ${fileNotes.map((n) => html`<div class="note-card">${unsafeHTML(renderMarkdown(n.text))}</div>`)}
            `
          : ""}
        ${allComments.warnings.length > 0
          ? html`
              <div class="notes-pane-section">&#9888; Warnings (${allComments.warnings.length})</div>
              ${allComments.warnings.map(
                (w) => html`
                  <div class="comment-card warning" @click=${() => this._navigateTo(w.location)}
                    title="Click to navigate">
                    ${w.text}
                    <div class="comment-card-source">${w.source}</div>
                  </div>
                `
              )}
            `
          : ""}
        ${allComments.questions.length > 0
          ? html`
              <div class="notes-pane-section">? Questions (${allComments.questions.length})</div>
              ${allComments.questions.map(
                (q) => html`
                  <div class="comment-card question" @click=${() => this._navigateTo(q.location)}
                    title="Click to navigate">
                    ${q.text}
                    <div class="comment-card-source">${q.source}</div>
                  </div>
                `
              )}
            `
          : ""}
      </div>
    `;
  }

  private _renderMinimap(layout: LayoutResult) {
    const mmW = 160;
    const mmH = 100;
    const scale = Math.min(mmW / (layout.width + 48), mmH / (layout.height + 48));

    // Viewport rectangle (inverse of pan/zoom transform)
    const host = this.renderRoot?.querySelector?.(".viewport") as HTMLElement | null;
    const vpW = host?.clientWidth ?? 800;
    const vpH = host?.clientHeight ?? 600;
    const vx = (-this._panX / this._zoom) * scale;
    const vy = (-this._panY / this._zoom) * scale;
    const vw = (vpW / this._zoom) * scale;
    const vh = (vpH / this._zoom) * scale;

    return html`
      <div class="minimap" @click=${(e: MouseEvent) => this._onMinimapClick(e, layout, scale)}>
        <svg width=${mmW} height=${mmH} viewBox="0 0 ${mmW} ${mmH}">
          ${[...layout.nodes.values()].map(
            (n) => svg`
              <rect
                x=${n.x * scale} y=${n.y * scale}
                width=${n.width * scale} height=${n.height * scale}
                fill="var(--sz-card-border-strong)"
                rx="1"
              />
            `
          )}
        </svg>
        <div class="minimap-viewport"
          style="left: ${vx}px; top: ${vy}px; width: ${vw}px; height: ${vh}px;"
        ></div>
      </div>
    `;
  }

  private _onMinimapClick(e: MouseEvent, layout: LayoutResult, scale: number) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Convert minimap coordinates to canvas coordinates and center the viewport
    const host = this.renderRoot?.querySelector?.(".viewport") as HTMLElement | null;
    const vpW = host?.clientWidth ?? 800;
    const vpH = host?.clientHeight ?? 600;

    this._panX = -(mx / scale - vpW / (2 * this._zoom)) * this._zoom;
    this._panY = -(my / scale - vpH / (2 * this._zoom)) * this._zoom;
  }

  private _renderSourceBlock(sb: SourceBlockLayout, layout: LayoutResult) {
    if (!sb.joinDescription && sb.filters.length === 0) return html``;

    // Position between the source schema cards
    const nodes = sb.schemas.map((id) => layout.nodes.get(id)).filter(Boolean);
    if (nodes.length === 0) return html``;

    const firstNode = nodes[0]!;
    const x = firstNode.x + firstNode.width + 12;
    let y = firstNode.y;
    const results = [];

    if (sb.joinDescription) {
      results.push(html`
        <div class="source-block-label" style="left: ${x}px; top: ${y}px;">
          &#x2A1D; ${sb.joinDescription}
        </div>
      `);
      y += 24;
    }

    for (const f of sb.filters) {
      results.push(html`
        <div class="source-block-filter" style="left: ${x}px; top: ${y}px;">
          &#x25B7; ${f}
        </div>
      `);
      y += 20;
    }

    return results;
  }

  private _navigateTo(loc: SourceLocation) {
    this.dispatchEvent(new SzNavigateEvent(loc));
  }

  private _collapseAll() {
    this._expandedModels = new Map();
    this._runLayout();
  }

  private _onNsFilterChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    this._nsFilter = val || null;
  }

  private _onFileFilterChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    this._fileFilter = val || null;
  }

  /** Extract unique source file URIs from the current model, primary file first. */
  private _getSourceFiles(): string[] {
    if (!this.model) return [];
    const uris = new Set<string>();
    for (const ns of this.model.namespaces) {
      for (const s of ns.schemas) uris.add(s.location.uri);
      for (const m of ns.mappings) uris.add(m.location.uri);
      for (const mt of ns.metrics) uris.add(mt.location.uri);
    }
    // Put the primary (current) file first in the list.
    const result: string[] = [];
    if (this.model.uri && uris.has(this.model.uri)) {
      result.push(this.model.uri);
      uris.delete(this.model.uri);
    }
    for (const uri of uris) result.push(uri);
    return result;
  }

  private _filterNamespaces(namespaces: NamespaceGroup[]): NamespaceGroup[] {
    let result = namespaces;

    // Namespace filter
    if (this._nsFilter) {
      result = result.filter(
        (ns) => ns.name === this._nsFilter || (!ns.name && result.some((n) => n.name === this._nsFilter))
      );
    }

    // File filter — narrow schemas/mappings/metrics/fragments to those from the selected file.
    if (this._fileFilter) {
      result = result.map(ns => ({
        ...ns,
        schemas: ns.schemas.filter(s => s.location.uri === this._fileFilter),
        mappings: ns.mappings.filter(m => m.location.uri === this._fileFilter),
        metrics: ns.metrics.filter(m => m.location.uri === this._fileFilter),
        fragments: ns.fragments.filter(f => f.location.uri === this._fileFilter),
      })).filter(ns =>
        ns.schemas.length > 0 || ns.mappings.length > 0 ||
        ns.metrics.length > 0 || ns.fragments.length > 0
      );
    }

    return result;
  }

  /** Filter overview edges to only those whose source and target nodes are visible. */
  private _filterOverviewEdges(
    edges: import("./layout/elk-layout.js").OverviewEdge[],
    visibleNamespaces: NamespaceGroup[],
  ): import("./layout/elk-layout.js").OverviewEdge[] {
    if (!this._nsFilter && !this._fileFilter) return edges;
    const visibleIds = new Set<string>();
    for (const ns of visibleNamespaces) {
      for (const s of ns.schemas) visibleIds.add(s.qualifiedId);
      for (const f of ns.fragments) visibleIds.add(f.id);
      for (const m of ns.metrics) visibleIds.add(m.qualifiedId);
      for (const m of ns.mappings) visibleIds.add(this._overviewMappingNodeId(ns.name, m.id));
    }
    return edges.filter((e) => visibleIds.has(e.sourceNode) && visibleIds.has(e.targetNode));
  }

  private _renderFileNotes() {
    if (!this.model || this.model.fileNotes.length === 0) return html``;

    const notes = this.model.fileNotes;
    return html`
      <div class="file-notes">
        <div class="file-notes-toggle" data-testid="file-notes-toggle" @click=${this._toggleFileNotes}>
          <span class="arrow" ?data-expanded=${this._fileNotesExpanded}>&#9654;</span>
          <span>&#128221; File Notes (${notes.length})</span>
        </div>
        ${this._fileNotesExpanded
          ? notes.map((n) => html`<div class="file-note-item">${unsafeHTML(renderMarkdown(n.text))}</div>`)
          : ""}
      </div>
    `;
  }

  private _toggleFileNotes() {
    this._fileNotesExpanded = !this._fileNotesExpanded;
  }

  private _renderPositioned(layout: LayoutResult, namespaces: NamespaceGroup[]) {
    // Track which schema IDs came from expansions for animation
    const expandedIds = new Set<string>();
    for (const models of this._expandedModels.values()) {
      for (const m of models) {
        for (const ns of m.namespaces) {
          for (const s of ns.schemas) expandedIds.add(s.qualifiedId);
          for (const f of ns.fragments) expandedIds.add(f.id);
          for (const mt of ns.metrics) expandedIds.add(mt.qualifiedId);
        }
      }
    }

    return html`
      <div class="canvas" style="width: ${layout.width + 48}px; height: ${layout.height + 48}px; padding: 24px;">
        <!-- Everything positioned from layout coordinates lives inside
             .card-layer so cards, edges, and labels share one coordinate
             origin by construction — siblings anchored to the canvas padding
             box render 24px above/left of the in-flow cards (sl-wixe). -->
        <div class="card-layer">
          <!-- SVG edge layer (z-raised above cards) -->
          <sz-edge-layer
            style="z-index: 30;"
            .edges=${layout.edges}
            .width=${layout.width}
            .height=${layout.height}
            .highlightSchema=${this._hoveredSchema}
            .highlightField=${this._hoveredField}
          ></sz-edge-layer>

          <!-- Source block join/filter labels -->
          ${layout.sourceBlocks.map((sb) => this._renderSourceBlock(sb, layout))}
          ${namespaces.flatMap((ns) => [
            ...ns.schemas.flatMap((s) => {
              const node = layout.nodes.get(s.qualifiedId);
              if (!node) return [html``];
              const mapped = this._mappedFieldsBySchema.get(s.qualifiedId) ?? new Set();
              const isExpanded = expandedIds.has(s.qualifiedId);
              const results = [html`
                <div class="positioned-card ${isExpanded ? "expanded" : ""}" data-node-id=${s.qualifiedId} style="left: ${node.x}px; top: ${node.y}px; width: ${node.width}px;">
                  <sz-schema-card
                    data-testid=${`detail-schema-card-${sanitizeTestIdSegment(s.qualifiedId)}`}
                    .testIdPrefix=${`detail-schema-card-${sanitizeTestIdSegment(s.qualifiedId)}`}
                    .schema=${s}
                    .mappedFields=${mapped}
                    .namespaceLabel=${ns.name}
                  ></sz-schema-card>
                </div>
              `];
              // Block-level comment badges
              let badgeOffset = 0;
              for (const c of s.comments) {
                results.push(html`
                  <div class="block-comment-badge ${c.kind}"
                    style="left: ${node.x + node.width + 8}px; top: ${node.y + badgeOffset}px;"
                    title=${c.text}
                    @click=${() => this._navigateTo(c.location)}
                  >${c.kind === "warning" ? "⚠" : "?"} ${c.text}</div>
                `);
                badgeOffset += 24;
              }
              return results;
            }),
            ...ns.fragments.map((f) => {
              const node = layout.nodes.get(f.id);
              if (!node) return html``;
              const isExpanded = expandedIds.has(f.id);
              return html`
                <div class="positioned-card ${isExpanded ? "expanded" : ""}" data-node-id=${f.id} style="left: ${node.x}px; top: ${node.y}px; width: ${node.width}px;">
                  <sz-fragment-card .fragment=${f} .namespaceLabel=${ns.name}></sz-fragment-card>
                </div>
              `;
            }),
            ...ns.metrics.map((m) => {
              const node = layout.nodes.get(m.qualifiedId);
              if (!node) return html``;
              const isExpanded = expandedIds.has(m.qualifiedId);
              return html`
                <div class="positioned-card ${isExpanded ? "expanded" : ""}" data-node-id=${m.qualifiedId} style="left: ${node.x}px; top: ${node.y}px; width: ${node.width}px;">
                  <sz-metric-card .metric=${m} .namespaceLabel=${ns.name}></sz-metric-card>
                </div>
              `;
            }),
          ])}
        </div>
      </div>
    `;
  }

  private _renderFlexFallback(namespaces: NamespaceGroup[]) {
    return html`
      <div class="flex-canvas">
        ${namespaces.map((ns) =>
          ns.name
            ? html`
                <div class="namespace-group">
                  <span class="namespace-label">${ns.name}</span>
                  ${this._renderFlexCards(ns)}
                </div>
              `
            : this._renderFlexCards(ns)
        )}
      </div>
    `;
  }

  private _renderFlexCards(ns: NamespaceGroup) {
    return html`
      ${ns.schemas.map((s) => {
        const mapped = this._mappedFieldsBySchema.get(s.qualifiedId) ?? new Set();
        return html`<sz-schema-card
          data-testid=${`fallback-schema-card-${sanitizeTestIdSegment(s.qualifiedId)}`}
          .testIdPrefix=${`fallback-schema-card-${sanitizeTestIdSegment(s.qualifiedId)}`}
          .schema=${s}
          .mappedFields=${mapped}
          .namespaceLabel=${ns.name}
        ></sz-schema-card>`;
      })}
      ${ns.fragments.map(
        (f) => html`<sz-fragment-card .fragment=${f} .namespaceLabel=${ns.name}></sz-fragment-card>`
      )}
      ${ns.metrics.map(
        (m) => html`<sz-metric-card .metric=${m} .namespaceLabel=${ns.name}></sz-metric-card>`
      )}
    `;
  }

  private _computeNamespaceBoxes(
    layout: LayoutResult,
    namespaces: NamespaceGroup[]
  ): Array<{ name: string; x: number; y: number; w: number; h: number }> {
    if (this._renderedNamespaceBoxes.length > 0) {
      return this._renderedNamespaceBoxes;
    }
    const boxes: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];

    for (const ns of namespaces) {
      if (!ns.name) continue;

      const ids = [
        ...ns.schemas.map((s) => s.qualifiedId),
        ...ns.fragments.map((f) => f.id),
        ...ns.metrics.map((m) => m.qualifiedId),
        ...ns.mappings.map((m) => this._overviewMappingNodeId(ns.name, m.id)),
      ];

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let found = false;

      for (const id of ids) {
        const node = layout.nodes.get(id);
        if (!node) continue;
        found = true;
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + node.width);
        maxY = Math.max(maxY, node.y + node.height);
      }

      if (found) {
        const pad = 16;
        boxes.push({
          name: ns.name,
          x: minX - pad,
          y: minY - pad - 12, // extra space for label
          w: maxX - minX + pad * 2,
          h: maxY - minY + pad * 2 + 12,
        });
      }
    }

    return boxes;
  }

  private _measureNamespaceBoxes() {
    const canvas = this.renderRoot?.querySelector?.(".canvas") as HTMLElement | null;
    if (!canvas || !this.model) {
      if (this._renderedNamespaceBoxes.length > 0) this._renderedNamespaceBoxes = [];
      return;
    }

    const namespaces = this._filterNamespaces(this.model.namespaces);
    const boxes: Array<{ name: string; x: number; y: number; w: number; h: number }> = [];
    const padX = 0;
    const padTop = 0;
    const padBottom = 0;
    const labelPad = 10;

    for (const ns of namespaces) {
      if (!ns.name) continue;

      const ids = [
        ...ns.schemas.map((s) => s.qualifiedId),
        ...ns.fragments.map((f) => f.id),
        ...ns.metrics.map((m) => m.qualifiedId),
        ...ns.mappings.map((m) => this._overviewMappingNodeId(ns.name, m.id)),
      ];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let found = false;

      for (const id of ids) {
        const el = canvas.querySelector(`.positioned-card[data-node-id="${CSS.escape(id)}"]`) as HTMLElement | null;
        if (!el) continue;
        found = true;
        minX = Math.min(minX, el.offsetLeft);
        minY = Math.min(minY, el.offsetTop);
        maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
        maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
      }

      if (found) {
        boxes.push({
          name: ns.name,
          x: minX - padX,
          y: minY - padTop - labelPad,
          w: maxX - minX + padX * 2,
          h: maxY - minY + padTop + padBottom + labelPad,
        });
      }
    }

    const prev = JSON.stringify(this._renderedNamespaceBoxes);
    const next = JSON.stringify(boxes);
    if (prev !== next) {
      this._renderedNamespaceBoxes = boxes;
    }
  }

  private _measureContentBounds(canvas: HTMLElement): {
    minX: number;
    minY: number;
    width: number;
    height: number;
  } | null {
    const selectors = [
      ".positioned-card",
      ".namespace-box",
      ".block-comment-badge",
      ".source-block-label",
      ".source-block-filter",
    ];
    const elements = selectors.flatMap((selector) =>
      Array.from(canvas.querySelectorAll(selector)) as HTMLElement[]
    );

    if (elements.length === 0) {
      const width = Math.max(canvas.scrollWidth, canvas.offsetWidth);
      const height = Math.max(canvas.scrollHeight, canvas.offsetHeight);
      if (width <= 0 || height <= 0) return null;
      return { minX: 0, minY: 0, width, height };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const el of elements) {
      minX = Math.min(minX, el.offsetLeft);
      minY = Math.min(minY, el.offsetTop);
      maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
      maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
    }

    const padding = 24;
    return {
      minX: minX - padding,
      minY: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }
  private _buildMappedFieldsIndex(): Map<string, Set<string>> {
    return this.model ? buildMappedFieldsIndex(this.model) : new Map();
  }
}

declare global {
  interface HTMLElementEventMap {
    navigate: SzNavigateEvent;
  }
}

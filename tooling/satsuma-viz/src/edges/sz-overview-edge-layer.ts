/**
 * SVG edge layer for the schema-level overview.
 *
 * Renders thick (3-4px) curved arrows between schema nodes. Each arrow is
 * labeled with the mapping name at the midpoint. Click dispatches
 * SzOpenMappingEvent. Hover shows a tooltip with mapping summary.
 */

import { LitElement, html, svg, css, unsafeCSS, type SVGTemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { OverviewEdge } from "../layout/elk-layout.js";
import type { MappingBlock } from "../model.js";
import tokens from "../tokens.css";

/** Event dispatched when a user clicks an overview edge to open a mapping detail. */
export class SzOpenMappingEvent extends Event {
  readonly mapping: MappingBlock;
  constructor(mapping: MappingBlock) {
    super("open-mapping", { bubbles: true, composed: true });
    this.mapping = mapping;
  }
}

@customElement("sz-overview-edge-layer")
export class SzOverviewEdgeLayer extends LitElement {
  static override styles = css`
    ${unsafeCSS(tokens)}

    :host {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      overflow: visible;
    }

    svg {
      overflow: visible;
    }

    .overview-path {
      fill: none;
      stroke-width: 3;
      stroke: var(--sz-edge-default);
      pointer-events: stroke;
      transition: stroke-width 0.15s ease, stroke 0.15s ease, opacity 0.15s ease, filter 0.15s ease;
      opacity: 0.55;
    }

    .overview-path:hover {
      stroke-width: 5;
      opacity: 1;
    }

    .overview-path.highlighted {
      stroke: var(--sz-arrow-nl-stroke);
      stroke-width: 4;
      opacity: 1;
      filter: drop-shadow(0 0 4px var(--sz-edge-highlight-glow));
    }

    .overview-path.highlighted:hover {
      stroke-width: 5;
    }

    /* Dim non-highlighted edges when any node is hovered */
    .overview-path.dimmed {
      opacity: 0.2;
    }

    .anchor-dot {
      pointer-events: none;
      fill: var(--sz-edge-default);
      opacity: 0.55;
      transition: fill 0.15s ease, opacity 0.15s ease;
    }

    .anchor-dot.highlighted {
      fill: var(--sz-arrow-nl-stroke);
      opacity: 1;
    }

    .anchor-dot.dimmed {
      opacity: 0.2;
    }

    /* Tooltip */
    .tooltip {
      position: absolute;
      pointer-events: none;
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      box-shadow: var(--sz-card-shadow);
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 11px;
      white-space: nowrap;
      z-index: 20;
    }

    .tooltip-name {
      font-weight: 600;
      color: var(--sz-text);
      margin-bottom: 2px;
    }

    .tooltip-detail {
      color: var(--sz-text-muted);
    }

    .tooltip-count {
      font-family: var(--sz-font-mono);
      color: var(--sz-orange-dark);
    }
  `;

  @property({ type: Array })
  edges: OverviewEdge[] = [];

  @property({ type: Number })
  width = 800;

  @property({ type: Number })
  height = 600;

  /** Set of node IDs currently hovered — connected edges get highlighted. */
  @property({ attribute: false })
  highlightNodes: Set<string> = new Set();

  @state()
  private _hoveredEdge: string | null = null;

  @state()
  private _hoverPos: { x: number; y: number } = { x: 0, y: 0 };

  override render() {
    const hoveredEdge = this._hoveredEdge
      ? this.edges.find((e) => e.id === this._hoveredEdge)
      : null;

    return html`
      <svg
        width=${this.width}
        height=${this.height}
        viewBox="0 0 ${this.width} ${this.height}"
      >
        ${this.edges.map((e) => this._renderOverviewEdge(e))}
      </svg>
      ${hoveredEdge ? this._renderTooltip(hoveredEdge) : ""}
    `;
  }

  private _renderOverviewEdge(edge: OverviewEdge): SVGTemplateResult {
    if (edge.points.length < 2) return svg``;

    const d = this._buildRoutedPath(edge.points);
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];

    const hasHighlight = this.highlightNodes.size > 0;
    const connected = hasHighlight && (
      this.highlightNodes.has(edge.sourceNode) || this.highlightNodes.has(edge.targetNode)
    );
    const cls = hasHighlight ? (connected ? "highlighted" : "dimmed") : "";

    return svg`
      <path
        class="overview-path ${cls}"
        d=${d}
        @mouseenter=${(ev: MouseEvent) => this._onEdgeHover(edge.id, ev)}
        @mouseleave=${() => this._onEdgeLeave()}
      />
      <circle class="anchor-dot ${cls}" cx=${first.x} cy=${first.y} r="3.5" />
      <circle class="anchor-dot ${cls}" cx=${last.x} cy=${last.y} r="3.5" />
    `;
  }

  private _buildRoutedPath(points: Array<{ x: number; y: number }>): string {
    if (points.length < 2) return "";
    const [first, ...rest] = points;
    if (rest.length === 1) {
      return `M ${first.x} ${first.y} L ${rest[0].x} ${rest[0].y}`;
    }
    // Use cubic bezier for smooth horizontal-exit, vertical-mid, horizontal-enter routing
    if (rest.length === 3) {
      const [mid1, mid2, last] = rest;
      const r = Math.min(20, Math.abs(mid1.y - mid2.y) / 2, Math.abs(mid1.x - first.x) / 2);
      return [
        `M ${first.x} ${first.y}`,
        `L ${mid1.x - r} ${mid1.y}`,
        `Q ${mid1.x} ${mid1.y} ${mid1.x} ${mid1.y + Math.sign(mid2.y - mid1.y) * r}`,
        `L ${mid2.x} ${mid2.y - Math.sign(mid2.y - mid1.y) * r}`,
        `Q ${mid2.x} ${mid2.y} ${mid2.x + r} ${mid2.y}`,
        `L ${last.x} ${last.y}`,
      ].join(" ");
    }
    // Fallback: straight segments
    return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
  }

  private _onEdgeHover(edgeId: string, ev: MouseEvent) {
    this._hoveredEdge = edgeId;
    const rect = this.getBoundingClientRect();
    this._hoverPos = { x: ev.clientX - rect.left + 12, y: ev.clientY - rect.top - 10 };
  }

  private _onEdgeLeave() {
    this._hoveredEdge = null;
  }

  private _countAllArrows(m: MappingBlock): number {
    let count = m.arrows.length;
    for (const eb of m.eachBlocks) count += eb.arrows.length;
    for (const fb of m.flattenBlocks) count += fb.arrows.length;
    return count;
  }

  private _renderTooltip(edge: OverviewEdge) {
    const m = edge.mapping;
    const arrowCount = this._countAllArrows(m);

    return html`
      <div class="tooltip" style="left: ${this._hoverPos.x}px; top: ${this._hoverPos.y}px;">
        <div class="tooltip-name">${m.id}</div>
        <div class="tooltip-detail">
          ${m.sourceRefs.join(", ")} &#x2192; ${m.targetRef}
        </div>
        <div class="tooltip-count">${arrowCount} arrow${arrowCount !== 1 ? "s" : ""}</div>
      </div>
    `;
  }
}

/**
 * SVG edge layer — renders Bezier curves between mapped field ports.
 *
 * Sits as an SVG overlay on top of the card DOM. Receives positioned edge
 * data from the ELK layout engine and renders styled paths with optional
 * gear icons at the midpoint for transform detail.
 */

import { LitElement, html, svg, css, unsafeCSS, type SVGTemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, property, state } from "lit/decorators.js";
import type { LayoutEdge } from "../layout/elk-layout.js";
import { highlightAtRefs } from "../markdown.js";
import tokens from "../tokens.css";
import { SzNavigateEvent } from "../satsuma-viz.js";

@customElement("sz-edge-layer")
export class SzEdgeLayer extends LitElement {
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

    .edge-path {
      fill: none;
      stroke-width: 1.5;
      pointer-events: stroke;
      cursor: pointer;
      transition: stroke-width 0.15s ease;
    }

    .edge-path:hover {
      stroke-width: 3;
    }

    .edge-path.nl {
      stroke: var(--sz-arrow-nl-stroke);
      stroke-dasharray: 6 3;
    }

    .edge-path.bare {
      stroke: var(--sz-text-muted);
      stroke-width: 1;
    }

    .gear-group {
      pointer-events: all;
      cursor: pointer;
    }

    .gear-circle {
      fill: var(--sz-card-bg);
      stroke: var(--sz-text-muted);
      stroke-width: 1;
    }

    .gear-icon {
      fill: var(--sz-text-muted);
      font-size: 10px;
      text-anchor: middle;
      dominant-baseline: central;
    }

    .gear-group:hover .gear-circle {
      stroke: var(--sz-orange);
      fill: var(--sz-badge-bg);
    }

    .gear-group:hover .gear-icon {
      fill: var(--sz-orange);
    }

    .transform-card {
      position: absolute;
      pointer-events: all;
      background: var(--sz-card-bg);
      border: 1px solid var(--sz-card-border);
      box-shadow: var(--sz-card-shadow);
      border-radius: var(--sz-card-radius);
      padding: 8px 12px;
      font-size: 11px;
      max-width: 280px;
      z-index: 10;
    }

    .transform-card .label {
      font-family: var(--sz-font-sans);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--sz-text-muted);
      margin-bottom: 4px;
      letter-spacing: 0.04em;
    }

    .transform-card .step-text {
      font-family: var(--sz-font-mono);
      color: var(--sz-text);
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* @ref highlights inside NL transform steps */
    .transform-card .at-ref {
      font-weight: 600;
      color: var(--sz-at-ref);
    }

    .transform-card .step {
      display: flex;
      gap: 4px;
      align-items: baseline;
      padding: 1px 0;
    }

    .transform-card .step-sep {
      color: var(--sz-text-muted);
    }

    .scope-label {
      font-family: var(--sz-font-mono);
      font-size: 9px;
      font-weight: 600;
      fill: var(--sz-text-muted);
      text-anchor: middle;
      pointer-events: none;
    }

    .scope-label.each {
      fill: var(--sz-orange-dark);
    }

    .scope-label.flatten {
      fill: var(--sz-green);
    }

    /* Dimmed edges when highlighting a field */
    :host([has-highlight]) .edge-path {
      opacity: 0.15;
      transition: opacity 0.15s ease, stroke-width 0.15s ease;
    }

    :host([has-highlight]) .edge-path.highlighted {
      opacity: 1;
      stroke-width: 3;
    }

    :host([has-highlight]) .gear-group {
      opacity: 0.15;
    }

    :host([has-highlight]) .gear-group.highlighted {
      opacity: 1;
    }

    :host([has-highlight]) .scope-label {
      opacity: 0.15;
    }

    :host([has-highlight]) .scope-label.highlighted {
      opacity: 1;
    }
  `;

  @property({ type: Array })
  edges: LayoutEdge[] = [];

  @property({ type: Number })
  width = 800;

  @property({ type: Number })
  height = 600;

  /** Schema ID of the hovered field's card */
  @property({ type: String })
  highlightSchema: string | null = null;

  /** Field name currently hovered */
  @property({ type: String })
  highlightField: string | null = null;

  @state()
  private _expandedEdge: string | null = null;

  override updated(changed: Map<string, unknown>) {
    if (changed.has("highlightSchema") || changed.has("highlightField")) {
      if (this.highlightSchema && this.highlightField) {
        this.setAttribute("has-highlight", "");
      } else {
        this.removeAttribute("has-highlight");
      }
    }
  }

  private _isEdgeHighlighted(edge: LayoutEdge): boolean {
    if (!this.highlightSchema || !this.highlightField) return false;

    // Check if this edge connects to the highlighted field
    const matchesSource =
      edge.sourceNode === this.highlightSchema &&
      edge.arrow.sourceFields.includes(this.highlightField);
    const matchesTarget =
      edge.targetNode === this.highlightSchema &&
      edge.arrow.targetField === this.highlightField;

    return matchesSource || matchesTarget;
  }

  override render() {
    return html`
      <svg
        width=${this.width}
        height=${this.height}
        viewBox="0 0 ${this.width} ${this.height}"
      >
        ${this.edges.map((e) => this._renderEdge(e))}
      </svg>
      ${this._expandedEdge ? this._renderTransformCard() : ""}
    `;
  }

  private _renderEdge(edge: LayoutEdge): SVGTemplateResult {
    if (edge.points.length < 2) return svg``;

    const d = this._buildCurvePath(edge.points);
    const kind = edge.arrow.transform?.kind ?? "bare";
    // After Feature 28, all transforms are nl or map — both render as NL style
    const cls = kind === "nl" || kind === "map" ? "nl" : "bare";

    const mid = this._midpoint(edge.points);
    const hasTransform = edge.arrow.transform !== null;
    const hl = this._isEdgeHighlighted(edge) ? "highlighted" : "";

    return svg`
      <path
        class="edge-path ${cls} ${hl}"
        d=${d}
        @click=${() => this._onEdgeClick(edge)}
      />
      ${hasTransform
        ? svg`
          <g
            class="gear-group ${hl}"
            transform="translate(${mid.x}, ${mid.y})"
            @click=${(ev: Event) => { ev.stopPropagation(); this._toggleGear(edge.id); }}
          >
            <circle class="gear-circle" r="9" />
            <text class="gear-icon" dy="0.5">&#9881;</text>
          </g>
        `
        : svg``}
      ${edge.scopeLabel
        ? svg`
          <text
            class="scope-label ${edge.scopeLabel} ${hl}"
            x=${mid.x}
            y=${mid.y + (hasTransform ? 18 : 0)}
          >${edge.scopeLabel === "each" ? "⟲ each" : "⤵ flatten"}</text>
        `
        : svg``}
    `;
  }

  private _buildCurvePath(points: Array<{ x: number; y: number }>): string {
    if (points.length === 2) {
      // Simple cubic bezier with horizontal control points
      const [p0, p1] = points;
      const dx = (p1.x - p0.x) * 0.5;
      return `M ${p0.x} ${p0.y} C ${p0.x + dx} ${p0.y}, ${p1.x - dx} ${p1.y}, ${p1.x} ${p1.y}`;
    }

    // Multi-point: start with move, then curve through bend points
    const parts = [`M ${points[0].x} ${points[0].y}`];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dx = (curr.x - prev.x) * 0.4;
      parts.push(
        `C ${prev.x + dx} ${prev.y}, ${curr.x - dx} ${curr.y}, ${curr.x} ${curr.y}`
      );
    }
    return parts.join(" ");
  }

  private _midpoint(
    points: Array<{ x: number; y: number }>
  ): { x: number; y: number } {
    const mid = Math.floor(points.length / 2);
    if (points.length % 2 === 0) {
      return {
        x: (points[mid - 1].x + points[mid].x) / 2,
        y: (points[mid - 1].y + points[mid].y) / 2,
      };
    }
    return points[mid];
  }

  private _onEdgeClick(edge: LayoutEdge) {
    if (edge.arrow.location.uri) {
      this.dispatchEvent(new SzNavigateEvent(edge.arrow.location));
    }
  }

  private _toggleGear(edgeId: string) {
    this._expandedEdge = this._expandedEdge === edgeId ? null : edgeId;
  }

  private _renderTransformCard() {
    const edge = this.edges.find((e) => e.id === this._expandedEdge);
    if (!edge?.arrow.transform) return html``;

    const mid = this._midpoint(edge.points);
    const t = edge.arrow.transform;

    return html`
      <div
        class="transform-card"
        style="left: ${mid.x + 16}px; top: ${mid.y - 12}px"
        @click=${(ev: Event) => ev.stopPropagation()}
      >
        <div class="label">
          ${t.kind === "map" ? "Map" : "Transform"}
        </div>
        ${t.steps.length > 0
          ? html`${t.steps.map(
              (step, i) => html`
                <div class="step">
                  ${i > 0 ? html`<span class="step-sep">|</span>` : ""}
                  <span class="step-text">${unsafeHTML(highlightAtRefs(step))}</span>
                </div>
              `
            )}`
          : html`<div class="step-text">${unsafeHTML(highlightAtRefs(t.text))}</div>`}
      </div>
    `;
  }
}

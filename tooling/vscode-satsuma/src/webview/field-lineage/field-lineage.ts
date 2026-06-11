/**
 * field-lineage.ts — Webview renderer for the Field Lineage panel.
 *
 * Uses ELK.js (layered / RIGHT) to position field node cards, then renders
 * them as absolutely-positioned divs with an SVG overlay for Bezier edges.
 * Design tokens match @satsuma/viz (--sz-* palette).
 */

// @ts-nocheck — runs in webview context (no VS Code types available)

import ELK from "elkjs/lib/elk.bundled.js";

const vscode = acquireVsCodeApi();
const elk = new ELK();

// ── Layout constants ───────────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 80;   // header 30 + field 26 + via 24
const FOCAL_W = 220;
const FOCAL_H = 68;  // header 30 + field 38 (larger, no via label)
const CANVAS_PADDING = 40;

// ── Type declarations ──────────────────────────────────────────────────────

interface Entry {
  field: string;
  via_mapping: string;
  classification: string;
}

interface Payload {
  field: string;
  upstream: Entry[];
  downstream: Entry[];
  breadcrumb: string[];
  isDark: boolean;
}

interface NodePos {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Direction = "both" | "upstream" | "downstream";

// ── Session state (depth + direction persist across re-centres) ─────────────

let sessionDepth = 3;
let sessionDirection: Direction = "both";
/** Full unfiltered payload from the last message — used for client-side re-filtering. */
let lastPayload: Payload | null = null;

// ── Entry point ────────────────────────────────────────────────────────────

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type: string; payload?: Payload; message?: string };
  if (msg.type === "fieldLineageData" && msg.payload) {
    lastPayload = msg.payload;
    render(applyFilters(msg.payload));
  } else if (msg.type === "error") {
    showError(msg.message ?? "Unknown error");
  }
});

/**
 * Apply the direction filter to a payload.
 *
 * After Feature 28, all transforms are NL — the classification filter is
 * removed (no structural/mixed to distinguish). Only direction filtering
 * remains.
 */
function applyFilters(payload: Payload): Payload {
  const upstream = sessionDirection === "downstream" ? [] : payload.upstream;
  const downstream = sessionDirection === "upstream" ? [] : payload.downstream;
  return { ...payload, upstream, downstream };
}

// ── Render ─────────────────────────────────────────────────────────────────

async function render(payload: Payload): Promise<void> {
  const root = document.getElementById("field-lineage-root")!;

  if (payload.isDark) {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }

  const hasNodes = payload.upstream.length > 0 || payload.downstream.length > 0;

  const toolbar = buildToolbar(payload.breadcrumb);

  if (!hasNodes) {
    root.innerHTML = "";
    root.appendChild(toolbar);
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent =
      sessionFilter === "all" && sessionDirection === "both"
        ? "No upstream or downstream lineage found for this field."
        : "No edges match the current filter settings.";
    root.appendChild(empty);
    return;
  }

  const graph = buildElkGraph(payload);
  let laid: ElkNode;
  try {
    laid = await elk.layout(graph);
  } catch (e) {
    showError(`Layout failed: ${e}`);
    return;
  }

  const canvas = buildCanvas(laid, payload);

  root.innerHTML = "";
  root.appendChild(toolbar);
  root.appendChild(canvas);
}

function showError(message: string): void {
  const root = document.getElementById("field-lineage-root")!;
  root.innerHTML = "";
  const div = document.createElement("div");
  div.className = "error-message";
  div.textContent = message;
  root.appendChild(div);
}

// ── ELK graph ──────────────────────────────────────────────────────────────

function buildElkGraph(payload: Payload): ElkNode {
  const children: ElkNode[] = [];
  const edges: ElkEdge[] = [];

  for (let i = 0; i < payload.upstream.length; i++) {
    children.push({ id: `up-${i}`, width: NODE_W, height: NODE_H });
    edges.push({ id: `e-up-${i}`, sources: [`up-${i}`], targets: ["focal"] });
  }

  children.push({ id: "focal", width: FOCAL_W, height: FOCAL_H });

  for (let i = 0; i < payload.downstream.length; i++) {
    children.push({ id: `dn-${i}`, width: NODE_W, height: NODE_H });
    edges.push({ id: `e-dn-${i}`, sources: ["focal"], targets: [`dn-${i}`] });
  }

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.spacing.nodeNode": "20",
      "elk.padding": `[top=${CANVAS_PADDING},left=${CANVAS_PADDING},bottom=${CANVAS_PADDING},right=${CANVAS_PADDING}]`,
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children,
    edges,
  };
}

// ── Canvas ─────────────────────────────────────────────────────────────────

function buildCanvas(laid: ElkNode, payload: Payload): HTMLDivElement {
  const w = (laid.width ?? 800);
  const h = (laid.height ?? 400);

  const wrap = document.createElement("div");
  wrap.className = "canvas-wrap";

  const canvas = document.createElement("div");
  canvas.className = "canvas";
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  // Build node position lookup
  const nodePos = new Map<string, NodePos>();
  for (const n of (laid.children ?? []) as ElkNode[]) {
    nodePos.set(n.id!, { x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? NODE_W, height: n.height ?? NODE_H });
  }

  // Upstream cards
  for (let i = 0; i < payload.upstream.length; i++) {
    const pos = nodePos.get(`up-${i}`);
    if (!pos) continue;
    const entry = payload.upstream[i]!;
    const card = buildFieldCard(entry, "upstream");
    positionCard(card, pos);
    canvas.appendChild(card);
  }

  // Focal card
  const focalPos = nodePos.get("focal");
  if (focalPos) {
    const card = buildFocalCard(payload.field);
    positionCard(card, focalPos);
    canvas.appendChild(card);
  }

  // Downstream cards
  for (let i = 0; i < payload.downstream.length; i++) {
    const pos = nodePos.get(`dn-${i}`);
    if (!pos) continue;
    const entry = payload.downstream[i]!;
    const card = buildFieldCard(entry, "downstream");
    positionCard(card, pos);
    canvas.appendChild(card);
  }

  // SVG edge overlay (inserted before cards so cards render on top)
  const svg = buildEdgeSvg(laid, payload, nodePos, w, h);
  canvas.insertBefore(svg, canvas.firstChild);

  wrap.appendChild(canvas);
  return wrap;
}

function positionCard(card: HTMLElement, pos: NodePos): void {
  card.style.position = "absolute";
  card.style.left = `${pos.x}px`;
  card.style.top = `${pos.y}px`;
  card.style.width = `${pos.width}px`;
}

// ── Field cards ────────────────────────────────────────────────────────────

function buildFieldCard(entry: Entry, role: "upstream" | "downstream"): HTMLDivElement {
  const { schemaLabel, fieldLabel } = parseFieldKey(entry.field);
  const via = formatMappingKey(entry.via_mapping);

  const card = document.createElement("div");
  card.className = `field-card ${role} cls-${entry.classification}`;
  card.title = entry.field;

  const header = document.createElement("div");
  header.className = "card-header";
  header.textContent = schemaLabel;
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "card-body";

  const fieldRow = document.createElement("div");
  fieldRow.className = "card-field";
  fieldRow.textContent = fieldLabel;
  body.appendChild(fieldRow);

  const viaRow = document.createElement("div");
  viaRow.className = "card-via";
  viaRow.textContent = `via ${via}`;
  viaRow.title = entry.via_mapping;
  body.appendChild(viaRow);

  card.appendChild(body);

  // Click re-centres on this field
  card.addEventListener("click", () => {
    const bare = entry.field.startsWith("::") ? entry.field.slice(2) : entry.field;
    vscode.postMessage({ type: "recenter", fieldPath: bare });
  });

  return card;
}

function buildFocalCard(fieldKey: string): HTMLDivElement {
  const { schemaLabel, fieldLabel } = parseFieldKey(fieldKey);

  const card = document.createElement("div");
  card.className = "field-card focal";
  card.title = fieldKey;

  const header = document.createElement("div");
  header.className = "card-header";
  header.textContent = schemaLabel;
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "card-body";

  const fieldRow = document.createElement("div");
  fieldRow.className = "card-field focal-field";
  fieldRow.textContent = fieldLabel;
  body.appendChild(fieldRow);

  card.appendChild(body);
  return card;
}

// ── SVG edges ──────────────────────────────────────────────────────────────

function buildEdgeSvg(
  laid: ElkNode,
  payload: Payload,
  nodePos: Map<string, NodePos>,
  w: number,
  h: number,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "edge-overlay");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  // Arrowhead markers per classification (none/nl/nl-derived only after Feature 28)
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  for (const cls of ["nl", "nl-derived", "none"]) {
    defs.appendChild(buildArrowMarker(cls));
  }
  svg.appendChild(defs);

  // Draw an edge for each ELK edge using node centre ports
  // (ELK ORTHOGONAL routing gives us bend points; we use a smooth Bezier instead)
  for (let i = 0; i < payload.upstream.length; i++) {
    const src = nodePos.get(`up-${i}`);
    const tgt = nodePos.get("focal");
    if (!src || !tgt) continue;
    const cls = payload.upstream[i]?.classification ?? "none";
    svg.appendChild(buildBezierEdge(src, tgt, cls));
  }

  for (let i = 0; i < payload.downstream.length; i++) {
    const src = nodePos.get("focal");
    const tgt = nodePos.get(`dn-${i}`);
    if (!src || !tgt) continue;
    const cls = payload.downstream[i]?.classification ?? "none";
    svg.appendChild(buildBezierEdge(src, tgt, cls));
  }

  return svg;
}

function buildBezierEdge(src: NodePos, tgt: NodePos, classification: string): SVGPathElement {
  // Connect right-centre of source to left-centre of target
  const x1 = src.x + src.width;
  const y1 = src.y + src.height / 2;
  const x2 = tgt.x;
  const y2 = tgt.y + tgt.height / 2;

  // Cubic Bezier control points: pull horizontally from each end
  const cp = Math.abs(x2 - x1) * 0.5;
  const d = `M ${x1},${y1} C ${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`;

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", `edge cls-${classification}`);
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("marker-end", `url(#arrow-${classification})`);

  if (classification === "nl-derived") {
    path.setAttribute("stroke-dasharray", "6 3");
  }

  return path;
}

function buildArrowMarker(classification: string): SVGMarkerElement {
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", `arrow-${classification}`);
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "7");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto");

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", "0 0, 8 3, 0 6");
  poly.setAttribute("class", `arrowhead cls-${classification}`);
  marker.appendChild(poly);

  return marker;
}

// ── Toolbar ────────────────────────────────────────────────────────────────

function buildToolbar(breadcrumb: string[]): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "toolbar";

  // Back button
  const back = document.createElement("button");
  back.className = "toolbar-btn";
  back.title = "Go back";
  back.disabled = breadcrumb.length <= 1;
  back.textContent = "\u2190"; // ←
  back.addEventListener("click", () => {
    vscode.postMessage({ type: "back" });
  });
  bar.appendChild(back);

  // Breadcrumb trail
  const crumbs = document.createElement("div");
  crumbs.className = "breadcrumb";
  for (let i = 0; i < breadcrumb.length; i++) {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      crumbs.appendChild(sep);
    }
    const crumb = document.createElement("span");
    crumb.className = i === breadcrumb.length - 1 ? "crumb crumb-current" : "crumb crumb-link";
    crumb.textContent = formatFieldKey(breadcrumb[i] ?? "");
    crumb.title = breadcrumb[i] ?? "";
    if (i < breadcrumb.length - 1) {
      const idx = i;
      crumb.addEventListener("click", () => {
        vscode.postMessage({ type: "breadcrumbGoto", index: idx });
      });
    }
    crumbs.appendChild(crumb);
  }
  bar.appendChild(crumbs);

  // Spacer
  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  bar.appendChild(spacer);

  // Direction toggle
  const dirWrap = document.createElement("div");
  dirWrap.className = "toolbar-control dir-toggle";

  const dirOptions: Array<{ value: Direction; label: string; title: string }> = [
    { value: "upstream",   label: "← Upstream",   title: "Show only upstream (where this field's data comes from)" },
    { value: "both",       label: "↔ Both",        title: "Show both upstream and downstream" },
    { value: "downstream", label: "Downstream →",  title: "Show only downstream (where this field's data goes to)" },
  ];

  for (const opt of dirOptions) {
    const btn = document.createElement("button");
    btn.className = `dir-btn${sessionDirection === opt.value ? " active" : ""}`;
    btn.dataset["dir"] = opt.value;
    btn.textContent = opt.label;
    btn.title = opt.title;
    btn.addEventListener("click", () => {
      sessionDirection = opt.value as Direction;
      dirWrap.querySelectorAll(".dir-btn").forEach((b) => {
        (b as HTMLElement).classList.toggle("active", (b as HTMLElement).dataset["dir"] === opt.value);
      });
      if (lastPayload) {
        render(applyFilters(lastPayload));
      }
    });
    dirWrap.appendChild(btn);
  }
  bar.appendChild(dirWrap);

  // Depth slider
  const depthWrap = document.createElement("div");
  depthWrap.className = "toolbar-control";

  const depthLabel = document.createElement("label");
  depthLabel.className = "toolbar-label";
  depthLabel.htmlFor = "depth-slider";
  depthLabel.textContent = `Depth: ${sessionDepth}`;
  depthWrap.appendChild(depthLabel);

  const slider = document.createElement("input");
  slider.id = "depth-slider";
  slider.type = "range";
  slider.min = "1";
  slider.max = "10";
  slider.value = String(sessionDepth);
  slider.className = "depth-slider";
  slider.title = `Lineage depth: ${sessionDepth}`;
  slider.addEventListener("input", () => {
    const d = Number(slider.value);
    depthLabel.textContent = `Depth: ${d}`;
    slider.title = `Lineage depth: ${d}`;
  });
  slider.addEventListener("change", () => {
    const d = Number(slider.value);
    sessionDepth = d;
    vscode.postMessage({ type: "setDepth", depth: d });
  });
  depthWrap.appendChild(slider);
  bar.appendChild(depthWrap);

  return bar;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a canonical field key like "::orders.amount" or "ns::schema.field"
 * into a { schemaLabel, fieldLabel } pair for display.
 */
function parseFieldKey(key: string): { schemaLabel: string; fieldLabel: string } {
  // Strip leading ::
  const bare = key.startsWith("::") ? key.slice(2) : key;
  const dot = bare.lastIndexOf(".");
  if (dot === -1) {
    return { schemaLabel: "", fieldLabel: bare };
  }
  return {
    schemaLabel: bare.slice(0, dot),
    fieldLabel: bare.slice(dot + 1),
  };
}

/** Compact display label for a field key. */
function formatFieldKey(key: string): string {
  const { schemaLabel, fieldLabel } = parseFieldKey(key);
  return schemaLabel ? `${schemaLabel}.${fieldLabel}` : fieldLabel;
}

/**
 * Format a mapping key for display: strip <anon>@path: prefix down to
 * "<anon>:N" for anonymous mappings; strip leading :: from named ones.
 */
function formatMappingKey(key: string): string {
  if (key.includes("<anon>@")) {
    // "<anon>@/path/to/file.stm:5" → "<anon>:5"
    const colon = key.lastIndexOf(":");
    const line = colon !== -1 ? key.slice(colon + 1) : "?";
    return `<anon>:${line}`;
  }
  return key.startsWith("::") ? key.slice(2) : key;
}


// Minimal ELK type stubs for the @ts-nocheck context
interface ElkNode {
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkNode[];
  edges?: ElkEdge[];
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
}

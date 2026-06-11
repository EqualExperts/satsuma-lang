/**
 * schema-lineage.ts — Webview renderer for the Schema Lineage panel.
 *
 * Uses ELK.js (layered / RIGHT) to position schema and mapping pills,
 * then renders them as absolutely-positioned divs with an SVG overlay for edges.
 * Schema nodes: orange pills. Mapping nodes: charcoal pills.
 * Design tokens match @satsuma/viz (--sz-* palette).
 */

// @ts-nocheck — runs in webview context (no VS Code types available)

import ELK from "elkjs/lib/elk.bundled.js";

const vscode = acquireVsCodeApi();
const elk = new ELK();

// ── Layout constants ───────────────────────────────────────────────────────

const PILL_W = 180;
const PILL_H = 36;
const CANVAS_PADDING = 40;

// ── Type declarations ──────────────────────────────────────────────────────

interface LineageNode {
  name: string;
  type: "schema" | "mapping";
  file: string;
}

interface LineageEdge {
  src: string;
  tgt: string;
}

interface Payload {
  schema: string;
  direction: "from" | "to";
  nodes: LineageNode[];
  edges: LineageEdge[];
  isDark: boolean;
}

interface NodePos {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Entry point ────────────────────────────────────────────────────────────

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as { type: string; payload?: Payload; message?: string };
  if (msg.type === "schemaLineageData" && msg.payload) {
    render(msg.payload);
  } else if (msg.type === "error") {
    showError(msg.message ?? "Unknown error");
  }
});

// ── Render ─────────────────────────────────────────────────────────────────

async function render(payload: Payload): Promise<void> {
  const root = document.getElementById("schema-lineage-root")!;

  if (payload.isDark) {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }

  if (payload.nodes.length === 0) {
    root.innerHTML = "";
    root.appendChild(buildHeader(payload));
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = `No lineage found ${payload.direction} '${payload.schema}'.`;
    root.appendChild(empty);
    return;
  }

  // Build id → name map (ELK needs string IDs; use sanitised index-based IDs)
  const nodeIds = new Map<string, string>();
  payload.nodes.forEach((n, i) => nodeIds.set(n.name, `n${i}`));

  const elkChildren = payload.nodes.map((n, i) => ({
    id: `n${i}`,
    width: PILL_W,
    height: PILL_H,
  }));

  const elkEdges = payload.edges
    .filter((e) => nodeIds.has(e.src) && nodeIds.has(e.tgt))
    .map((e, i) => ({
      id: `e${i}`,
      sources: [nodeIds.get(e.src)!],
      targets: [nodeIds.get(e.tgt)!],
    }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.spacing.nodeNode": "16",
      "elk.padding": `[top=${CANVAS_PADDING},left=${CANVAS_PADDING},bottom=${CANVAS_PADDING},right=${CANVAS_PADDING}]`,
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: elkChildren,
    edges: elkEdges,
  };

  let laid: ElkNode;
  try {
    laid = await elk.layout(graph);
  } catch (e) {
    showError(`Layout failed: ${e}`);
    return;
  }

  const canvas = buildCanvas(laid, payload, nodeIds);

  root.innerHTML = "";
  root.appendChild(buildHeader(payload));
  root.appendChild(canvas);
}

function showError(message: string): void {
  const root = document.getElementById("schema-lineage-root")!;
  root.innerHTML = "";
  const div = document.createElement("div");
  div.className = "error-message";
  div.textContent = message;
  root.appendChild(div);
}

// ── Header ─────────────────────────────────────────────────────────────────

function buildHeader(payload: Payload): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "header-bar";

  const title = document.createElement("span");
  title.className = "header-title";
  title.textContent = `Lineage ${payload.direction} ${payload.schema}`;
  bar.appendChild(title);

  const legend = document.createElement("div");
  legend.className = "legend";
  for (const [cls, label] of [["schema", "schema"], ["mapping", "mapping"]] as const) {
    const pill = document.createElement("span");
    pill.className = `legend-pill ${cls}`;
    pill.textContent = label;
    legend.appendChild(pill);
  }
  bar.appendChild(legend);

  return bar;
}

// ── Canvas ─────────────────────────────────────────────────────────────────

function buildCanvas(
  laid: ElkNode,
  payload: Payload,
  nodeIds: Map<string, string>,
): HTMLDivElement {
  const w = laid.width ?? 800;
  const h = laid.height ?? 400;

  const wrap = document.createElement("div");
  wrap.className = "canvas-wrap";

  const canvas = document.createElement("div");
  canvas.className = "canvas";
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  // Build ELK id → position lookup
  const nodePos = new Map<string, NodePos>();
  for (const n of (laid.children ?? []) as ElkNode[]) {
    nodePos.set(n.id!, { x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? PILL_W, height: n.height ?? PILL_H });
  }

  // Reverse lookup: elk id → LineageNode
  const elkIdToNode = new Map<string, LineageNode>();
  payload.nodes.forEach((n, i) => elkIdToNode.set(`n${i}`, n));

  // Render pill nodes
  for (const [elkId, pos] of nodePos) {
    const node = elkIdToNode.get(elkId);
    if (!node) continue;
    const pill = buildPill(node);
    pill.style.position = "absolute";
    pill.style.left = `${pos.x}px`;
    pill.style.top = `${pos.y}px`;
    pill.style.width = `${pos.width}px`;
    canvas.appendChild(pill);
  }

  // SVG edges
  const svg = buildEdgeSvg(laid, payload, nodeIds, nodePos, w, h);
  canvas.insertBefore(svg, canvas.firstChild);

  wrap.appendChild(canvas);
  return wrap;
}

// ── Pill nodes ─────────────────────────────────────────────────────────────

function buildPill(node: LineageNode): HTMLDivElement {
  const pill = document.createElement("div");
  pill.className = `node-pill ${node.type}`;
  pill.title = node.name;
  pill.textContent = formatNodeLabel(node.name);

  pill.addEventListener("click", () => {
    vscode.postMessage({ type: "navigate", uri: node.file, line: 0 });
  });

  return pill;
}

function formatNodeLabel(name: string): string {
  // Shorten "ns::schema" → "schema", keep mapping names as-is but truncate long ones
  const bare = name.includes("::") ? name.split("::").pop()! : name;
  return bare.length > 24 ? bare.slice(0, 22) + "…" : bare;
}

// ── SVG edges ──────────────────────────────────────────────────────────────

function buildEdgeSvg(
  laid: ElkNode,
  payload: Payload,
  nodeIds: Map<string, string>,
  nodePos: Map<string, NodePos>,
  w: number,
  h: number,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "edge-overlay");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.appendChild(buildArrowMarker());
  svg.appendChild(defs);

  for (const edge of payload.edges) {
    const srcId = nodeIds.get(edge.src);
    const tgtId = nodeIds.get(edge.tgt);
    if (!srcId || !tgtId) continue;
    const src = nodePos.get(srcId);
    const tgt = nodePos.get(tgtId);
    if (!src || !tgt) continue;
    svg.appendChild(buildBezierEdge(src, tgt));
  }

  return svg;
}

function buildBezierEdge(src: NodePos, tgt: NodePos): SVGPathElement {
  const x1 = src.x + src.width;
  const y1 = src.y + src.height / 2;
  const x2 = tgt.x;
  const y2 = tgt.y + tgt.height / 2;

  const cp = Math.abs(x2 - x1) * 0.5;
  const d = `M ${x1},${y1} C ${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`;

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("class", "edge");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("marker-end", "url(#arrow)");

  return path;
}

function buildArrowMarker(): SVGMarkerElement {
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "7");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto");

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", "0 0, 8 3, 0 6");
  poly.setAttribute("class", "arrowhead");
  marker.appendChild(poly);

  return marker;
}

// ── Helpers ────────────────────────────────────────────────────────────────


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

/**
 * Webview-side lineage rendering for Satsuma field-level lineage.
 * Renders a horizontal chain of field nodes connected by arrow edges.
 */

// @ts-nocheck — runs in webview context

import { isExtensionHostMessage } from "../message-guard";

const vscode = acquireVsCodeApi();

interface ArrowEntry {
  source: string;
  target: string;
  classification: string;
  transform: string;
  file: string;
  line: number;
}

window.addEventListener("message", (event) => {
  if (!isExtensionHostMessage(event, window.parent)) return;
  const msg = event.data;
  if (msg.type === "lineageData") {
    render(msg.payload);
  }
});

function render(arrows: ArrowEntry[]): void {
  const container = document.getElementById("lineage")!;
  container.innerHTML = "";

  if (arrows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-message";
    empty.textContent = "No lineage found for this field.";
    container.appendChild(empty);
    return;
  }

  // Build ordered chain from arrows
  const chain = buildChain(arrows);

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]!;

    // Source node (only for the first step)
    if (i === 0) {
      container.appendChild(createFieldNode(step.source, step.file, step.line));
    }

    // Arrow with transform label
    container.appendChild(createArrow(step.transform, step.classification));

    // Target node
    container.appendChild(createFieldNode(step.target, step.file, step.line));
  }
}

function buildChain(arrows: ArrowEntry[]): ArrowEntry[] {
  if (arrows.length === 0) return [];

  // Simple ordering: follow source → target chain
  const bySource = new Map<string, ArrowEntry>();
  const allTargets = new Set<string>();

  for (const a of arrows) {
    bySource.set(a.source, a);
    allTargets.add(a.target);
  }

  // Find the root (a source that's not any target)
  let start: ArrowEntry | undefined;
  for (const a of arrows) {
    if (!allTargets.has(a.source)) {
      start = a;
      break;
    }
  }
  if (!start) start = arrows[0];

  // Follow the chain
  const chain: ArrowEntry[] = [];
  const visited = new Set<string>();
  let current: ArrowEntry | undefined = start;

  while (current && !visited.has(current.source)) {
    visited.add(current.source);
    chain.push(current);
    current = bySource.get(current.target);
  }

  // Add any remaining arrows not in the chain
  for (const a of arrows) {
    if (!visited.has(a.source)) {
      chain.push(a);
    }
  }

  return chain;
}

function createFieldNode(fieldPath: string, file: string, line: number): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "field-node";

  const parts = fieldPath.split(".");
  const schema = parts.length > 1 ? parts.slice(0, -1).join(".") : "";
  const field = parts[parts.length - 1] ?? fieldPath;

  if (schema) {
    const schemaEl = document.createElement("span");
    schemaEl.className = "schema";
    schemaEl.textContent = schema;
    div.appendChild(schemaEl);
  }

  const nameEl = document.createElement("span");
  nameEl.className = "name";
  nameEl.textContent = field;
  div.appendChild(nameEl);

  div.addEventListener("click", () => {
    vscode.postMessage({ type: "navigate", uri: file, line: Math.max(0, line - 1) });
  });

  return div;
}

function createArrow(transform: string, classification: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "arrow";

  const line = document.createElement("div");
  line.className = "arrow-line";
  div.appendChild(line);

  if (transform) {
    const label = document.createElement("div");
    // After Feature 28, all transforms are NL — always apply the nl class
    label.className = "arrow-label nl";
    label.textContent = transform.length > 30 ? transform.slice(0, 28) + "…" : transform;
    label.title = transform;
    div.appendChild(label);
  }

  return div;
}

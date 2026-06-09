/**
 * app.ts — browser-side harness application.
 *
 * Loads fixture metadata from the server, renders syntax-highlighted source
 * text and the satsuma-viz web component side-by-side, and records all
 * interaction events in window.__satsumaHarness for Playwright assertions.
 *
 * The viz component (satsuma-viz.js) is loaded as a separate <script type="module">
 * in index.html, so this module does not import it directly.  It interacts
 * with the custom element by tag name once the element is defined.
 *
 * Automation contract (exposed on window.__satsumaHarness):
 *   fixture     — currently loaded fixture URI, or null
 *   viewMode    — "lineage" | "single"
 *   theme       — "light" | "dark", the active chrome + component theme
 *   events      — array of recorded interaction events
 *   ready       — true once the viz has reached the "ready" state
 *   clearEvents — helper to reset the event log between assertions
 *
 * URL parameters for headless use (e.g. Playwright tests):
 *   ?fixture=<encoded-uri>   — auto-selects a fixture on load
 *   ?mode=lineage|single     — overrides the default view mode
 *   ?theme=light|dark        — forces the theme (deterministic for Playwright);
 *                              otherwise prefers-color-scheme decides, then dark
 *
 * Theme changes (via the header toggle) append a `theme-change` event to the
 * event log so Playwright can assert the switch was observed.
 */

import { ensureParserReady, buildModel } from "./model-pipeline";
import type { SourceDocument, VizModel } from "./model-pipeline";
import { highlightSatsuma } from "./highlight";
import { SatsumaEditor } from "./editor";

// ---------- Types ----------

interface Fixture {
  name: string;
  path: string;
  uri: string;
}

/** Source location payload emitted when the viz asks an editor to navigate. */
interface HarnessSourceLocation {
  uri: string;
  line: number;
  character: number;
}

/** Stable field identity used by hover and lineage interactions. */
interface HarnessFieldPayload {
  schemaId: string;
  fieldName: string | null;
}

/** Stable mapping identity recorded when the overview asks to open detail. */
interface HarnessMappingPayload {
  id: string;
  sourceRefs: string[];
  targetRef: string;
}

/** SVG export payload emitted from the viz toolbar. */
interface HarnessExportPayload {
  format: string;
  content: string;
}

/**
 * A recorded interaction event emitted by the viz component.
 * Playwright tests assert against this log to verify that specific user
 * interactions (navigate, expand-lineage, field-lineage) are observable.
 */
interface HarnessEvent {
  type: string;
  detail: unknown;
  timestamp: number;
}

/**
 * The automation API exposed on window.__satsumaHarness.
 * All Playwright tests assert against this object rather than VS Code APIs.
 */
/** The two renderer themes the harness and component support. */
type HarnessTheme = "light" | "dark";

/**
 * Whether the visualization on screen reflects the current editor buffer.
 *   "ok"    — the viz was built from the current buffer.
 *   "stale" — the current buffer failed to produce a model, so a previously
 *             good visualization is being retained (the canvas is never blanked).
 */
type ParseStatus = "ok" | "stale";

export interface SatsumaHarness {
  fixture: string | null;
  viewMode: "lineage" | "single";
  /** Active theme applied to both the chrome (body[data-theme]) and the viz component. */
  theme: HarnessTheme;
  /** Relationship between the displayed viz and the live buffer; see ParseStatus. */
  parseStatus: ParseStatus;
  events: HarnessEvent[];
  ready: boolean;
  clearEvents(): void;
}

declare global {
  interface Window {
    __satsumaHarness: SatsumaHarness;
  }
}

// ---------- Harness state ----------

const harness: SatsumaHarness = {
  fixture: null,
  viewMode: "lineage",
  theme: "dark",
  parseStatus: "ok",
  events: [],
  ready: false,
  clearEvents() { this.events = []; },
};

window.__satsumaHarness = harness;

// ---------- Document set (client-side model source) ----------
//
// The client builds the VizModel itself now (feature 33) instead of fetching
// /api/model: it holds every fixture's source text in memory and feeds the
// whole set to buildModel so cross-file `import`s resolve in-browser. This map
// is the single source of truth for both highlighting and model-building, and
// is the seam the localStorage document library (sl-kd45) later plugs into.
const documentSources = new Map<string, string>();

/** Snapshot the document set in the { uri, source } shape buildModel expects. */
function currentDocuments(): SourceDocument[] {
  return [...documentSources.entries()].map(([uri, source]) => ({ uri, source }));
}

// ---------- DOM references ----------

/**
 * Retrieve a required DOM element by id.
 * Throws a clear error if the element is absent — this indicates a mismatch
 * between index.html and app.ts rather than a recoverable runtime condition.
 */
function getRequired(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[harness] required element #${id} not found`);
  return el;
}

const fixtureListEl     = getRequired("fixture-list");
const fixturePickerBtn  = getRequired("fixture-picker-btn");
const fixturePickerName = getRequired("fixture-picker-name");
const fixtureDropdown   = getRequired("fixture-picker-dropdown");
const sourceEditorHost  = getRequired("source-editor");
const parseStatusEl     = getRequired("parse-status");
const parseStatusDismiss = getRequired("parse-status-dismiss");
const vizContainer      = getRequired("viz-container");
const readyBadge        = getRequired("harness-ready-badge");
const viewModeToggle    = getRequired("view-mode-toggle");
const themeToggle       = getRequired("theme-toggle");

// ---------- Editor ----------
//
// The overlay editor owns the left pane. Its buffer is the single source of
// truth for both highlighting (done inside the widget via highlightSatsuma) and
// the model pipeline: every user edit updates the current document in
// documentSources and triggers a debounced re-render (see handleEdit).
const editor = new SatsumaEditor(sourceEditorHost, {
  highlight: highlightSatsuma,
  onInput: handleEdit,
});

// ---------- Viz element management ----------

/**
 * The <satsuma-viz> element currently mounted in the viz container.
 * Re-used across fixture loads so the component preserves its own internal
 * state (zoom, pan) where possible.
 */
let vizEl: HTMLElement | null = null;

/** Mirror of the viz element's data-ready-state attribute. */
let vizReadyState = "empty";

// ---------- Event normalization ----------

/**
 * Return true when a value can be inspected as a plain object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Read a nested CustomEvent.detail object only when the event is still using
 * the older synthetic contract. Production viz events store payload fields on
 * the Event instance itself.
 */
function customEventDetail(event: Event): unknown {
  return "detail" in event ? (event as CustomEvent<unknown>).detail : undefined;
}

/**
 * Normalize a source-location-like value into the JSON shape Playwright tests
 * assert against.
 */
function normalizeLocation(value: unknown): HarnessSourceLocation | null {
  if (!isRecord(value)) return null;
  const uri = value["uri"];
  const line = value["line"];
  const character = value["character"];
  if (typeof uri !== "string" || typeof line !== "number" || typeof character !== "number") {
    return null;
  }
  return { uri, line, character };
}

/**
 * Normalize navigate events from production SzNavigateEvent.location while
 * preserving detail compatibility for narrow recorder-level tests.
 */
function normalizeNavigateEvent(event: Event): HarnessSourceLocation | null {
  if ("location" in event) {
    return normalizeLocation((event as Event & { location?: unknown }).location);
  }
  const detail = customEventDetail(event);
  if (isRecord(detail) && "location" in detail) return normalizeLocation(detail["location"]);
  return normalizeLocation(detail);
}

/**
 * Normalize field identity from production event properties first, then from
 * CustomEvent.detail for compatibility with legacy synthetic recorder tests.
 */
function normalizeFieldEvent(event: Event): HarnessFieldPayload | null {
  const source = ("schemaId" in event || "fieldName" in event)
    ? event as Event & { schemaId?: unknown; fieldName?: unknown }
    : customEventDetail(event);
  if (!isRecord(source)) return null;
  const schemaId = source["schemaId"];
  const fieldName = source["fieldName"];
  if (typeof schemaId !== "string") return null;
  if (fieldName !== null && typeof fieldName !== "string") return null;
  return { schemaId, fieldName };
}

/**
 * Normalize mapping identity from production SzOpenMappingEvent.mapping, with
 * detail compatibility for any remaining synthetic recorder checks.
 */
function normalizeOpenMappingEvent(event: Event): HarnessMappingPayload | null {
  const detail = customEventDetail(event);
  const source = "mapping" in event
    ? (event as Event & { mapping?: unknown }).mapping
    : isRecord(detail) && "mapping" in detail
      ? detail["mapping"]
      : detail;
  if (!isRecord(source)) return null;
  const id = source["id"];
  const sourceRefs = source["sourceRefs"];
  const targetRef = source["targetRef"];
  if (typeof id !== "string" || !Array.isArray(sourceRefs) || typeof targetRef !== "string") {
    return null;
  }
  const normalizedSourceRefs = sourceRefs.filter((value): value is string => typeof value === "string");
  if (normalizedSourceRefs.length !== sourceRefs.length) return null;
  return { id, sourceRefs: normalizedSourceRefs, targetRef };
}

/**
 * Normalize expand-lineage events from production SzExpandLineageEvent.schemaId
 * while preserving the legacy detail object shape.
 */
function normalizeExpandLineageEvent(event: Event): { schemaId: string } | null {
  const source = "schemaId" in event
    ? event as Event & { schemaId?: unknown }
    : customEventDetail(event);
  if (!isRecord(source)) return null;
  const schemaId = source["schemaId"];
  return typeof schemaId === "string" ? { schemaId } : null;
}

/**
 * Normalize SVG export CustomEvent.detail. Export intentionally remains a
 * CustomEvent because the payload is generated inside the viz toolbar handler.
 */
function normalizeExportEvent(event: Event): HarnessExportPayload | null {
  const detail = customEventDetail(event);
  if (!isRecord(detail)) return null;
  const format = detail["format"];
  const content = detail["content"];
  if (typeof format !== "string" || typeof content !== "string") return null;
  return { format, content };
}

/**
 * Record a viz interaction event in the harness log.
 * Called from the event handlers attached to the viz element.
 */
function recordEvent(type: string, detail: unknown): void {
  harness.events.push({ type, detail, timestamp: Date.now() });
}

/**
 * Record the normalized JSON payload expected by Playwright assertions.
 * A null payload is retained when an event shape is invalid so test failures
 * expose the recorder mismatch instead of silently dropping the interaction.
 */
function recordNormalizedEvent(type: string, event: Event, normalize: (event: Event) => unknown): unknown {
  const detail = normalize(event);
  recordEvent(type, detail);
  return detail;
}

/**
 * Update the badge and harness.ready flag to reflect the current viz state.
 */
function updateReadyBadge(state: string): void {
  vizReadyState = state;
  harness.ready = state === "ready";
  readyBadge.textContent = state;
  readyBadge.className = state === "ready" ? "ready" : "";
}

/**
 * Ensure a <satsuma-viz> element is mounted, attaching event listeners once.
 * Returns the element so the caller can set its model property.
 */
function ensureVizElement(): HTMLElement {
  if (vizEl) return vizEl;

  const el = document.createElement("satsuma-viz");
  // Enable test-mode to suppress animations and make the harness deterministic
  // under automation.  The satsuma-viz component uses this to skip CSS transitions
  // and emit layout-complete signals synchronously.
  el.setAttribute("test-mode", "");
  // Mount with the currently-resolved theme so the component palette matches the
  // chrome from the first paint (the component defaults to light otherwise).
  el.setAttribute("theme", harness.theme);

  // Monitor ready-state changes via MutationObserver so Playwright can wait
  // for `data-ready-state="ready"` on the root element.
  const observer = new MutationObserver(() => {
    const state = (el as HTMLElement).dataset["readyState"] ?? "empty";
    if (state !== vizReadyState) updateReadyBadge(state);
  });
  observer.observe(el, { attributes: true, attributeFilter: ["data-ready-state"] });

  // Record all interaction events for Playwright assertion.
  el.addEventListener("navigate", (e) => {
    recordNormalizedEvent("navigate", e, normalizeNavigateEvent);
  });
  el.addEventListener("field-hover", (e) => {
    recordNormalizedEvent("field-hover", e, normalizeFieldEvent);
  });
  el.addEventListener("expand-lineage", (e) => {
    const detail = recordNormalizedEvent("expand-lineage", e, normalizeExpandLineageEvent);
    // When the user requests lineage expansion from within the viz, switch to
    // the lineage view for the current fixture so the full cross-file model loads.
    if (detail && harness.fixture && harness.viewMode !== "lineage") {
      setViewMode("lineage");
    } else if (detail && harness.fixture) {
      void loadFixture(harness.fixture);
    }
  });
  el.addEventListener("field-lineage", (e) => {
    recordNormalizedEvent("field-lineage", e, normalizeFieldEvent);
  });
  el.addEventListener("open-mapping", (e) => {
    recordNormalizedEvent("open-mapping", e, normalizeOpenMappingEvent);
  });
  el.addEventListener("export", (e) => {
    recordNormalizedEvent("export", e, normalizeExportEvent);
  });

  // Clear the placeholder and mount the element.
  const placeholder = document.getElementById("viz-placeholder");
  if (placeholder) placeholder.remove();
  vizContainer.appendChild(el);
  vizEl = el;
  return el;
}

// ---------- Live editing ----------
//
// The editor buffer is the single source of truth. A user edit (a) replaces the
// current document's source in documentSources so cross-file lineage sees the
// edit, and (b) schedules a debounced model rebuild. Highlighting is repainted
// synchronously inside the editor widget on every keystroke; only the heavier
// model build is deferred, so the colours never lag the caret.

// Idle gap (ms) after the last keystroke before the model is rebuilt. Long
// enough to coalesce a burst of typing, short enough to feel live. The PRD calls
// for ~150–300 ms; 200 ms sits in the middle.
const RERENDER_DEBOUNCE_MS = 200;

/** Pending debounced rebuild, if any. */
let rerenderTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Handle a user edit to the source buffer. Updates the in-memory document for the
 * active fixture and debounces a model rebuild. No-op when no document is loaded.
 */
function handleEdit(value: string): void {
  if (!harness.fixture) return;
  documentSources.set(harness.fixture, value);

  if (rerenderTimer !== undefined) clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    rerenderTimer = undefined;
    if (harness.fixture) renderModel(harness.fixture);
  }, RERENDER_DEBOUNCE_MS);
}

// ---------- Fixture loading ----------

/**
 * Load the document at `uri` into the editor and render its VizModel.
 *
 * The source comes from the in-memory document set and the model is built
 * in-browser via buildModel — no /api/model call. Loading a document is not a
 * user edit, so it replaces the buffer via the editor's programmatic setValue
 * (which does not fire handleEdit) and renders immediately rather than on the
 * debounce. The current viewMode decides single-file vs full cross-file lineage.
 */
function loadFixture(uri: string): void {
  harness.fixture = uri;
  harness.ready = false;
  updateReadyBadge("loading");

  const source = documentSources.get(uri);
  if (source === undefined) {
    editor.setValue("// Failed to load fixture.");
    updateReadyBadge("empty");
    return;
  }

  editor.setValue(source);
  renderModel(uri);
}

/**
 * The last VizModel that rendered successfully. Retained so a mid-edit buffer
 * that parses to nothing can keep the previous good visualization on screen
 * instead of blanking the canvas (feature 33 §2 "resilient rendering").
 */
let lastGoodModel: VizModel | null = null;

/** True when a model carries no renderable content (note blocks or namespaces). */
function isEmptyModel(model: VizModel): boolean {
  return model.namespaces.length === 0 && model.fileNotes.length === 0;
}

/**
 * Build the VizModel for `entryUri` from the current document set and hand it to
 * the viz component. Synchronous — the WASM parser must already be initialised
 * (ensureParserReady is awaited once at startup).
 *
 * Resilient by design: if the buffer parses to an empty model (mid-edit or
 * invalid syntax) and a previous good model exists, the previous viz is kept and
 * a parse-status indicator is shown rather than clearing the canvas.
 */
function renderModel(entryUri: string): void {
  const lineage = harness.viewMode === "lineage";
  const model = buildModel(entryUri, currentDocuments(), { lineage });

  // An empty model from an edit means the buffer is mid-edit or invalid. Keep
  // the last good viz if we have one; only an empty *initial* load (nothing
  // better to show) falls through to render the empty model.
  if (isEmptyModel(model) && lastGoodModel) {
    setParseStatus("stale");
    return;
  }

  setParseStatus("ok");
  lastGoodModel = model;
  const viz = ensureVizElement();
  (viz as unknown as { model: unknown }).model = model;
}

// ---------- Parse-status indicator ----------

/**
 * Reflect the relationship between the displayed viz and the live buffer in both
 * the harness state and the on-screen indicator. "stale" reveals the indicator
 * (the viz is from a previous good buffer); "ok" hides it. The indicator is also
 * dismissable by the user (see the dismiss handler), but a later stale edit
 * re-reveals it.
 */
function setParseStatus(status: ParseStatus): void {
  harness.parseStatus = status;
  parseStatusEl.classList.toggle("hidden", status === "ok");
}

// Let the user dismiss the indicator without clearing the underlying state: the
// viz is still stale, we just stop nagging until the next stale edit re-shows it.
parseStatusDismiss.addEventListener("click", () => {
  parseStatusEl.classList.add("hidden");
});

// ---------- Fixture picker (dropdown) ----------

/** Whether the fixture dropdown is currently open. */
let pickerOpen = false;

/**
 * Toggle the fixture picker dropdown open/closed.
 */
function togglePicker(open?: boolean): void {
  pickerOpen = open !== undefined ? open : !pickerOpen;
  fixtureDropdown.classList.toggle("hidden", !pickerOpen);
}

fixturePickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePicker();
});

// Close the dropdown when the user clicks anywhere else.
document.addEventListener("click", () => {
  if (pickerOpen) togglePicker(false);
});

/**
 * Render the fixture list inside the picker dropdown.
 * All fixture items are always present in the DOM so that URL-param
 * auto-selection (?fixture=<uri>) can find them by data-uri attribute.
 */
function renderFixtureList(fixtures: Fixture[]): void {
  fixtureListEl.innerHTML = "";
  for (const fixture of fixtures) {
    const btn = document.createElement("button");
    btn.className = "fixture-item";
    btn.textContent = fixture.name;
    btn.dataset["uri"] = fixture.uri;
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // prevent document click from immediately closing
      selectFixture(fixture.uri, btn);
      togglePicker(false);
    });
    fixtureListEl.appendChild(btn);
  }
}

/**
 * Mark a fixture item as selected, update the picker button label, and load
 * the source and model data.
 */
function selectFixture(uri: string, btn: HTMLButtonElement): void {
  for (const el of fixtureListEl.querySelectorAll(".fixture-item")) {
    el.classList.remove("selected");
  }
  btn.classList.add("selected");
  // Show a short name (last path segment) in the compact picker button.
  const shortName = btn.textContent ?? uri;
  fixturePickerName.textContent = shortName;
  fixturePickerName.title = shortName;
  void loadFixture(uri);
}

// ---------- View mode toggle ----------

/**
 * Switch between "lineage" (full transitive import merge) and "single"
 * (current file only) view modes, then reload the current fixture.
 */
function setViewMode(mode: "lineage" | "single"): void {
  harness.viewMode = mode;
  for (const btn of viewModeToggle.querySelectorAll<HTMLButtonElement>(".toggle-btn")) {
    btn.classList.toggle("active", btn.dataset["mode"] === mode);
  }
  if (harness.fixture) void loadFixture(harness.fixture);
}

viewModeToggle.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".toggle-btn");
  if (!btn) return;
  const mode = btn.dataset["mode"] as "lineage" | "single" | undefined;
  if (mode && mode !== harness.viewMode) setViewMode(mode);
});

// ---------- Theme management ----------

/**
 * Resolve the initial theme deterministically.
 * Order (per Feature 32): `?theme=` URL parameter → `prefers-color-scheme`
 * media query → dark (the historical harness default).  The URL parameter
 * makes Playwright runs deterministic regardless of the runner's OS setting.
 */
function resolveInitialTheme(): HarnessTheme {
  const param = new URLSearchParams(window.location.search).get("theme");
  if (param === "light" || param === "dark") return param;
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

/**
 * Apply a theme to both the chrome and the viz component so they never diverge.
 * Sets `data-theme` on <body> (drives the chrome CSS variable overrides) and the
 * `theme` attribute on <satsuma-viz> (drives the component's tokens.css palette),
 * and updates the toggle's active button.
 *
 * @param record  When true, append a `theme-change` automation event. The
 *                initial resolution passes false so the log starts clean; user
 *                toggles pass true so Playwright can assert the switch occurred.
 */
function applyTheme(theme: HarnessTheme, record: boolean): void {
  harness.theme = theme;
  document.body.dataset["theme"] = theme;
  if (vizEl) vizEl.setAttribute("theme", theme);
  for (const btn of themeToggle.querySelectorAll<HTMLButtonElement>(".toggle-btn")) {
    btn.classList.toggle("active", btn.dataset["theme"] === theme);
  }
  if (record) recordEvent("theme-change", { theme });
}

themeToggle.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".toggle-btn");
  if (!btn) return;
  const theme = btn.dataset["theme"] as HarnessTheme | undefined;
  if (theme && theme !== harness.theme) applyTheme(theme, true);
});

// Resolve and apply the theme synchronously at module load so the chrome paints
// in the correct palette before the fixture list and viz mount.
applyTheme(resolveInitialTheme(), false);

// ---------- Startup ----------

/**
 * Fetch the fixture list from the server and populate the picker dropdown.
 * Auto-selects the first fixture (or a fixture specified via URL params) so
 * the harness is in a useful state on load, which also satisfies the requirement
 * that Playwright tests can wait for a ready state without a manual fixture
 * selection step.
 */
async function init(): Promise<void> {
  // Read URL parameters set by headless callers (e.g. /api/screenshot).
  const params = new URLSearchParams(window.location.search);
  const autoFixtureUri = params.get("fixture");
  const autoMode = params.get("mode");
  if (autoMode === "lineage" || autoMode === "single") harness.viewMode = autoMode;

  // Initialise the in-browser WASM parser before any model is built.
  await ensureParserReady();

  const res = await fetch("/api/fixtures");
  if (!res.ok) {
    fixtureListEl.textContent = "Failed to load fixtures.";
    return;
  }
  const fixtures = (await res.json()) as Fixture[];

  // Pull every fixture's source into the in-memory document set so the client
  // can build single-file and cross-file-lineage models without a model API.
  await Promise.all(
    fixtures.map(async (f) => {
      const sourceRes = await fetch(`/api/source?uri=${encodeURIComponent(f.uri)}`);
      if (sourceRes.ok) {
        const { source } = (await sourceRes.json()) as { source: string };
        documentSources.set(f.uri, source);
      }
    }),
  );

  renderFixtureList(fixtures);

  // If a fixture was specified via URL param, select it; otherwise select the first.
  if (autoFixtureUri) {
    for (const btn of fixtureListEl.querySelectorAll<HTMLButtonElement>(".fixture-item")) {
      if (btn.dataset["uri"] === autoFixtureUri) {
        selectFixture(autoFixtureUri, btn);
        return;
      }
    }
  }

  // Default: pre-select the first fixture so the page is immediately useful.
  if (fixtures.length > 0) {
    const first = fixtures[0];
    const firstBtn = fixtureListEl.querySelector<HTMLButtonElement>(".fixture-item");
    if (first && firstBtn) selectFixture(first.uri, firstBtn);
  }
}

void init();

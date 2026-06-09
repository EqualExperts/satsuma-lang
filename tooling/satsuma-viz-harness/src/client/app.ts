/**
 * app.ts — browser-side harness application.
 *
 * Seeds the localStorage document library from the bundled examples manifest,
 * renders the editable, syntax-highlighted source pane and the satsuma-viz web
 * component side-by-side, and records all interaction events in
 * window.__satsumaHarness for Playwright assertions.
 *
 * The viz component (satsuma-viz.js) is loaded as a separate <script type="module">
 * in index.html, so this module does not import it directly.  It interacts
 * with the custom element by tag name once the element is defined.
 *
 * Automation contract (exposed on window.__satsumaHarness):
 *   fixture            — URI of the active library document, or null
 *   viewMode           — "lineage" | "single"
 *   theme              — "light" | "dark", the active chrome + component theme
 *   parseStatus        — "ok" | "stale"; see ParseStatus
 *   editorCollapsed    — true while the source pane is collapsed to its rail
 *   unresolvedImports  — import paths in the active buffer's graph that resolve
 *                        to no library document (rendered as a visible note)
 *   events             — array of recorded interaction events
 *   ready              — true once the viz has reached the "ready" state
 *   clearEvents        — helper to reset the event log between assertions
 *
 * URL parameters for headless use (e.g. Playwright tests):
 *   ?fixture=<encoded-uri>   — auto-selects a library document on load; URIs
 *                              are virtual (file:///examples/<path>), so they
 *                              are deterministic across machines
 *   ?mode=lineage|single     — overrides the stored/default view mode
 *   ?theme=light|dark        — forces the theme (deterministic for Playwright);
 *                              otherwise prefers-color-scheme decides, then dark
 *
 * Theme changes (via the header toggle) append a `theme-change` event to the
 * event log so Playwright can assert the switch was observed. The collapse
 * toggle, Open…, and Save actions likewise append `editor-collapse`,
 * `file-open`, and `file-save` events.
 */

import { ensureParserReady, buildModel } from "./model-pipeline";
import type { VizModel } from "./model-pipeline";
import { highlightSatsuma } from "./highlight";
import { SatsumaEditor } from "./editor";
import { DocumentLibrary, STARTER_SOURCE } from "./library";
import type { ExamplesManifest, LibraryDocument } from "./library";

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
export interface HarnessEvent {
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
  /** True while the source pane is collapsed to its re-expand rail (sl-1qte). */
  editorCollapsed: boolean;
  /**
   * Import paths in the active buffer's graph that resolve to no library
   * document. Non-empty means the model on screen was built without those
   * files; the UI mirrors this as a visible note (feature 33 §5).
   */
  unresolvedImports: string[];
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
  editorCollapsed: false,
  unresolvedImports: [],
  events: [],
  ready: false,
  clearEvents() { this.events = []; },
};

window.__satsumaHarness = harness;

// ---------- Document library (client-side model source + persistence) ----------
//
// The localStorage document library (sl-kd45) is the single source of truth for
// every document: it doubles as the picker's example browser AND the in-browser
// workspace. buildModel is fed the whole library, so cross-file `import`s
// between library documents resolve with no server, and an edit to one document
// updates lineage everywhere it is imported. The library also persists the
// session (active document, buffer, view-mode) so a reload restores the editor.
const library = new DocumentLibrary({
  storage: window.localStorage,
  onPersistError: showStorageWarning,
});

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

const layoutEl          = getRequired("layout");
const fixtureListEl     = getRequired("fixture-list");
const fixturePickerBtn  = getRequired("fixture-picker-btn");
const fixturePickerName = getRequired("fixture-picker-name");
const fixtureDropdown   = getRequired("fixture-picker-dropdown");
const libraryNewBtn     = getRequired("library-new-btn");
const libraryResetBtn   = getRequired("library-reset-btn");
const sourceEditorHost  = getRequired("source-editor");
const parseStatusEl     = getRequired("parse-status");
const parseStatusDismiss = getRequired("parse-status-dismiss");
const unresolvedNoteEl  = getRequired("unresolved-imports");
const storageWarningEl  = getRequired("storage-warning");
const storageWarningDismiss = getRequired("storage-warning-dismiss");
const fileOpenBtn       = getRequired("file-open-btn");
const fileOpenInput     = getRequired("file-open-input") as HTMLInputElement;
const fileSaveBtn       = getRequired("file-save-btn");
const editorCollapseBtn = getRequired("editor-collapse-btn");
const editorExpandRail  = getRequired("editor-expand-rail");
const vizContainer      = getRequired("viz-container");
const readyBadge        = getRequired("harness-ready-badge");
const viewModeToggle    = getRequired("view-mode-toggle");
const themeToggle       = getRequired("theme-toggle");

// ---------- Storage warning ----------

/**
 * Reveal the non-blocking storage warning (quota or privacy-mode write
 * failure). The library keeps working from memory; this only informs the user
 * that edits will not survive a reload. Dismissable; re-shown on the next
 * failed write batch.
 */
function showStorageWarning(): void {
  storageWarningEl.classList.remove("hidden");
}

storageWarningDismiss.addEventListener("click", () => {
  storageWarningEl.classList.add("hidden");
});

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
      loadDocument(harness.fixture);
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
// The editor buffer is the single source of truth. A user edit (a) persists the
// raw buffer immediately (one small write, so a mid-debounce tab close loses
// nothing), and (b) schedules a debounced update of the library entry — which
// is what cross-file lineage reads — plus a model rebuild. Highlighting is
// repainted synchronously inside the editor widget on every keystroke; only the
// heavier persistence + model build is deferred, so the colours never lag the
// caret.

// Idle gap (ms) after the last keystroke before the model is rebuilt. Long
// enough to coalesce a burst of typing, short enough to feel live. The PRD calls
// for ~150–300 ms; 200 ms sits in the middle.
const RERENDER_DEBOUNCE_MS = 200;

/** Pending debounced rebuild, if any. */
let rerenderTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Handle a user edit to the source buffer. Persists the buffer, then debounces
 * the library-entry update and model rebuild. No-op when no document is loaded.
 */
function handleEdit(value: string): void {
  if (!harness.fixture) return;
  library.setBuffer(value);

  if (rerenderTimer !== undefined) clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    rerenderTimer = undefined;
    if (!harness.fixture) return;
    // Updating the library entry (not just the buffer) is what makes the edit
    // visible to every other document that imports this one (live lineage),
    // and what flips the built-in's edited flag for re-seed protection.
    library.updateSource(harness.fixture, value);
    renderLibraryList(); // the row may have just gained its edited marker
    renderModel(harness.fixture);
  }, RERENDER_DEBOUNCE_MS);
}

// ---------- Document loading ----------

/**
 * Load the library document at `uri` into the editor and render its VizModel.
 *
 * The source comes from the document library and the model is built in-browser
 * via buildModel — no network call. Loading a document is not a user edit, so
 * it replaces the buffer via the editor's programmatic setValue (which does not
 * fire handleEdit) and renders immediately rather than on the debounce. The
 * current viewMode decides single-file vs full cross-file lineage.
 */
function loadDocument(uri: string): void {
  harness.fixture = uri;
  harness.ready = false;
  library.setActiveUri(uri);
  updateReadyBadge("loading");

  const doc = library.get(uri);
  if (doc === undefined) {
    editor.setValue("// Failed to load document.");
    updateReadyBadge("empty");
    return;
  }

  editor.setValue(doc.source);
  library.setBuffer(doc.source);
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
  const { model, unresolvedImports } = buildModel(entryUri, library.documents(), { lineage });
  setUnresolvedImports(unresolvedImports);

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

// ---------- Unresolved-import note ----------

/**
 * Mirror the unresolved-import diagnostics into the harness state and the
 * on-page note. A buffer importing a path that is not in the library renders
 * without that file — the note names each missing path so the user knows why
 * edges are absent (v1 never fetches external paths; feature 33 §5).
 */
function setUnresolvedImports(paths: string[]): void {
  harness.unresolvedImports = paths;
  unresolvedNoteEl.classList.toggle("hidden", paths.length === 0);
  if (paths.length > 0) {
    unresolvedNoteEl.textContent = `⚠ not in library: ${paths.join(", ")}`;
    unresolvedNoteEl.title =
      "These imported files are not in the document library, so they are not rendered.";
  }
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
 * Render the document library inside the picker dropdown: built-in examples
 * first, then (when any exist) the user's own documents under a separate
 * heading, so Reset/Restore semantics stay visually unambiguous. Edited
 * built-ins carry a marker and a per-document "Restore original" action.
 *
 * All items are always present in the DOM so that URL-param auto-selection
 * (?fixture=<uri>) can find them by data-uri attribute. Re-rendered after any
 * library mutation; the active document's row is re-marked selected.
 */
function renderLibraryList(): void {
  fixtureListEl.innerHTML = "";
  const docs = library.list();
  renderLibrarySection("Examples", docs.filter((d) => d.kind === "builtin"));
  const userDocs = docs.filter((d) => d.kind === "user");
  if (userDocs.length > 0) renderLibrarySection("Your documents", userDocs);
}

/** Render one picker section: a heading plus a row per document. */
function renderLibrarySection(heading: string, docs: LibraryDocument[]): void {
  if (docs.length === 0) return;
  const header = document.createElement("div");
  header.className = "fixture-section-header";
  header.textContent = heading;
  fixtureListEl.appendChild(header);

  for (const doc of docs) {
    fixtureListEl.appendChild(renderLibraryRow(doc));
  }
}

/**
 * Build the row for one library document: the select button (carrying the
 * data-uri automation hook) and, for an edited built-in, a restore action.
 */
function renderLibraryRow(doc: LibraryDocument): HTMLElement {
  const row = document.createElement("div");
  row.className = "fixture-row";

  const btn = document.createElement("button");
  btn.className = "fixture-item";
  btn.textContent = doc.name + (doc.edited ? " ●" : "");
  if (doc.edited) btn.title = "Edited — differs from the bundled original";
  btn.dataset["uri"] = doc.uri;
  if (doc.uri === harness.fixture) btn.classList.add("selected");
  btn.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent document click from immediately closing
    selectDocument(doc.uri);
    togglePicker(false);
  });
  row.appendChild(btn);

  // Restore original: only edited built-ins have anything to restore.
  if (doc.kind === "builtin" && doc.edited) {
    const restore = document.createElement("button");
    restore.className = "fixture-restore";
    restore.textContent = "↺";
    restore.title = "Restore original — discard your edits to this example";
    restore.addEventListener("click", (e) => {
      e.stopPropagation(); // keep the dropdown open; this is not a selection
      restoreDocument(doc.uri);
    });
    row.appendChild(restore);
  }

  return row;
}

/**
 * Discard the user's edits to one built-in by re-copying the bundled original,
 * then refresh whatever is affected: the picker row loses its edited marker,
 * and if the restored document is on screen (or imported by what is on screen)
 * the editor/viz pick up the pristine source.
 */
function restoreDocument(uri: string): void {
  const restored = library.restoreOriginal(uri);
  if (!restored) return;
  renderLibraryList();
  if (harness.fixture === uri) {
    loadDocument(uri); // also resets the buffer to the restored source
  } else if (harness.fixture) {
    renderModel(harness.fixture); // lineage may include the restored document
  }
}

/**
 * Mark a document selected in the picker, update the picker button label, and
 * load its source and model.
 */
function selectDocument(uri: string): void {
  for (const el of fixtureListEl.querySelectorAll(".fixture-item")) {
    el.classList.toggle("selected", (el as HTMLElement).dataset["uri"] === uri);
  }
  const name = library.get(uri)?.name ?? uri;
  fixturePickerName.textContent = name;
  fixturePickerName.title = name;
  loadDocument(uri);
}

// ---------- Library actions (new document, global reset) ----------

// "+ New" creates an untitled user document pre-filled with the starter
// snippet (so the canvas renders something editable immediately, never blank)
// and opens it.
libraryNewBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const doc = library.addUserDocument("untitled.stm", STARTER_SOURCE);
  renderLibraryList();
  selectDocument(doc.uri);
  togglePicker(false);
});

// Global Reset restores the library to the bundled corpus (dropping user
// documents and all edits) and clears the buffer. Destructive, so it is gated
// on an explicit confirm.
libraryResetBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const ok = window.confirm(
    "Reset the library? This discards all your edits and removes your own documents, restoring the bundled examples.",
  );
  if (!ok) return;
  if (!library.reset()) return; // manifest unavailable: nothing to reset from
  harness.fixture = null;
  editor.setValue("");
  renderLibraryList();
  const first = library.list()[0];
  if (first) selectDocument(first.uri);
  togglePicker(false);
});

// ---------- View mode toggle ----------

/**
 * Switch between "lineage" (full transitive import merge) and "single"
 * (current file only) view modes, persist the choice, then reload the current
 * document so the model is rebuilt under the new mode.
 */
function setViewMode(mode: "lineage" | "single"): void {
  harness.viewMode = mode;
  library.setViewMode(mode);
  for (const btn of viewModeToggle.querySelectorAll<HTMLButtonElement>(".toggle-btn")) {
    btn.classList.toggle("active", btn.dataset["mode"] === mode);
  }
  if (harness.fixture) loadDocument(harness.fixture);
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

// ---------- Open / Save local files (sl-nopd) ----------
//
// Both actions are entirely client-side — the privacy contract of the
// playground (feature 33 §3–4). Open reads the chosen file into memory with
// File.text() and adds it to the document library as a user document; Save
// serialises the live buffer into a Blob and downloads it via a temporary
// anchor. No request carries source content in either direction.

// Save fallback when no document is loaded (e.g. an empty library).
const FALLBACK_SAVE_FILENAME = "untitled.stm";

/**
 * Derive the Save download's default filename from the active document label
 * (PRD §4): the opened file's name, or the basename of a built-in example's
 * path (slashes are not valid in a download name), or untitled.stm. A label
 * without a recognised source extension gains `.stm` so the saved file
 * round-trips through Open's `.stm,.txt` accept filter.
 */
function defaultSaveFilename(): string {
  const doc = harness.fixture ? library.get(harness.fixture) : undefined;
  if (!doc) return FALLBACK_SAVE_FILENAME;
  const basename = doc.name.split("/").pop() ?? "";
  if (basename === "") return FALLBACK_SAVE_FILENAME;
  return /\.(stm|txt)$/.test(basename) ? basename : `${basename}.stm`;
}

// Open…: the visible button proxies to the hidden file input.
fileOpenBtn.addEventListener("click", () => fileOpenInput.click());

// A chosen file becomes a user document in the library (distinct from the
// built-in examples), is selected — which replaces the editor buffer, sets the
// document label to the filename, and re-renders the viz — and is recorded as
// a `file-open` automation event.
fileOpenInput.addEventListener("change", async () => {
  const file = fileOpenInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const doc = library.addUserDocument(file.name, text);
  renderLibraryList();
  selectDocument(doc.uri);
  recordEvent("file-open", { name: doc.name, uri: doc.uri });
  // Clear the input so choosing the same file again still fires `change`.
  fileOpenInput.value = "";
});

// Save: download the LIVE buffer (editor.getValue(), not the possibly
// debounce-stale library entry) as a Blob via a temporary anchor.
fileSaveBtn.addEventListener("click", () => {
  const filename = defaultSaveFilename();
  const blob = new Blob([editor.getValue()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Some browsers only honour programmatic anchor clicks from the document.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  recordEvent("file-save", { filename });
});

// ---------- Collapsible source pane (sl-1qte) ----------

/**
 * Collapse the source pane to its re-expand rail, or expand it back. The grid
 * column narrows (see #layout.editor-collapsed in index.html), so the viz panel
 * genuinely receives the reclaimed width — the <satsuma-viz> host is container-
 * sized and re-renders via its own ResizeObserver; nothing is overlaid. The
 * state persists in localStorage so a reload restores the chosen layout.
 *
 * @param record  When true, append an `editor-collapse` automation event so
 *                Playwright can assert the toggle was observed. The initial
 *                restore at module load passes false so the log starts clean.
 */
function setEditorCollapsed(collapsed: boolean, record: boolean): void {
  harness.editorCollapsed = collapsed;
  layoutEl.classList.toggle("editor-collapsed", collapsed);
  library.setEditorCollapsed(collapsed);
  if (record) recordEvent("editor-collapse", { collapsed });
}

editorCollapseBtn.addEventListener("click", () => setEditorCollapsed(true, true));
editorExpandRail.addEventListener("click", () => setEditorCollapsed(false, true));

// Restore the persisted collapsed/expanded state synchronously at module load —
// like the theme, the pane geometry should be right from the first paint.
if (library.editorCollapsed) setEditorCollapsed(true, false);

// ---------- Startup ----------

/**
 * Fetch the bundled examples manifest. Page-relative (document.baseURI, not an
 * absolute /… root) so the same client works on the dev server and under the
 * static playground's non-root GitHub Pages base path. Returns null on any
 * failure — the library then falls back to persisted documents or the starter.
 */
async function fetchManifest(): Promise<ExamplesManifest | null> {
  try {
    const res = await fetch(new URL("examples.json", document.baseURI).href);
    if (!res.ok) return null;
    return (await res.json()) as ExamplesManifest;
  } catch {
    return null;
  }
}

/**
 * Open the document library (seeding it from the bundled manifest on first
 * load), populate the picker, and restore the previous session: view-mode,
 * active document, and the live buffer all come back from localStorage so a
 * reload lands the user exactly where they left off. URL parameters override
 * the restored state for headless callers (Playwright, screenshots).
 */
async function init(): Promise<void> {
  // Read URL parameters set by headless callers (e.g. Playwright tests).
  const params = new URLSearchParams(window.location.search);
  const autoFixtureUri = params.get("fixture");
  const autoMode = params.get("mode");

  // Initialise the in-browser WASM parser before any model is built.
  await ensureParserReady();

  // Seed/upgrade the library from the bundled corpus. There is no server-side
  // storage anywhere in this path: the manifest is a static asset, and all
  // documents live in localStorage.
  library.open(await fetchManifest());

  // View-mode: stored preference first, URL parameter wins for automation.
  const storedMode = library.viewMode;
  if (storedMode) harness.viewMode = storedMode;
  if (autoMode === "lineage" || autoMode === "single") harness.viewMode = autoMode;
  for (const btn of viewModeToggle.querySelectorAll<HTMLButtonElement>(".toggle-btn")) {
    btn.classList.toggle("active", btn.dataset["mode"] === harness.viewMode);
  }

  // Active document: URL parameter → restored session → first library entry.
  const candidates = [autoFixtureUri, library.activeUri, library.list()[0]?.uri];
  const activeUri = candidates.find((uri) => uri && library.get(uri)) ?? null;
  if (!activeUri) {
    renderLibraryList();
    fixtureListEl.textContent = "No documents available.";
    return;
  }

  // Restore a mid-edit buffer: if the persisted buffer belongs to the document
  // we are about to open and is newer than its library entry (a tab closed
  // inside the debounce window), fold it into the entry before loading.
  const restoredBuffer = library.buffer;
  if (
    restoredBuffer !== null &&
    !autoFixtureUri && // a URL-driven session is a fresh automation context
    activeUri === library.activeUri
  ) {
    library.updateSource(activeUri, restoredBuffer);
  }

  renderLibraryList();
  selectDocument(activeUri);
}

void init();

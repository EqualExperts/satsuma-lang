/**
 * library.ts — the playground's localStorage document library (feature 33 §5).
 *
 * Owns ALL client-side persistence: the document library (built-in examples as
 * the user's own editable copies, plus user documents), the active-document
 * pointer, the current editor buffer, the view-mode, and the editor
 * collapsed/expanded state. The library doubles as the playground's example
 * browser AND as the in-browser workspace — `documents()` feeds the whole
 * library to the model pipeline so cross-file `import`s between library
 * documents resolve with no server.
 *
 * This module does NOT own the editor, the picker UI, or model-building; it is
 * a pure data layer over an injected Storage. Injection (rather than touching
 * `window.localStorage` directly) is what makes the seed/re-seed/restore/reset
 * semantics unit-testable in Node.
 *
 * Persistence is best-effort by design: every write is guarded, and a failed
 * write (e.g. quota exceeded — unlikely at ~230 KB of corpus) degrades to
 * in-memory state plus a non-blocking warning via `onPersistError`, never a
 * crash.
 */

// ---------- Manifest types (shape produced by generate-examples-manifest.mjs) ----------

/** One bundled example in the build-time manifest. */
export interface ManifestExample {
  /** Display label shown in the picker (the examples-relative path). */
  name: string;
  /** POSIX path under examples/, e.g. "sfdc-to-snowflake/pipeline.stm" — the library key. */
  path: string;
  /** The example's pristine source text. */
  source: string;
}

/** The bundled examples manifest, shipped as examples.json with the build. */
export interface ExamplesManifest {
  /** Content hash of the corpus; re-seeding is gated on this changing. */
  librarySeedVersion: string;
  /** The full corpus, sorted by path. */
  examples: ManifestExample[];
}

// ---------- Library document model ----------

/**
 * Where a document came from. Built-ins can be restored from the bundled
 * manifest and are protected from re-seed overwrites once edited; user
 * documents (opened files, new buffers) have no bundled original.
 */
export type DocumentKind = "builtin" | "user";

/** One entry in the document library. */
export interface LibraryDocument {
  /**
   * Virtual `file:///` URI — the library key AND the workspace-index key. The
   * file:/// form matches what the isomorphic import resolver produces, so
   * imports between library documents resolve (feature 33 §1a).
   */
  uri: string;
  /** Display label shown in the picker. */
  name: string;
  /** Library path the URI derives from (examples-relative for built-ins). */
  path: string;
  /** Built-in example vs user document; drives Reset/Restore semantics. */
  kind: DocumentKind;
  /** Current (possibly edited) source text. */
  source: string;
  /**
   * True once the user has changed a built-in's source. An edited built-in is
   * never overwritten by a re-seed (the no-silent-data-loss rule); only an
   * explicit Restore original or Reset reverts it. Always false for user docs.
   */
  edited: boolean;
}

/** The `{ uri, source }` shape the model pipeline consumes. */
export interface WorkspaceDocument {
  uri: string;
  source: string;
}

// ---------- Virtual URI scheme ----------

/**
 * Built-in examples live under file:///examples/<path>. The base ends in "/"
 * so `new URL(path, base)` appends rather than replaces, and sibling documents
 * resolve each other's relative imports (./other.stm) within the library.
 */
export const BUILTIN_URI_BASE = "file:///examples/";

/**
 * User documents live under a distinct root so they can never collide with a
 * built-in's URI, keeping Reset/Restore semantics unambiguous (feature 33 §5).
 */
export const USER_URI_BASE = "file:///user/";

/** Derive the virtual URI for a built-in example's library path. */
export function builtinUri(path: string): string {
  return new URL(path, BUILTIN_URI_BASE).toString();
}

// ---------- Storage keys ----------

// All keys share one namespace prefix so the playground's footprint in
// localStorage is self-describing and a global Reset knows exactly what it owns.
const KEY_PREFIX = "satsuma-playground:";
const KEY_LIBRARY = `${KEY_PREFIX}library`; // JSON: LibraryDocument[]
const KEY_SEED_VERSION = `${KEY_PREFIX}seed-version`; // string: manifest hash that seeded the library
const KEY_ACTIVE_URI = `${KEY_PREFIX}active-uri`; // string: URI of the open document
const KEY_BUFFER = `${KEY_PREFIX}buffer`; // string: live editor buffer text
const KEY_VIEW_MODE = `${KEY_PREFIX}view-mode`; // "lineage" | "single"
const KEY_EDITOR_COLLAPSED = `${KEY_PREFIX}editor-collapsed`; // "true" | "false"

// ---------- Blank-slate starter ----------

/**
 * Bundled directly in the client (not fetched) so the canvas is never blank:
 * if localStorage is empty AND the examples manifest is unavailable, the
 * library is seeded with this single starter document (feature 33 §5).
 */
export const STARTER_NAME = "starter.stm";
export const STARTER_SOURCE = `// Welcome to the Satsuma playground!
// Edit this buffer and watch the visualization update live.

schema customers {
  id INT
  name STRING
  email STRING
}

schema crm_contacts {
  contact_id INT
  full_name STRING
  email_address STRING
}

mapping customer ingestion {
  source { customers }
  target { crm_contacts }

  id -> contact_id
  name -> full_name
  email | trim | lowercase -> email_address
}
`;

// ---------- Storage abstraction ----------

/**
 * The subset of the DOM Storage interface the library uses. `window.localStorage`
 * satisfies it in the browser; tests inject a Map-backed stub.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Configuration for a DocumentLibrary instance. */
export interface DocumentLibraryOptions {
  /** Backing store — `window.localStorage` in the playground. */
  storage: StorageLike;
  /**
   * Called once per failed write batch (e.g. quota exceeded) so the UI can show
   * a non-blocking warning. The library keeps working from memory regardless.
   */
  onPersistError?: () => void;
}

// ---------- The library ----------

/**
 * The localStorage-backed document library. Construct, then call `open()` with
 * the fetched manifest (or null if the fetch failed) before any other use.
 */
export class DocumentLibrary {
  private readonly storage: StorageLike;
  private readonly onPersistError: (() => void) | undefined;

  /** In-memory mirror of the persisted library, keyed by URI. Insertion-ordered. */
  private entries = new Map<string, LibraryDocument>();

  /** The manifest that backs Restore original / Reset; null when unavailable. */
  private manifest: ExamplesManifest | null = null;

  constructor(options: DocumentLibraryOptions) {
    this.storage = options.storage;
    this.onPersistError = options.onPersistError;
  }

  // ----- Lifecycle: load + seed -----

  /**
   * Load the persisted library and reconcile it with the bundled manifest.
   *
   * Seed semantics (feature 33 §5, sl-kd45):
   *  - No seed-version key → first visit: seed every bundled example.
   *  - Version differs from the stored one → a built-in changed upstream: add
   *    new examples and update UNEDITED ones; never touch an edited document.
   *  - Version matches → nothing to reconcile.
   *  - Manifest unavailable AND the library is empty → fall back to the bundled
   *    starter document so the canvas is never blank.
   */
  open(manifest: ExamplesManifest | null): void {
    this.manifest = manifest;
    this.entries = this.loadEntries();

    if (manifest) {
      const storedVersion = this.readKey(KEY_SEED_VERSION);
      if (storedVersion !== manifest.librarySeedVersion) {
        this.mergeSeed(manifest);
        this.persistLibrary();
        this.writeKey(KEY_SEED_VERSION, manifest.librarySeedVersion);
      }
    } else if (this.entries.size === 0) {
      // Blank slate: no stored documents and no manifest to seed from.
      this.addUserDocument(STARTER_NAME, STARTER_SOURCE);
    }
  }

  /**
   * Merge the manifest into the current entries: add documents the library has
   * never seen, refresh unedited built-ins whose upstream source changed, and
   * leave every edited document exactly as the user left it.
   */
  private mergeSeed(manifest: ExamplesManifest): void {
    for (const example of manifest.examples) {
      const uri = builtinUri(example.path);
      const existing = this.entries.get(uri);
      if (existing?.edited) continue; // the user's work always wins
      this.entries.set(uri, {
        uri,
        name: example.name,
        path: example.path,
        kind: "builtin",
        source: example.source,
        edited: false,
      });
    }
  }

  // ----- Reading -----

  /** All documents in insertion order (built-ins first on a fresh library). */
  list(): LibraryDocument[] {
    return [...this.entries.values()];
  }

  /** Look up one document by URI. */
  get(uri: string): LibraryDocument | undefined {
    return this.entries.get(uri);
  }

  /**
   * The whole library in the `{ uri, source }` shape the model pipeline
   * consumes — the library IS the in-browser workspace, which is what makes
   * cross-file lineage between library documents resolve client-side.
   */
  documents(): WorkspaceDocument[] {
    return this.list().map(({ uri, source }) => ({ uri, source }));
  }

  // ----- Mutation -----

  /**
   * Record a user edit to a document's source. Marks built-ins as edited
   * (engaging re-seed protection) and persists the library.
   */
  updateSource(uri: string, source: string): void {
    const entry = this.entries.get(uri);
    if (!entry || entry.source === source) return;
    entry.source = source;
    if (entry.kind === "builtin") entry.edited = true;
    this.persistLibrary();
  }

  /**
   * Add a user document (an opened local file or a new untitled buffer) to the
   * library. The name is suffixed (`name-2.stm`, `name-3.stm`, …) if a user
   * document with the same name already exists, so URIs stay unique. Returns
   * the stored document.
   */
  addUserDocument(name: string, source: string): LibraryDocument {
    const uniqueName = this.uniqueUserName(name);
    const doc: LibraryDocument = {
      uri: new URL(encodeURIComponent(uniqueName), USER_URI_BASE).toString(),
      name: uniqueName,
      path: uniqueName,
      kind: "user",
      source,
      edited: false,
    };
    this.entries.set(doc.uri, doc);
    this.persistLibrary();
    return doc;
  }

  /** Derive a user-document name that no existing user document already uses. */
  private uniqueUserName(name: string): string {
    const taken = new Set(this.list().filter((d) => d.kind === "user").map((d) => d.name));
    if (!taken.has(name)) return name;
    // Split "pipeline.stm" into "pipeline" + ".stm" so the counter lands before
    // the extension; a name with no dot gets the counter appended directly.
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 2; ; n++) {
      const candidate = `${stem}-${n}${ext}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * Re-copy ONE built-in example's pristine source from the bundled manifest,
   * discarding the user's edits to it. No-op (returns undefined) for user
   * documents, unknown URIs, or when the manifest is unavailable.
   */
  restoreOriginal(uri: string): LibraryDocument | undefined {
    const entry = this.entries.get(uri);
    if (!entry || entry.kind !== "builtin" || !this.manifest) return undefined;
    const example = this.manifest.examples.find((e) => builtinUri(e.path) === uri);
    if (!example) return undefined;
    entry.source = example.source;
    entry.edited = false;
    this.persistLibrary();
    return entry;
  }

  /**
   * Global Reset: restore the library to exactly the bundled corpus (dropping
   * user documents and all edits) and clear the session state (active document,
   * buffer). View-mode and editor-collapsed survive — they are display
   * preferences, not document state. No-op when the manifest is unavailable.
   * Returns true if the reset ran.
   */
  reset(): boolean {
    if (!this.manifest) return false;
    this.entries = new Map();
    this.mergeSeed(this.manifest);
    this.persistLibrary();
    this.writeKey(KEY_SEED_VERSION, this.manifest.librarySeedVersion);
    this.removeKey(KEY_ACTIVE_URI);
    this.removeKey(KEY_BUFFER);
    return true;
  }

  // ----- Session state (active document, buffer, display preferences) -----

  /** URI of the document open in the editor, or null on a fresh session. */
  get activeUri(): string | null {
    return this.readKey(KEY_ACTIVE_URI);
  }

  setActiveUri(uri: string): void {
    this.writeKey(KEY_ACTIVE_URI, uri);
  }

  /**
   * The live editor buffer as last persisted. Stored separately from the
   * library entry so a keystroke can be captured cheaply (one small write, not
   * a full library serialisation) and survives a tab close mid-debounce.
   */
  get buffer(): string | null {
    return this.readKey(KEY_BUFFER);
  }

  setBuffer(text: string): void {
    this.writeKey(KEY_BUFFER, text);
  }

  /** Persisted view-mode, or null when never set. */
  get viewMode(): "lineage" | "single" | null {
    const stored = this.readKey(KEY_VIEW_MODE);
    return stored === "lineage" || stored === "single" ? stored : null;
  }

  setViewMode(mode: "lineage" | "single"): void {
    this.writeKey(KEY_VIEW_MODE, mode);
  }

  /** Persisted editor collapsed/expanded state; the collapse UI is sl-1qte. */
  get editorCollapsed(): boolean {
    return this.readKey(KEY_EDITOR_COLLAPSED) === "true";
  }

  setEditorCollapsed(collapsed: boolean): void {
    this.writeKey(KEY_EDITOR_COLLAPSED, String(collapsed));
  }

  // ----- Guarded storage access -----

  /** Parse the persisted library, tolerating absence or corruption. */
  private loadEntries(): Map<string, LibraryDocument> {
    const raw = this.readKey(KEY_LIBRARY);
    if (!raw) return new Map();
    try {
      const parsed = JSON.parse(raw) as LibraryDocument[];
      if (!Array.isArray(parsed)) return new Map();
      return new Map(parsed.map((doc) => [doc.uri, doc]));
    } catch {
      // Corrupt JSON (e.g. a partial quota-failed write): start clean rather
      // than crash; the seed pass will repopulate the built-ins.
      return new Map();
    }
  }

  /** Serialise and persist the whole library (guarded). */
  private persistLibrary(): void {
    this.writeKey(KEY_LIBRARY, JSON.stringify(this.list()));
  }

  private readKey(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeKey(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      // Quota or privacy-mode failure: keep working from memory, tell the UI once.
      this.onPersistError?.();
    }
  }

  private removeKey(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      this.onPersistError?.();
    }
  }
}

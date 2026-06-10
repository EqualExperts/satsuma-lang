# ADR-028 — Client-Only Document Library as the Playground Workspace

**Status:** Accepted
**Date:** 2026-06-10 (sl-cahg, feature 33)

## Context

With the VizModel pipeline running in the browser (ADR-027), the playground
still needed a workspace: a set of documents for the picker to list, for the
editor to load, and — critically — for cross-file `import` lineage to resolve
against. The retired harness server had provided this via `/api/fixtures` and
`/api/source`.

ADR-022 defines workspace scope for the file-based CLI: imports are explicit,
and only symbols reachable through transitive import resolution from the file
under consideration are in scope. Those semantics are about *reachability*,
not about *where documents live* — but every existing implementation read
documents from a filesystem.

The playground also carries feature 33's privacy promise (ADR-027): documents
a visitor opens or edits must never leave the browser, which rules out any
server-side or third-party storage. Alternatives considered: keeping a
fixtures API for built-in examples only (rejected — splits the workspace into
two sources with different lineage behaviour, and reintroduces a server);
IndexedDB (rejected — an async API and schema migration story far heavier
than the ~230 KB corpus requires); no persistence at all (rejected — losing a
visitor's edits on reload fails the "playground you can come back to" goal).

## Decision

The playground's single source of documents is a `localStorage`-backed
document library (`tooling/satsuma-viz-harness/src/client/library.ts`,
sl-kd45) that doubles as the example browser AND the in-browser workspace:

- **Seeding:** at build time the whole `examples/` corpus is serialised into
  a static `examples.json` (content-hashed `librarySeedVersion`); on first
  visit the client seeds the library from it. A version change re-seeds only
  documents the user has not edited — an edited built-in is never silently
  overwritten, only an explicit Restore original or Reset reverts it.
- **Workspace semantics:** `library.documents()` feeds the entire library to
  `buildModel`, and library keys are virtual URIs (`file:///examples/<path>`
  for built-ins, `file:///user/<name>` for opened/new documents) in exactly
  the form ADR-027's resolver produces — so ADR-022's reachability semantics
  apply unchanged. This ADR **scopes ADR-022 without superseding it**: scope
  resolution (import-graph reachability) still holds; only the storage medium
  of documents changes from filesystem to localStorage.
- **Persistence and privacy:** the library, active document, live buffer, and
  display preferences persist in `localStorage` under the
  `satsuma-playground:` key prefix and are never transmitted (the page states
  this visibly; the static-bundle Playwright project asserts zero network
  requests across edit/Open/Save). Writes are guarded: quota or privacy-mode
  failures degrade to in-memory operation plus a non-blocking warning.

## Consequences

**Positive:**

- Cross-file lineage works in the browser with no server: an edit to one
  library document updates lineage everywhere it is imported.
- A reload restores the visitor's exact session (document, buffer, view
  mode), making the playground a workspace rather than a demo.
- Reset/Restore semantics are unambiguous because built-in and user documents
  live under distinct URI roots.
- Data residency is trivially auditable: everything lives under one
  `localStorage` prefix in the visitor's browser.

**Negative:**

- Storage is bounded by the `localStorage` quota (~5 MB) and the synchronous
  API; acceptable at the current ~230 KB corpus but a constraint on shipping
  much larger example sets.
- Documents are per-browser-profile: no sync across devices or browsers, and
  clearing site data deletes the visitor's work — by design, but it must be
  communicated rather than mitigated.
- Browser privacy modes that block `localStorage` writes degrade to
  memory-only sessions (handled with a visible warning, not an error).

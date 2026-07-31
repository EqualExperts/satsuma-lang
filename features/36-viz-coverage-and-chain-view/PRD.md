# Feature 36 — Viz Coverage Overlay & Field Chain View

> **Status: PROPOSED** (2026-07-31) — depends on Feature 35 (workspace
> coverage command / core relocation) for the coverage data contract.
> Motivated by review workflows on large converted mapping specs: reviewers
> need to *see* where a spec is incomplete, and to follow a single field's
> journey end-to-end, without reading mapping detail views hop by hop.

## Goal

Extend satsuma-viz with two review-oriented views built entirely on data the
toolchain already computes:

1. **Coverage overlay** — the overview answers "how complete is this spec?"
   at a glance: each schema card shows its mapped-field percentage and
   uncovered count, and uncovered fields are visually distinct in card and
   detail views.
2. **Field chain view** — selecting a field renders its full upstream and
   downstream lineage as a single left-to-right chain — the "biography of one
   field" — with each hop's transform classification visible.

The primary success criteria are:

1. A reviewer opening the viz on a half-converted workspace can identify the
   least-complete schemas without opening a single mapping detail view.
2. The numbers shown by the overlay are **identical** to `satsuma coverage`
   output for the same workspace — same core function, no viz-side
   re-derivation.
3. A user can go from any field (overview card, detail view, or chain view
   hop) to that field's chain view in one interaction, and walk the chain in
   either direction.
4. Both views work in the client-only live editor: no CLI process, no
   backend — computation comes from `@satsuma/core` in the browser bundle.
5. The Playwright harness suite covers both views via the watcher protocol.

## Background

- satsuma-viz (`tooling/satsuma-viz/`) is a Lit web component with an
  ELK-laid-out overview (schema/metric cards, mapping edges) and a
  per-mapping detail view. It is embedded in the VS Code webview panels and
  in the site's client-only "Try it Live!" playground (Features 33/34).
- `tooling/satsuma-viz/src/field-coverage.ts` already consumes
  `@satsuma/core/coverage-paths` (`buildCoveredFieldSet`) so the detail view
  shares the LSP's nested-field coverage semantics. The component is one step
  short of *showing* coverage as a first-class signal — the semantics are
  wired in, the presentation is not.
- Feature 35 relocates `computeMappingCoverage` into `@satsuma/core`. Because
  the playground is client-only, this relocation is what makes a coverage
  overlay *possible* there at all: viz can call the core function directly on
  its in-browser workspace model. The CLI's `coverage --json` contract and
  the overlay must be two renderings of one function.
- Field-level lineage traversal exists in the CLI:
  `satsuma field-lineage <schema.field> --json`
  (`tooling/satsuma-cli/src/commands/field-lineage.ts`) returns upstream and
  downstream chains with per-hop `via_mapping` and `classification`
  (`none` / `nl` / `nl-derived`), depth-limited, cycle-guarded. Nothing
  renders this: users reconstruct a field's journey by opening successive
  mapping detail views and finding the field in each.

## Problems

### P1 — Coverage is invisible outside the VS Code editor

Coverage exists as editor gutter decorations (LSP consumer) and as covered/
uncovered logic inside the detail view's rendering helpers. A stakeholder
looking at the viz — the audience the playground and webview panels exist
for — gets no completeness signal. The overview presents a half-mapped
workspace and a fully-mapped one identically.

### P2 — No way to see one field's end-to-end journey

The question users ask most in review sessions is "where does this field
come from, and where does it go?". `field-lineage` answers it as JSON, but in
the viz the user must: open mapping detail A, find the field, note its
source, close, open mapping detail B, repeat. For chains crossing three or
more mappings this is slow and error-prone, and NL-derived hops (implicit
dependencies referenced in prose) are easy to miss entirely.

### P3 — Chain data has no viz-model representation

The viz-model (`@satsuma/viz-model`) describes cards, fields, and mapping
edges — there is no model type for a traversal result (an ordered chain of
field hops with classifications). Without one, any chain rendering would
couple the component directly to CLI JSON shapes, violating the existing
backend/model separation (`@satsuma/viz-backend` builds models; the
component renders them).

## Requirements

### R1 — Coverage overlay on the overview (fixes P1)

- A user-facing toggle (default off) switches the overview into coverage
  mode.
- In coverage mode each schema card shows: mapped/total field count and
  percentage, computed by the core coverage function aggregated across all
  mappings referencing the schema (the same aggregate semantics as
  `satsuma coverage`'s schema-level rollup — Feature 35 R3).
- Cards are visually ranked by completeness (e.g. a percentage badge and a
  proportional fill on the card header) using the existing token/theming
  system — must respect both light and dark themes and meet the dataviz
  accessibility conventions already used by the component.
- Percentage badges must not perturb layout: card sizes and ELK layout are
  unchanged between modes (overlay is paint-only), so toggling doesn't
  reshuffle the diagram the user is looking at.

### R2 — Uncovered fields are distinct in card and detail views (fixes P1)

- In coverage mode, expanded schema cards and the mapping detail view render
  uncovered fields with a distinct, theme-safe treatment (muted +
  iconography, not colour alone).
- The detail view's treatment must reuse the existing
  `field-coverage.ts` covered-set computation — this requirement is
  presentation only; no new semantics.

### R3 — Chain view model type in `@satsuma/viz-model` (fixes P3)

- Add a chain/traversal model type: ordered upstream hops → focus field →
  ordered downstream hops; each hop carries field ref, owning schema,
  `via_mapping`, and classification (`none` / `nl` / `nl-derived`).
- `@satsuma/viz-backend` gains a builder that produces this model from the
  in-memory workspace (browser path), with the shape kept deliberately
  compatible with `field-lineage --json` (CLI path) so either source can
  feed the component.

### R4 — Chain view rendering (fixes P2)

- Entry points: a field action in expanded cards and in the mapping detail
  view ("trace this field"), plus programmatic API on the component for
  hosts (VS Code commands; the harness drives the same API). The component
  API is host-agnostic, but *wiring it to playground URL state is out of
  scope* — public-playground exposure is deferred to its own feature per
  Open Question 1.
- Rendering: a single left-to-right rail — upstream sources, focus field
  (visually anchored), downstream consumers — one card per hop showing
  schema + field, connected by edges labelled with the mapping name and a
  classification badge. NL-derived hops are visibly differentiated (they are
  inferred from prose, not declared — reviewers must be able to tell).
- Branching chains (a field feeding multiple targets) render as a fan; depth
  is limited with an explicit "depth limit reached" affordance rather than
  silent truncation (no-silent-caps rule).
- Every hop is clickable: clicking a hop re-focuses the chain view on that
  field; clicking the mapping label opens that mapping's detail view.
- Back navigation returns to the view the user came from, preserving the
  Feature 34 R1 guarantee (view state survives model updates in the live
  editor — an edit while in chain view re-traces the same field if it still
  exists, and falls back to overview only when it doesn't).

### R5 — Test coverage via the harness (all)

- New Playwright specs in `tooling/satsuma-viz-harness/` exercised through
  the sentinel-file watcher protocol (agent sandbox cannot run browsers):
  coverage toggle on/off, badge values against a fixture with known
  coverage, uncovered-field treatment, chain view for a fixture field with
  ≥2 upstream and ≥2 downstream hops including one `nl-derived` hop,
  hop-click refocus, and edit-while-in-chain-view state preservation.
- Unit tests for the viz-backend chain builder against minimal `.stm`
  snippets, asserting parity with `field-lineage --json` for the same
  fixture (golden comparison keeps the two paths honest).

  Parity is asserted against a **checked-in golden file**, regenerated by a
  script under `scripts/`. viz-backend must not gain a dependency on
  `satsuma-cli` to shell out for the comparison: the dependency direction is
  backend → core, and inverting it for a test would couple the browser bundle's
  package graph to the CLI. The regeneration script's output being committed is
  what makes a divergence show up as a reviewable diff.

## Acceptance Tests

- Fixture workspace with one fully-mapped and one half-mapped schema:
  coverage mode shows 100% and the exact expected percentage; numbers match
  `satsuma coverage --json` for the same fixture byte-for-value.
- Chain view on a field with a three-mapping chain shows all hops in order
  with correct mapping labels and classifications.
- A field referenced only via an NL `@ref` appears in the chain as an
  `nl-derived` hop with distinct rendering.
- Toggling coverage mode does not change card geometry (layout snapshot
  comparison).
- All existing harness suites remain green.

## Out of Scope

- A standalone deployed lineage web application (hosting, routing, auth) —
  satsuma-viz remains an embeddable component; app shells are consumer
  projects.
- Coverage *policy* (which gaps are acceptable) — the overlay renders
  deterministic counts only; policy belongs to lint (Feature 37).
- Historical/trend coverage (comparing coverage across git revisions).
- Rendering CLI `coverage --json` files loaded from disk into the component
  (the shapes are kept compatible, but a file-loading UI is not part of this
  feature).

## Open Questions

1. Should coverage mode be exposed in the site playground immediately, or
   land in the harness + VS Code panels first? (Playground chrome is a
   product surface with its own UX bar per Feature 34.) Separate feature (future) -> add to roadmap.
2. Chain view for very wide fans (a hub field feeding dozens of targets):
   collapse groups by namespace, or paginate the fan? Proposed: collapse by
   namespace with expand-on-click. ACCEPT PROPOSAL
3. Should the component accept an externally supplied coverage/chain model
   (host-computed) in addition to computing its own? VS Code could reuse the
   LSP's computation instead of shipping a second one in the webview bundle. REUSE

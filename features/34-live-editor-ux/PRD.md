# Feature 34 — Live Editor UX Polish (Feature 33 follow-up)

> **Status: DRAFT** (2026-06-10) — captured from a user review of the shipped
> "Try it Live!" playground (Feature 33, PR #269). Source material: four
> annotated screenshots in this folder (`chrome-markup.jpg`,
> `edge-attachment-markup.jpg`, `metric-target-missing.jpg`,
> `meta-pill-wasted-space.jpg`) reviewed against the merged code.

## Goal

Bring the public-facing playground chrome and the visualization's edit-loop
behaviour up to product quality. Feature 33 proved the client-only pipeline
works; this feature removes the internal-harness residue that is now visible
to every site visitor, and fixes two interaction defects that make live
editing feel broken.

The primary success criteria are:

1. **Editing does not throw away the user's view.** A visitor who has opened a
   mapping detail view and edits the source sees that same mapping re-render
   in place — the viz never silently snaps back to the overview while the
   mapping still exists.
2. **Edges connect to cards.** Overview edges and their anchor dots terminate
   flush on the card borders, vertically centred on the orange header — no
   dots or curve stubs floating in empty space, and no dead filler bar
   bloating the headers of non-namespaced cards.
3. **Every mapping endpoint renders in the detail view.** A mapping whose
   target (or source) is a metric shows that metric's card in the detail
   view's TARGET/SOURCES column — never an empty column.
4. **Cards are no wider than their content needs.** Long metadata values
   (namespace URIs) stack vertically instead of inflating card width and
   leaving fields floating in white space.
5. **The chrome reads as a product, not a test rig.** Branded header, no
   internal toggles or status badges, no dead toolbar buttons, and a source
   pane collapse affordance a first-time visitor understands.
6. **Typography follows the EE brand guide.** Headings and chrome text use
   Lexend; monospace is reserved for code-like content.

## Background

Feature 33 (`features/33-live-editor/PRD.md`) turned the viz harness into a
client-only live editor published on the site as "Try it Live!". The harness
chrome, however, still carries its Feature 29/30 heritage as an internal
fixture viewer and Playwright host: developer-facing toggles, an automation
ready-badge, and an unbranded title. Now that the page is a public product
surface, that residue is a UX bug in its own right.

A user review on 2026-06-10 marked up the following problems.

## Problems

Each problem is grounded in the merged code on `main`.

### P1 — Any edit resets the viz to the overview, losing the detail view

`tooling/satsuma-viz/src/satsuma-viz.ts:852-858`: whenever the `model`
property changes, `updated()` unconditionally resets internal state:

```ts
if (changed.has("model") && this.model) {
  this._expandedModels = new Map();
  this._viewMode = "overview";
  this._selectedMapping = null;
  this._runLayout();
}
```

The harness edit loop (`app.ts` `handleEdit` → debounced rebuild → sets
`viz.model`) therefore knocks the user back to the lineage/overview on every
keystroke-debounce. A user inspecting a mapping detail while tweaking a
transform must re-click into the mapping after **every** edit. This made sense
when a model change meant "a different fixture was loaded"; under live editing
the model changes constantly and the reset is hostile.

### P2 — Overview edges and anchor dots float in space instead of touching cards

(`edge-attachment-markup.jpg`, circled.) In the schema overview ("Mapping
Viz"), edge endpoints and their anchor dots
(`sz-overview-edge-layer.ts:178-179`) hang in empty space *above* the schema
cards instead of sitting vertically centred on the orange header bar.

Three confirmed mechanisms (width estimation is **not** one of them — the
rendered cards are pinned to the layout width via
`width: ${node.width}px`, `satsuma-viz.ts:1420`):

1. **The edge SVG layer is mounted 24px too high.** The overview canvas uses
   `padding: 24px` and the cards live in an in-flow `.card-layer` inside that
   padding, but the edge layer is absolutely positioned with
   `left: 24px; top: 0` (`satsuma-viz.ts:1402-1411`). Horizontally the 24px
   compensates for the padding; vertically nothing does, so **every** edge
   and anchor dot renders exactly 24px above its true position.
2. **Anchor math disagrees with the rendered card.**
   `overviewVisualAnchor` (`elk-layout.ts:977-987`) places the dot at
   `node.y + HEADER_HEIGHT / 2` for cards without a namespace — assuming the
   header starts at the node top. But compact cards *always* render a 24px
   top bar: the namespace pill row when namespaced, or an **empty orange
   filler bar** when not (`sz-schema-card.ts` `_renderNamespacePill`, the
   `if (this.compact)` branch). So the dot targets the filler bar, not the
   centre of the visible header.
3. **Rendered card height exceeds the layout's.** That same filler bar is
   invisible to `compactHeight(schema, hasNamespace = false)`
   (`elk-layout.ts:120-137`), so non-namespaced compact cards are 24px
   taller than their ELK node — they overflow their layout bounds, which is
   why vertical spacing between rows looks arbitrary.

### P2b — Compact card headers are too tall when there is no namespace pill

Same screenshot, same filler bar as P2(2): a compact card without a
namespace shows ~64px of orange (24px empty filler + 40px header) where a
namespaced card uses that space for the namespace pill. For
non-namespaced sources/targets the filler is pure dead space and makes the
header look bloated. The filler exists only to keep the orange area's
rounded top corners; the header itself can own the top rounding when no
pill row is present.

### P3 — Metric mapping targets render as an empty TARGET column in detail view

(`metric-target-missing.jpg`.) In `examples/metrics-platform`, opening the
`_conversion_rate_pipeline` mapping (target `conversion_rate`, a **metric**)
shows a completely empty TARGET column.

Root cause: `tooling/satsuma-viz/src/satsuma-viz.ts:1594-1604`
(`_renderMappingDetailView`) resolves the mapping's endpoints only against
schemas:

```ts
const allSchemas = this.model.namespaces.flatMap((ns) => ns.schemas);
...
const targetSchema = allSchemas.find((s) => s.qualifiedId === mapping.targetRef) ?? null;
```

Metrics live in `ns.metrics`, so a metric target (or source) resolves to
`null` and `sz-mapping-detail` renders nothing for that column. The overview
layout already knows better — `elk-layout.ts:486` notes "Metric schemas are
valid mapping sources and targets" and adapts metrics into port-bearing nodes
— so this is a detail-view resolution gap, not a model gap. The same blind
spot likely applies to fragments-as-endpoints if the language permits it
(verify during implementation).

### P4 — Header chrome is internal-harness, not product

(`chrome-markup.jpg`, circled.) `tooling/satsuma-viz-harness/src/client/index.html:423-432`:

- **Title** is `satsuma viz harness`. It should be the Satsuma brand: logo
  (asset exists at `site/img/satsuma-logo.png`) plus wordmark, with the
  "viz harness" suffix removed.
- **`lineage` / `single` view-mode toggle** (`#view-mode-toggle`) is a
  developer concept that means nothing to a visitor. Default to lineage and
  remove the toggle from the public chrome. (The in-viz "expand lineage"
  affordance already covers the cross-file case.)
- **`ready` badge** (`#harness-ready-badge`, shows `idle`/`ready`) is an
  automation aid leaking into the UI. The Playwright contract is the
  `data-ready-state` attribute (`app.ts:386-390`); the visible badge should go.

The `light`/`dark` theme toggle and the `🔒 local-only` notice are **not** in
scope for removal — both carry user value.

### P5 — "Export" button does nothing in the playground

(`edge-attachment-markup.jpg`, circled "Useless".) The component toolbar
renders `⇩ Export` (`tooling/satsuma-viz/src/satsuma-viz.ts:1145`,
`_exportSvg`). The button builds an SVG and dispatches an `export` event
(`satsuma-viz.ts:1300-1306`); the VS Code webview forwards that to the
extension and saves a file (`tooling/vscode-satsuma/src/webview/viz/viz.ts:34`,
`panel.ts:182`), but the playground only records the event for Playwright
(`app.ts:415-417`) — clicking it does nothing user-visible. Two further
defects: the button label doesn't say what it exports, and the generated SVG
styles everything with `var(--sz-*)` custom properties
(`satsuma-viz.ts:1274-1298`) which do not resolve in a standalone `.svg`
file, so even the saved artifact renders without its intended colours.

**Decision (user, 2026-06-10): keep the export, since it does produce SVG —
make it work and label it honestly** (see R5).

### P6 — Source-pane collapse affordance is not understandable

(`chrome-markup.jpg`, circled "Useless" / "More obvious hint needed".) The
collapse control is a bare `◀` button (`index.html:474`, `sl-1qte` rail at
`index.html:119-143`). First-time visitors don't recognise it, and once
collapsed, the re-expand rail is equally opaque. The affordance needs to be
self-explanatory — candidates: a labelled handle ("Hide source"), a
full-height draggable splitter with a grip glyph, or a chevron tab attached to
the pane edge with a tooltip. The chosen design must make both directions
(collapse *and* re-expand) obvious without prior knowledge.

### P7 — Horizontal meta pills inflate card width, wasting huge white space

(`meta-pill-wasted-space.jpg`, crossed out.) In the mapping detail
view, the `commerce_order` source card is rendered several times wider than
its field list because its metadata pills (`format xml` plus two long
`namespace http://…` URIs) lay out in a single horizontal row, and that row
sets the card's intrinsic width:

- `tooling/satsuma-viz/src/components/sz-schema-card.ts:246-264` —
  `.metadata-pills` is a `flex` row of `white-space: nowrap` pills; nothing
  bounds an individual pill's width.
- `tooling/satsuma-viz/src/components/sz-mapping-detail.ts:66-67` — the
  detail-view column deliberately lets schema cards "grow to their content
  width instead of truncating", so the pill row's max-content width becomes
  the card width.

The field rows are ~250px wide; the pill row pushes the card past 350px+ and
everything below the pills is empty white space. The annotation's fix: meta
pills on source and target cards should stack vertically (one pill per row,
wrapping long values) so card width is driven by the field list, not by
metadata.

### P8 — Heading typography doesn't follow the EE brand guide (Lexend)

The EE brand guide (`assets/ee-brand/brand-guidelines-summary.md`) names
**Lexend** (Normal/Medium/Light weights) as the primary font family, chosen
for accessibility and readability. The live editor uses no Lexend anywhere:

- The harness chrome sets `font-family: var(--font-mono)` (JetBrains Mono) on
  `html, body` (`tooling/satsuma-viz-harness/src/client/index.html:96-100`),
  so the header `h1`, toolbar labels, and buttons all render in a monospace
  font.
- The viz component's sans token is Inter
  (`tooling/satsuma-viz/src/tokens.css:64`, `--sz-font-sans`).

Note the history: Feature 31 explicitly left adopting EE typography **out of
scope** ("co-brand, do not re-skin"). The user has now decided that the
playground's headings and chrome should follow the brand guide — this PRD
records that decision for the live editor surface. Monospace stays for what
is genuinely code (the source editor, field names, types).

## Requirements

### R1 — Preserve view state across model updates (fixes P1)

When `model` changes on `<satsuma-viz>`:

- If the component is in detail view and a mapping with the same id exists in
  the new model, stay in detail view, re-bind `_selectedMapping` to the new
  model's mapping object, and re-run layout. Preserve pan/zoom if practical;
  at minimum preserve the view mode and selection.
- Fall back to the overview only when the previously-selected mapping no
  longer exists in the new model (renamed or deleted).
- Preserve `_expandedModels`/compact-card expansion by schema id on the same
  basis (keep what still resolves, drop what doesn't).
- Acceptance: a Playwright test that opens a mapping detail, edits the source
  (changing only a transform string), waits for re-render, and asserts the
  detail view for the same mapping id is still shown; a second test renames
  the mapping and asserts a graceful fall-back to overview.

### R2 — Edges terminate flush on card borders, centred on the header (fixes P2, P2b)

- The overview edge layer renders in the same coordinate space as the cards
  (fix the missing 24px vertical offset at `satsuma-viz.ts:1402-1411`, or
  remove the canvas-padding/inline-offset split entirely so both layers share
  one origin by construction).
- Every anchor dot lies on (within ~1px of) the border of its card,
  vertically centred on the visible orange header bar — for namespaced and
  non-namespaced cards, and for mapping pill nodes.
- Non-namespaced compact cards render no filler bar: the header is the top of
  the card (owning the rounded corners), the rendered card height equals the
  ELK node height, and `overviewVisualAnchor` / `compactHeight` /
  `_renderNamespacePill` agree on the same geometry — one shared constant,
  not three coincidentally-equal numbers.
- Acceptance: a Playwright test that reads an anchor dot's position and its
  card's bounding box and asserts the dot sits on the card edge at the
  header's vertical midpoint, covering a namespaced and a non-namespaced
  card in both themes; plus an assertion that a non-namespaced compact
  card's rendered height matches its layout node height.

### R3 — Metric endpoints render in the mapping detail view (fixes P3)

- `_renderMappingDetailView` resolves `sourceRefs`/`targetRef` against
  metrics (and any other valid endpoint kinds) as well as schemas, and the
  detail view renders the appropriate card (`sz-metric-card` or a
  field-bearing adaptation consistent with how `elk-layout.ts:479-494` adapts
  metrics for ports).
- Field-level hover/highlight (`sourceMapped`/`targetMapped`) works for metric
  fields the same as for schema fields.
- Acceptance: a Playwright test on the `metrics-platform` example that opens
  `_conversion_rate_pipeline` and asserts the TARGET column renders the
  `conversion_rate` metric card with its fields; a unit/integration test
  covering a metric used as a mapping *source* as well.

### R4 — Branded, minimal public header (fixes P4)

**Decision (user, 2026-06-10):** the header is the Satsuma logo plus the
wordmark **"Satsuma"** — nothing else in the title.

- Header shows the Satsuma logo + "Satsuma" (final wordmark text to be
  confirmed — see Open Questions); "viz harness" is gone.
- `#view-mode-toggle` and `#harness-ready-badge` are removed from the visible
  chrome. Lineage mode is the default behaviour. The `data-ready-state`
  automation contract is unchanged; update Playwright helpers that wait on the
  badge to wait on the attribute instead.
- Theme toggle and local-only notice remain.

### R5 — Export works everywhere and says what it does (fixes P5)

- The toolbar button reads **"Export SVG"**.
- In the playground, clicking it downloads the SVG as a file (client-side
  Blob/anchor download, consistent with the editor's Save action — nothing
  leaves the browser). VS Code behaviour is unchanged.
- The exported SVG is self-contained: `var(--sz-*)` references are resolved
  to literal colour values from the active theme at export time, so the file
  renders correctly outside the component.
- Acceptance: a Playwright test that clicks Export SVG in the playground and
  asserts a download of well-formed SVG containing no unresolved `var(`
  references; an assertion that the button label is "Export SVG".

### R6 — Self-explanatory source-pane collapse (fixes P6)

**Decision (user, 2026-06-10):** keep the collapse feature; the work is to
make it **more discoverable**, not to remove it.

- Replace the bare `◀` button with an affordance a first-time visitor
  understands without a tooltip hunt; the collapsed state's re-expand
  affordance must be equally discoverable.
- Acceptance: existing collapse/expand Playwright coverage (sl-1qte) updated
  to the new affordance; both directions reachable by mouse and keyboard with
  an `aria-label`.

### R7 — Meta pills stack vertically; card width follows fields (fixes P7)

- Schema-card metadata pills render one per row (stacked vertically), with
  long values wrapping or middle-truncating with a title tooltip — an
  individual pill must never widen the card beyond what the field rows need.
- Applies wherever the full schema card renders (detail view both columns,
  expanded overview cards); layout width estimation
  (`elk-layout.ts` `estimate*Width`) is updated to match so R2's
  flush-edge guarantee still holds.
- Acceptance: a Playwright/visual test on a fixture with multiple long
  namespace metadata values asserting the card width is within a small factor
  of its widest field row, in both themes.

### R8 — Headings and chrome typography use Lexend (fixes P8)

- The playground header, panel labels, toolbar buttons, and other chrome text
  use Lexend (Normal/Medium/Light per the brand guide), self-hosted or
  subsetted so the static playground build stays offline-capable (no
  third-party font CDN call — the page promises "your source is never
  uploaded", and it should not phone out for fonts either).
- The source editor, field names, types, and other code-like content remain
  JetBrains Mono.
- Decide and record explicitly whether `--sz-font-sans` in
  `tooling/satsuma-viz/src/tokens.css` switches from Inter to Lexend — this
  changes typography for the VS Code webview too, and affects the
  char-width estimation constants in `elk-layout.ts` (coordinate with R2/R7).
- Acceptance: a Playwright assertion that the rendered header/panel-label
  `font-family` resolves to Lexend, and a check that the static bundle loads
  no cross-origin font resources.

## Out of scope

- Renderer/VizModel contract changes beyond the view-state and edge-attachment
  fixes above.
- Theme palette work (Feature 32 owns tokens).
- Editor features (autocomplete, diagnostics-in-gutter, etc.).
- The unmarked toolbar items (`Fit`, `Refresh`, `Show File Notes`) and the
  fixture picker.

## Open questions

1. **P2 "spacing" annotation**: likely explained by P2(3) — non-namespaced
   cards overflowing their layout bounds by 24px distorts the apparent row
   spacing. Confirm after the R2 fix whether any residual canvas-margin
   issue remains.

Resolved 2026-06-10 (decisions recorded inline above): header wordmark is
logo + "Satsuma" (R4); Export is kept, relabelled "Export SVG", and made to
actually download (R5); the collapse affordance is kept and made more
discoverable (R6).

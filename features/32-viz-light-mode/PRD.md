# Feature 32 — Viz Light Mode & VS Code Theme Integration

> **Status: DRAFT (2026-06-05) — awaiting review**

## Goal

Make light and dark first-class, equally-supported themes for the Satsuma
mapping visualization, driven automatically by the user's VS Code colour theme
preference — including live switching when the user changes theme with a panel
open. The primary success criterion is: **a user on a light VS Code theme sees
a coherent, fully-styled light viz; a user on a dark theme sees the dark viz;
switching themes updates an open panel immediately; and both palettes are
defined exactly once, in `tooling/satsuma-viz/src/tokens.css`.**

## Background

The component already *has* a light palette: the `:host` defaults in
`tooling/satsuma-viz/src/tokens.css` are the warm cream/orange site design
language (`--sz-bg: #FFFAF5`, `--sz-orange: #F2913D`, …), with dark overrides
under `:host([theme="dark"])`. But the theming story around it is incomplete
and inconsistent, so light mode today works only by accident, and only
partially. This feature finishes the job rather than inventing a new palette.

Feature 31 (`features/31-alignment-with-ee-brand/PRD.md`) resolved the brand
question: **co-brand, do not re-skin** — Satsuma keeps its warm
orange/peach/cream identity. The light palette in this feature is therefore
the existing token set, completed and contrast-checked, not a redesign.

## Problem

1. **Two divergent sources of truth for the dark palette.** The canonical dark
   tokens live in `tooling/satsuma-viz/src/tokens.css` (`:host([theme="dark"])`),
   but the VS Code webview never sets the `theme` attribute. Instead
   `tooling/vscode-satsuma/src/webview/viz/viz.css` re-declares the tokens under
   a `body.dark satsuma-viz` selector with *different values* (e.g.
   `--sz-text-muted: #858585` vs the canonical `#9D9D9D`; rgba washes for
   `--sz-namespace-bg` vs the canonical solid `#2D2520`; no accent or arrow
   overrides at all, so dark mode in VS Code silently keeps light-mode arrows).
   Every palette change must be made twice and drifts.

2. **No live theme switching.** The theme is sampled from
   `vscode.window.activeColorTheme.kind` only when a VizModel is loaded
   (`tooling/vscode-satsuma/src/webview/viz/panel.ts:114,198`). There is no
   `onDidChangeActiveColorTheme` subscription anywhere in the extension, so a
   user who switches VS Code theme with the viz open keeps the stale palette
   until they refresh.

3. **Hardcoded colours bypass the token system**, so neither palette fully
   applies. Known offenders in `tooling/satsuma-viz/src/`:
   - `components/sz-schema-card.ts:67` — `.header.report` uses
     `var(--sz-report, #4A90B8)`, but `--sz-report` is never defined in
     `tokens.css`; the fallback literal is the de-facto value in both themes.
   - `satsuma-viz.ts:170-174` — the overview mapping card uses a hardcoded
     navy gradient, border, and shadow with no dark variant.
   - `satsuma-viz.ts:1229-1233` — SVG edge styles hardcode `#5A9E6F` (NL
     edges), `#6B6560` (bare edges, scope labels, gear icon), and `#fff`
     (gear circle fill), ignoring `--sz-arrow-nl-stroke` and friends.
   - ~15 rgba washes across `sz-schema-card.ts` and `satsuma-viz.ts`
     (row hover/zebra `rgba(45, 42, 38, …)`, accent washes
     `rgba(242, 145, 61, …)`, `rgba(90, 158, 111, …)`) tuned for light
     backgrounds and never overridden for dark.

4. **The harness cannot exercise light mode.** The standalone harness chrome
   (`tooling/satsuma-viz-harness/src/client/index.html`) is dark-only, and the
   mounted `<satsuma-viz>` never receives a `theme` attribute — today it
   renders the *light* component palette inside dark chrome. There is no theme
   toggle, no URL parameter, no automation-contract surface, and therefore no
   Playwright coverage for theming at all.

5. **The renderer theme contract is a lossy boolean.** `isDark: boolean`
   (`tooling/vscode-satsuma/src/webview/viz/integration.ts:24,33`) is baked
   into the VizModel envelope, coupling theme to data loads and leaving no room
   for future theme kinds.

## Design Principles

1. **One palette definition.** `tooling/satsuma-viz/src/tokens.css` is the
   single source of truth for both themes. Consumers (VS Code webview,
   harness) select a theme; they never restate token values.
2. **The component owns theming; consumers own detection.** `<satsuma-viz>`
   exposes a `theme` attribute and renders correctly for it. Detecting *which*
   theme to use (VS Code theme kind, OS preference, toggle) is consumer logic.
3. **Follow the editor, no in-viz override.** In VS Code the viz always tracks
   the editor theme. No setting, no toggle — zero configuration.
4. **Keep the Satsuma identity.** The light palette is the existing warm
   cream/orange token set (per Feature 31's co-brand decision), completed and
   contrast-checked — not a re-skin and not the VS Code `--vscode-*` palette.
5. **Every colour is a named token.** No raw hex/rgba literals in component
   styles outside `tokens.css`; every token defined for light is defined for
   dark. Both rules are enforced by tests, not convention.

## Non-Goals

- Re-skinning the viz to the Equal Experts palette (explicitly rejected by
  Feature 31).
- Dedicated high-contrast palettes. `HighContrast` maps to dark and
  `HighContrastLight` maps to light; bespoke HC tokens are future work.
- Adopting VS Code `--vscode-*` theme variables inside the component. The
  component must render identically in the standalone harness, which has no
  VS Code variables (the webview's `.error-message` shell style may keep
  `--vscode-errorForeground`).
- Theming the separate field-lineage and schema-lineage webview panels
  (`tooling/vscode-satsuma/src/webview/field-lineage/`, `…/schema-lineage/`).
  They have their own `isDark` handling today; migrating them to this contract
  is a follow-up ticket, not part of this feature.
- A user-facing theme setting or toggle in the VS Code extension.

## Design

### Theme contract on `<satsuma-viz>`

The component gains a reflected `theme` property:

```typescript
/** Visual theme. Reflected to the `theme` attribute so tokens.css
 *  `:host([theme="dark"])` overrides apply. Default: "light". */
@property({ reflect: true }) theme: "light" | "dark" = "light";
```

This makes the existing `:host([theme="dark"])` selector in `tokens.css` the
*only* switching mechanism. The `body.dark satsuma-viz` override block in
`tooling/vscode-satsuma/src/webview/viz/viz.css` is deleted.

### VS Code theme mapping

`integration.ts` replaces the boolean with an explicit renderer theme type and
maps all four `ColorThemeKind` values:

| `ColorThemeKind` | value | renderer theme |
|---|---|---|
| `Light` | 1 | `light` |
| `Dark` | 2 | `dark` |
| `HighContrast` | 3 | `dark` |
| `HighContrastLight` | 4 | `light` |

```typescript
export type VizTheme = "light" | "dark";
export function vizThemeForKind(kind: ThemeKind): VizTheme;
```

The envelope field `isDark: boolean` becomes `theme: VizTheme`. (Today
`HighContrastLight` falls through to light only because the boolean check
doesn't match it — the mapping becomes intentional and documented.)

### Live theme switching

`panel.ts` subscribes to `vscode.window.onDidChangeActiveColorTheme` while the
panel is open (disposed with the panel) and posts a dedicated message,
decoupling theme from data loads:

```
{ type: "setTheme", theme: "light" | "dark" }
```

The webview entry (`viz.ts`) handles `setTheme` by assigning `vizEl.theme`.
`vizModel` messages carry `theme` too (replacing `isDark`) so the initial load
needs no second message.

### Completing the palette

New tokens close every gap found in the audit (Problem 3). Proposed values —
final values are confirmed against the screenshot gallery during review:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--sz-report` | `#4A90B8` | `#6FB3D9` | report card header (today an undefined-var fallback) |
| `--sz-overview-mapping-bg` | existing navy gradient | deepened navy gradient | overview mapping card background |
| `--sz-overview-mapping-border` | `rgba(8, 36, 52, 0.35)` | `rgba(255, 255, 255, 0.12)` | overview mapping card border |
| `--sz-edge-bare-stroke` | `#6B6560` | `#9D9D9D` | bare edges, scope labels, gear icon |
| `--sz-gear-bg` | `#FFFFFF` | `#252526` | gear circle fill on transform edges |
| `--sz-row-hover-bg` | `rgba(45, 42, 38, 0.03)` | `rgba(255, 255, 255, 0.04)` | field-row hover / zebra washes |
| `--sz-row-active-bg` | `rgba(45, 42, 38, 0.06)` | `rgba(255, 255, 255, 0.08)` | pressed/selected row washes |
| `--sz-accent-wash` | `rgba(242, 145, 61, 0.12)` | `rgba(242, 168, 96, 0.16)` | orange-tinted backgrounds |
| `--sz-green-wash` | `rgba(90, 158, 111, 0.12)` | `rgba(109, 191, 130, 0.16)` | green-tinted backgrounds |

The audit task enumerates the complete literal-by-literal list; the table
above is the known set, not a cap. SVG edge styles in `satsuma-viz.ts`
switch to `var(--sz-arrow-nl-stroke)` / new tokens.

Where `viz.css` and `tokens.css` dark values currently disagree, the
`tokens.css` value wins by default; any deliberate preference for a `viz.css`
value (e.g. the rgba namespace washes) must be promoted into `tokens.css` and
justified in the PR using before/after gallery screenshots.

**Contrast requirement:** all `--sz-text*` / background token pairs in both
themes must meet WCAG AA for normal text (4.5:1). Decorative pairings (white
on `--sz-orange` card headers) are exempt but must be ≥ 3:1.

### Harness light mode

The harness becomes the place where both themes are exercised and tested:

- **Theme resolution order:** `?theme=light|dark` URL parameter (deterministic
  for Playwright) → `prefers-color-scheme` media query → dark (current
  default).
- A **Light/Dark toggle** in the header chrome, alongside the existing
  view-mode toggles, sets the `theme` attribute on `<satsuma-viz>` and a
  `data-theme` attribute on `<body>`.
- The harness chrome CSS custom properties (`--color-bg`, `--color-surface`,
  …) gain a light variant under `body[data-theme="light"]`, including a
  light-tuned set of the `.tok-*` syntax-highlighting colours (the current
  Tokyo Night-aligned set stays for dark).
- **Automation contract:** `window.__satsumaHarness.theme` exposes the active
  theme, and toggle changes append a `theme-change` entry to
  `window.__satsumaHarness.events`.

### Test plan

1. **Token parity (unit, `tooling/satsuma-viz/test/`).** Parse `tokens.css`;
   assert every colour-bearing token declared in the `:host` light block has a
   counterpart in `:host([theme="dark"])`. Guards every future token addition.
2. **No-literal-colours (unit, `tooling/satsuma-viz/test/`).** Scan the static
   `styles` blocks of all components for hex/rgba colour literals outside an
   explicit allowlist (e.g. SVG icon detail strokes that are
   theme-independent). Fails when a new hardcoded colour sneaks in.
3. **Theme property (unit, `tooling/satsuma-viz/test/`, dom-shim).** `theme`
   defaults to `"light"` and reflects to the attribute, so the
   `:host([theme="dark"])` selector engages.
4. **Theme kind mapping (unit, `tooling/vscode-satsuma/test/viz-integration.test.js`).**
   `vizThemeForKind` maps all four `ColorThemeKind` values per the table;
   envelopes carry `theme` instead of `isDark`. Extends the existing
   `isDarkTheme` cases.
5. **Playwright (`tooling/satsuma-viz-harness/test/harness.test.ts`,
   human-in-the-loop sentinel protocol — see CLAUDE.md):**
   - `?theme=light` renders `<satsuma-viz theme="light">` with computed
     background `rgb(255, 250, 245)`; `?theme=dark` gives `rgb(30, 30, 30)`.
   - With no URL parameter, the theme follows Playwright's emulated
     `colorScheme`.
   - The toggle flips the attribute, restyles the chrome, and records a
     `theme-change` automation event.
   - Representative tokenized elements (report header, bare edge stroke)
     change computed colour between themes — proving the audit tokens apply,
     not just `--sz-bg`.
6. **Screenshot gallery (`tooling/satsuma-viz-harness/test/screenshots.spec.ts`).**
   Every named shot is captured in both themes; `manifest.json` entries gain a
   `theme` field. The gallery is the review artifact for palette sign-off.

## Phased Delivery

### Phase 1 — Tokenize all hardcoded colours

No behaviour change; pure refactor of `tooling/satsuma-viz/`.

- [ ] Audit and enumerate every colour literal in component styles (the
      Problem 3 list is the starting point, not the cap).
- [ ] Add the new tokens to `tokens.css` (light + dark) and replace literals
      with `var(--sz-…)`.
- [ ] Add the token-parity and no-literal-colours tests; both pass.
- [ ] Dark-mode gallery screenshots show no unintended visual change.

### Phase 2 — Theme contract on the component

- [ ] Add the reflected `theme` property to `<satsuma-viz>` (default
      `"light"`).
- [ ] Unit test: default value and attribute reflection.

### Phase 3 — VS Code integration

- [ ] `integration.ts`: add `VizTheme` + `vizThemeForKind`; envelopes carry
      `theme`; delete `isDarkTheme`/`isDark`.
- [ ] `panel.ts`: subscribe to `onDidChangeActiveColorTheme` (disposed with
      the panel); post `setTheme` on change.
- [ ] `viz.ts`: assign `vizEl.theme` from `vizModel` and `setTheme` messages;
      remove the `body.dark` class logic.
- [ ] `viz.css`: delete the `body.dark satsuma-viz` token block; promote any
      deliberately-kept divergent values into `tokens.css` first.
- [ ] Update `test/viz-integration.test.js` per the test plan.
- [ ] Manual check in VS Code: light theme, dark theme, switch with panel
      open, `HighContrastLight`.

### Phase 4 — Harness light mode + Playwright coverage

- [ ] Theme resolution (URL param → `prefers-color-scheme` → dark) and the
      header toggle; `theme` attribute set on `<satsuma-viz>`.
- [ ] Light variant of harness chrome custom properties and `.tok-*` syntax
      colours.
- [ ] Automation contract: `__satsumaHarness.theme` + `theme-change` events.
- [ ] Playwright tests per the test plan, run via the sentinel-file protocol.
- [ ] Screenshot gallery captures both themes; manifest gains `theme`.

## Success Criteria

1. **Single source of truth.** Both palettes are defined only in
   `tooling/satsuma-viz/src/tokens.css`; `viz.css` contains no `--sz-*`
   declarations; the parity and no-literal tests enforce this permanently.
2. **VS Code fidelity.** All four `ColorThemeKind` values map to the correct
   renderer theme, verified by unit tests.
3. **Live switching.** Changing the VS Code theme with a viz panel open
   restyles it without reload or refresh.
4. **Complete palettes.** Every visual element — including report headers,
   overview mapping cards, bare/NL edges, gear icons, and row washes —
   changes appropriately between themes; no light-tuned colour survives into
   dark mode or vice versa.
5. **Accessible light mode.** Text/background token pairs meet WCAG AA (4.5:1)
   in both themes; documented exemptions are ≥ 3:1.
6. **Testable theming.** The harness can deterministically render either theme
   via URL parameter, the automation contract exposes it, and Playwright
   asserts computed colours in both themes.
7. **Review artifact.** The screenshot gallery covers every named shot in both
   themes for human/VLM palette sign-off.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Converging `viz.css` dark values onto `tokens.css` changes dark-mode appearance in VS Code | Users see subtle dark-theme shifts | Phase 1 + 3 gallery screenshots reviewed before/after; deliberate keeps promoted into `tokens.css` |
| rgba washes tuned for light look muddy on dark backgrounds | Poor dark-mode contrast on hover/zebra rows | Dark-specific wash values (white-based rgba); gallery review |
| Playwright runs are human-in-the-loop only (ARM macOS sandbox) | Slower verification loop | Sentinel-file protocol already established; unit tests cover everything not requiring a browser |
| White-on-orange card headers fail strict AA | Accessibility complaint | Documented ≥ 3:1 decorative exemption; revisit under a future HC feature |
| `setTheme` racing the initial `vizModel` message | Brief theme flash on load | `vizModel` carries `theme`; `setTheme` only fires on change events |

## Dependencies

- `tooling/satsuma-viz/src/tokens.css` token structure (Feature 23).
- Harness automation contract and sentinel-file Playwright workflow
  (Feature 29/30).
- Feature 31's co-brand decision (palette identity stays).
- VS Code API: `vscode.window.onDidChangeActiveColorTheme`,
  `ColorThemeKind` (all current values exist since VS Code 1.56).

## File Locations

| Artifact | Path | Change |
|---|---|---|
| Design tokens (both palettes) | `tooling/satsuma-viz/src/tokens.css` | new tokens; canonical values |
| Viz component root | `tooling/satsuma-viz/src/satsuma-viz.ts` | `theme` property; literals → tokens |
| Schema card | `tooling/satsuma-viz/src/components/sz-schema-card.ts` | literals → tokens |
| Token parity / no-literal / theme tests | `tooling/satsuma-viz/test/theme.test.js` | new |
| Host-side theme mapping | `tooling/vscode-satsuma/src/webview/viz/integration.ts` | `VizTheme`, `vizThemeForKind`, envelope change |
| Panel (theme subscription) | `tooling/vscode-satsuma/src/webview/viz/panel.ts` | `onDidChangeActiveColorTheme` → `setTheme` |
| Webview entry | `tooling/vscode-satsuma/src/webview/viz/viz.ts` | assign `vizEl.theme`; drop `body.dark` |
| Webview shell styles | `tooling/vscode-satsuma/src/webview/viz/viz.css` | delete token override block |
| Theme mapping tests | `tooling/vscode-satsuma/test/viz-integration.test.js` | extend |
| Harness chrome + toggle | `tooling/satsuma-viz-harness/src/client/index.html`, `app.ts` | light variant, toggle, URL param, contract |
| Harness Playwright tests | `tooling/satsuma-viz-harness/test/harness.test.ts` | theme test group |
| Screenshot gallery | `tooling/satsuma-viz-harness/test/screenshots.spec.ts` | both-theme capture; manifest `theme` field |

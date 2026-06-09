# ADR-026 — Viz Theme Contract: Component Owns Rendering, Consumers Select

**Status:** Accepted
**Date:** 2026-06-09 (sl-wyr1)

## Context

The mapping visualization (`tooling/satsuma-viz/`, see ADR-012) ships a warm
cream/orange light palette as the `:host` defaults in
`tooling/satsuma-viz/src/tokens.css`, with dark overrides under
`:host([theme="dark"])`. Before Feature 32, the theming story around those
tokens was incomplete and had drifted into two sources of truth.

The VS Code webview never set the component's `theme` attribute. Instead
`tooling/vscode-satsuma/src/webview/viz/viz.css` re-declared the dark tokens
under a `body.dark satsuma-viz` selector with *different* values than
`tokens.css` (e.g. `--sz-text-muted: #858585` vs the canonical `#9D9D9D`), so
every palette change had to be made twice and the two copies diverged. The host
side carried theme as a lossy `isDark: boolean` baked into the VizModel
envelope, coupling theme to data loads, and there was no
`onDidChangeActiveColorTheme` subscription, so switching the editor theme with a
panel open left a stale palette until refresh. The standalone harness was
dark-only and could not exercise or test light mode at all.

Two structural questions had to be answered. First, *who owns theming* — should
each consumer (VS Code webview, harness) restate token values, or should the
component be the single styled surface? Second, *how is the palette selected* —
via a class/attribute on an ancestor, via consumer-side CSS overrides, or via a
property on the component itself. Letting consumers override tokens (the
`body.dark` approach) was the status quo and was explicitly rejected because it
had already produced drift. Adopting VS Code `--vscode-*` variables inside the
component was rejected because the component must render identically in the
standalone harness, which has no VS Code variables.

## Decision

The component owns theming; consumers own detection. `<satsuma-viz>` exposes a
reflected `theme: "light" | "dark"` property (default `"light"`) in
`tooling/satsuma-viz/src/satsuma-viz.ts`. Reflection to the `theme` attribute is
the *only* palette-switching mechanism: it engages the `:host([theme="dark"])`
block in `tokens.css`, which is the single source of truth for both palettes.
Consumers never restate token values — they detect which theme to use and assign
the property.

Token values are defined once, on the `<satsuma-viz>` host, and inherited.
Nested component shadow roots (schema cards, edge layers, mapping detail) must
**not** inject `tokens.css` into their own styles; CSS custom properties pierce
shadow boundaries, so they inherit the host's themed values. Injecting the
tokens locally pins the light `:host` defaults onto a nested host that never
carries `theme="dark"`, freezing that subtree in light mode — the defect fixed
for the edge layers in this feature. Two test guards in
`tooling/satsuma-viz/test/theme.test.js` enforce the contract permanently: every
colour-bearing light token must have a dark counterpart, and no raw colour
literal may appear in component styles outside `tokens.css`.

Consumers detect and select. In VS Code, `vizThemeForKind` in
`tooling/vscode-satsuma/src/webview/viz/integration.ts` maps every
`ColorThemeKind` to a `VizTheme`; the envelope carries `theme` instead of
`isDark`; and `panel.ts` subscribes to `onDidChangeActiveColorTheme` and posts a
dedicated `{ type: "setTheme", theme }` message (decoupled from data loads) so an
open panel restyles live. The standalone harness resolves its theme from a
`?theme=` URL parameter, then `prefers-color-scheme`, then dark, and exposes it
on the automation contract for Playwright.

## Consequences

**Positive:**
- Both palettes are defined exactly once, in `tokens.css`; the parity and
  no-literal tests make drift a build failure rather than a review catch.
- Theme is decoupled from data: live editor-theme changes restyle an open VS
  Code panel without a reload, and theme no longer rides inside the VizModel
  envelope.
- The component renders identically in any host (VS Code, harness, a bare embed)
  because it depends on its own `theme` attribute, not host-specific variables.
- Nested components inherit the palette automatically, so a new sub-component is
  themed correctly by default as long as it does not re-inject the tokens.

**Negative:**
- A nested component that injects `tokens.css` into its own shadow root silently
  breaks dark mode for its subtree; the rule is enforced by code review and the
  audit-token Playwright test rather than by the type system.
- High-contrast VS Code themes fold into the nearest base palette
  (`HighContrast` → dark, `HighContrastLight` → light); a dedicated
  high-contrast palette is deferred future work.
- The separate field-lineage and schema-lineage webview panels still use their
  own `isDark` handling and do not yet follow this contract; migrating them is a
  tracked follow-up.

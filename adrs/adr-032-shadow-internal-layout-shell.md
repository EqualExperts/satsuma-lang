# ADR-032 — Shadow-Internal Shell Owns Component Layout, Not :host

**Status:** Accepted
**Date:** 2026-06-12 (fmo-fghl)

## Context

The `<satsuma-viz>` component sized itself entirely through `:host` styles:
`display: flex; flex-direction: column; height: 100%; overflow: hidden`. Its
internal sizing chain depends on that flex context — `.view-content`,
`.notes-pane-wrapper`, and `.viewport` each declare `flex: 1; min-height: 0`
so the pannable viewport is clamped to the visible panel and overlays anchored
to it (the minimap, the zoom indicator) stay on-screen.

`:host` styles, however, are only defaults. The CSS scoping rules give
outer-document rules that target the host element priority over `:host` rules
declared inside the shadow tree, regardless of specificity. Both real
consumers do exactly that: the VS Code webview shell
(`tooling/vscode-satsuma/src/webview/viz/viz.css`) and the playground
(`tooling/satsuma-viz-harness/src/client/index.html`) declare
`satsuma-viz { display: block; ... }`. That single `display: block` silently
replaced the host's `display: flex`, collapsing the entire internal flex
chain: `.viewport` grew to its content height instead of the panel height,
and the bottom-anchored minimap rendered thousands of pixels below the
clipped fold — invisible in overview mode, and mid-canvas in the playground
(see the pointer-interception workarounds in
`tooling/satsuma-viz-harness/test/view-persistence.test.ts`).

Alternatives considered: (a) fixing every consumer stylesheet — rejected as
fragile, since any future consumer (or a VS Code theme injection) can
reintroduce the override, and the component has no way to detect or prevent
it; (b) documenting a required consumer CSS contract — rejected because a
contract that fails silently with no error is not a contract.

## Decision

The component's layout contract lives on a shadow-internal wrapper, not on
`:host`. `SatsumaViz.render()` wraps every branch (content, empty, loading,
fallback) in `<div class="viz-shell">`, and `.viz-shell` carries the column
flex layout (`display: flex; flex-direction: column; height: 100%;
overflow: hidden`). Shadow-internal nodes cannot be targeted by consumer
stylesheets, so the sizing chain holds regardless of how the host element is
styled. The `:host` rules are retained as the sizing default for consumers
that do not restyle the host, but nothing inside the component may depend on
them.

The rule for future work: any style a `satsuma-*` component *requires* for
correct behaviour must be declared on an element inside its shadow root.
`:host` may carry only styles that are safe for a consumer to override
(background, typography, default sizing).

## Consequences

**Positive:**

- Consumer pages can style the host element freely (`display`, `width`,
  `height`) without breaking internal layout — the failure mode is gone by
  construction, not by convention.
- The minimap, Fit math, and pan/zoom clamping all read `.viewport` client
  dimensions; these are now correct in every consumer, fixing minimap
  visibility in the VS Code webview and the playground alike.

**Negative:**

- One extra wrapper div in the shadow DOM, and `height: 100%` on the shell
  still requires the host to receive a definite height from the consumer —
  a host left entirely unsized degrades to content height as before.
- Existing `:host`-level layout styles remain as defaults, so readers see
  the layout declared twice; the `.viz-shell` comment in
  `tooling/satsuma-viz/src/satsuma-viz.ts` is the canonical explanation.

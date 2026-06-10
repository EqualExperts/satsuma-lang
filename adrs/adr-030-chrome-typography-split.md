# ADR-030 — Brand Typography Split: Lexend Chrome, Component Stack Unchanged

**Status:** Accepted
**Date:** 2026-06-10 (sl-ga3c, feature 34)

## Context

The Equal Experts brand guide
(`assets/ee-brand/brand-guidelines-summary.md`) names **Lexend** as the
primary font family. Until feature 34 the public playground used no Lexend
anywhere: the harness chrome inherited JetBrains Mono from a `font-family`
set on `html, body`, and the viz component's sans token
(`--sz-font-sans` in `tooling/satsuma-viz/src/tokens.css`) declared an
Inter/system stack. Feature 31 had deliberately left EE typography out of
scope ("co-brand, do not re-skin"); the user reversed that for the
playground surface during the feature 34 review.

Adopting Lexend raised two scope questions. *How is the font delivered?* The
playground's core promise is that nothing leaves the browser ("local-only —
your source is never uploaded"), and its static build is validated to make
no requests outside its own base path — a Google Fonts CDN reference would
break both the promise's spirit and the network-isolation tests. *How far
does Lexend reach?* Switching the component's `--sz-font-sans` would change
typography inside `<satsuma-viz>` everywhere it is embedded — including the
VS Code webview, which has its own design context — and would invalidate the
`elk-layout.ts` character-width estimation constants that were re-tuned in
this same feature (ADR-029), forcing a re-tune nobody had reviewed visually.

## Decision

The playground **chrome** adopts Lexend; the **component does not**.

Delivery: a single self-hosted variable-weight latin subset
(`tooling/satsuma-viz-harness/src/client/fonts/lexend-latin.woff2`, weights
300–600 covering the brand's Light/Normal/Medium, with its SIL OFL 1.1
licence committed alongside) is copied into the client bundle at build time
(`build:fonts`), served same-origin by the dev server, and shipped in the
static playground bundle. No font may be fetched cross-origin; a Playwright
test (`chrome.test.ts`) asserts every font request stays same-origin.

Scope: `html, body` in the harness switches to `--font-sans` (Lexend),
which chrome text inherits. Code surfaces — the overlay editor's two
`.code-layer` elements and any other code-like text — pin `--font-mono`
(JetBrains Mono) explicitly and are unaffected; their glyph geometry must
stay identical across both editor layers for caret alignment. The viz
component's `--sz-font-sans` keeps its Inter/system stack. Adopting Lexend
*inside* the component is a separate, design-reviewed decision: it changes
the VS Code webview's appearance and requires re-tuning the layout
char-width constants in step (per ADR-029's contract this would be one
coordinated change, but it was not part of this feature's mandate).

## Consequences

**Positive:**

- The public surface follows the EE brand guide without any third-party
  network dependency; the playground's zero-external-requests property is
  preserved and test-enforced.
- One variable font file (~39 KB) covers all brand weights — no per-weight
  fetches, no FOUT beyond `font-display: swap`.
- The component remains visually identical in every existing embedding
  (VS Code webview, harness), so no cross-surface re-review was needed.

**Negative:**

- Typography is now split by surface: chrome is Lexend, the visualization's
  sans text is not. If the brand later requires Lexend inside the
  visualization, that change must update `--sz-font-sans`, the VS Code
  webview review, and the `elk-layout.ts` char-width constants together.
- Only the latin subset ships; non-latin text in chrome falls back to the
  system stack.
- The committed font binary must be refreshed manually if Lexend ships
  glyph fixes (no package-manager update path).

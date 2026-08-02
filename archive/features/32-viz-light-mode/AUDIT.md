# Feature 32 — Phase 1 Colour-Literal Audit

> Artifact for Task 1 ("Audit colour literals in satsuma-viz"). Records every
> hex/rgba/gradient colour literal that existed in `tooling/satsuma-viz/src/`
> component styles, its classification, and the token it now resolves to.
> Task 2 acted on this audit: every literal below is now a `var(--sz-…)`
> reference, enforced permanently by `test/theme.test.js`.

## Method

- Scanned all `static styles = css\`…\`` blocks and inline SVG styles in
  `satsuma-viz.ts`, `components/`, and `edges/`.
- Cross-checked against `tokens.css` to find literals that were already token
  *fallbacks* (`var(--x, <literal>)`) versus literals hardcoded with no token.
- Verified post-refactor that no colour literal survives outside `tokens.css`
  (`grep` + the no-literal-colours test) and that no referenced colour token is
  undefined.

## Classification

### A. Literals that were redundant token fallbacks (fallback removed)

These already pointed at a defined token; the trailing literal was dead unless
the token was missing. The fallback is removed so `tokens.css` is the only
source. Light values below are byte-identical to the removed fallbacks, so
light mode is unchanged.

| Literal (light) | Token |
|---|---|
| `#FFFAF5` | `--sz-bg` |
| `#fff` (card/gear fills) | `--sz-card-bg` / `--sz-gear-bg` |
| `#2D2A26` | `--sz-text` |
| `#6B6560` | `--sz-text-muted`, `--sz-edge-bare-stroke` |
| `#F2913D` | `--sz-orange` |
| `#D97726` | `--sz-orange-dark`, `--sz-arrow-stroke` |
| `#5A9E6F` | `--sz-green` / `--sz-arrow-nl-stroke` |
| `#8E5BB0` | `--sz-violet` |
| `#C45D22` | `--sz-warning` / `--sz-warning-icon` |
| `#4A8A5B` | `--sz-at-ref` |
| `#4A4744` | `--sz-edge-default` |
| `#FFF3E8` | `--sz-namespace-bg`, `--sz-badge-bg` |
| `#FEF3CD` | `--sz-warning-bg` |
| `#E8F0FE` | `--sz-question-bg` |
| `#7C6BAE` | `--sz-question-icon` |
| `#DCECF6` | `--sz-namespace-pill-bg` |
| `#0A354C` | `--sz-namespace-pill-text` |
| `rgba(45,42,38,0.08)` | `--sz-card-border` |
| `rgba(45,42,38,0.15)` | `--sz-card-border-strong` |
| `rgba(45,42,38,0.06)` | (card shadow) `--sz-card-shadow` |
| `rgba(196,93,34,0.2 / 0.3)` | `--sz-warning-border-soft` / `-strong` |
| `rgba(124,107,174,0.2 / 0.3)` | `--sz-question-border-soft` / `-strong` |
| `rgba(255,255,255,0.6)` | `--sz-icon-overlay-soft` |
| `rgba(0,0,0,0.2)` | `--sz-icon-divider` |
| `rgba(255,255,255,0.88)` | `--sz-namespace-pill-chip-bg` |

### B. Hardcoded literals promoted to new tokens (no token existed)

These had no token at all and were the gaps called out in PRD Problem 3. New
light + dark tokens were added to `tokens.css`.

| Literal (light) | New token | Used for |
|---|---|---|
| `#4A90B8` | `--sz-report` | report card header (was an undefined-var fallback `var(--sz-report, #4A90B8)`) |
| `linear-gradient(135deg, rgba(16,80,104,.98), rgba(10,53,76,.98))` | `--sz-overview-mapping-bg` | overview mapping card background |
| `linear-gradient(45deg, rgba(255,255,255,.06), rgba(255,255,255,0))` | `--sz-overview-mapping-gloss` | overview mapping card gloss |
| `rgba(8,36,52,0.35)` | `--sz-overview-mapping-border` | overview mapping card border |
| `0 8px 20px rgba(10,53,76,0.18)` | `--sz-overview-mapping-shadow` | overview mapping card shadow |
| `rgba(217,119,38,0.4)` | `--sz-edge-highlight-glow` | highlighted overview edge drop-shadow |
| `rgba(45,42,38,0.03)` | `--sz-row-hover-bg` | field-row hover / zebra wash |
| `rgba(45,42,38,0.05 / 0.06)` | `--sz-row-active-bg` | pressed/selected row wash |
| `rgba(242,145,61,0.12)` | `--sz-accent-wash` | orange-tinted backgrounds |
| `rgba(90,158,111,0.12)` | `--sz-green-wash` | green-tinted backgrounds |

### C. Theme-independent allowlist

**Empty.** No colour literal in component styles is genuinely
theme-independent — every one mapped to a token (A) or became one (B). The
no-literal-colours test therefore runs with no allowlist; any future literal
fails the build.

## Defect found and fixed during the audit

`--sz-edge-nl` was referenced in `edges/sz-edge-layer.ts` and
`edges/sz-overview-edge-layer.ts` but **never defined** in `tokens.css` — it
was only ever an undefined-var fallback (`var(--sz-edge-nl, #5A9E6F)`), exactly
like `--sz-report`. The partial refactor stripped the fallback, which would
have left NL edges uncoloured. Fixed by pointing all three references at the
canonical `--sz-arrow-nl-stroke` (`#5A9E6F` light / `#6DBF82` dark), per the
PRD ("SVG edge styles … switch to `var(--sz-arrow-nl-stroke)`").

## `viz.css` reconciliation

Deferred to Phase 3 as the PRD sequences it. The divergent
`body.dark satsuma-viz` block in `vscode-satsuma/src/webview/viz/viz.css` is
untouched here; promoting/deleting it is Task 4's work. This audit only
establishes that `tokens.css` now holds canonical values for every component
literal.

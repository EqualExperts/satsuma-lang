# Feature 32 — Viz Light Mode: Task Breakdown

Epic: _(tk epic to be created on PRD approval)_

Tasks map 1:1 to PRD phases plus an audit task. tk ticket IDs are added next
to each task title when the tickets are created.

## Suggested Dependency Order

1. Audit colour literals (task 1)
2. Tokenize hardcoded colours + guard tests (task 2)
3. Theme contract on the component (task 3)
4. VS Code integration (task 4) and harness light mode (task 5) — parallel
5. Playwright theme coverage + both-theme gallery (task 6)

---

### 1. Audit colour literals in satsuma-viz — ✅ done (see `AUDIT.md`)

Enumerate every hex/rgba colour literal in `tooling/satsuma-viz/src/`
component styles, classify each (needs a new token / maps to an existing
token / theme-independent allowlist), and propose dark-mode values for the
new tokens.

Scope:
- all `static styles` blocks and inline SVG styles in `satsuma-viz.ts`,
  `components/`, `edges/`
- reconcile the divergent `viz.css` dark values against `tokens.css`
  (PRD: "Completing the palette" — tokens.css wins unless promoted)

Acceptance criteria:
- audit notes added to this directory listing every literal with file:line,
  its classification, and proposed light/dark token values
- the allowlist (theme-independent literals) is explicit and justified

PRD reference:
- Problem (3)
- Design / Completing the palette

### 2. Tokenize hardcoded colours and add guard tests — ✅ done

Implement Phase 1: add the new tokens to `tokens.css` (light + dark),
replace literals per the audit, and add the token-parity and
no-literal-colours tests.

Scope:
- `tooling/satsuma-viz/src/tokens.css`, `satsuma-viz.ts`,
  `components/sz-schema-card.ts`, edge layers
- new `tooling/satsuma-viz/test/theme.test.js`

Acceptance criteria:
- no colour literal outside `tokens.css` except the documented allowlist
- token-parity test passes: every colour token in the light block has a dark
  counterpart
- dark-mode gallery screenshots show no unintended visual change

PRD reference:
- Phase 1
- Test plan (1, 2)

### 3. Theme contract on `<satsuma-viz>`

Implement Phase 2: reflected `theme` property, default `"light"`.

Acceptance criteria:
- `theme` reflects to the attribute so `:host([theme="dark"])` engages
- unit tests for default value and reflection (dom-shim)

PRD reference:
- Design / Theme contract
- Phase 2; Test plan (3)

### 4. VS Code theme integration with live switching

Implement Phase 3: `VizTheme` + `vizThemeForKind`, `theme` in envelopes,
`onDidChangeActiveColorTheme` → `setTheme` message, webview assigns
`vizEl.theme`, delete the `viz.css` token override block.

Acceptance criteria:
- all four `ColorThemeKind` values map per the PRD table (unit tested)
- switching VS Code theme with a panel open restyles it without reload
- `viz.css` contains no `--sz-*` declarations
- manual verification notes for light / dark / live-switch /
  `HighContrastLight` recorded in the ticket

PRD reference:
- Design / VS Code theme mapping, Live theme switching
- Phase 3; Test plan (4)

### 5. Harness light mode

Implement Phase 4 chrome work: theme resolution (URL param →
`prefers-color-scheme` → dark), header toggle, light chrome variant
including light `.tok-*` syntax colours, `theme` attribute on the component,
automation contract (`__satsumaHarness.theme`, `theme-change` events).

Acceptance criteria:
- `?theme=light|dark` deterministically selects the theme
- toggle restyles chrome + component and records an automation event
- syntax highlighting is readable in both themes

PRD reference:
- Design / Harness light mode
- Phase 4

### 6. Playwright theme coverage and both-theme gallery

Add the theme test group to `harness.test.ts` and capture every named
gallery shot in both themes with a `theme` manifest field.

Acceptance criteria:
- computed-colour assertions for both themes, including representative
  audit tokens (report header, bare edge stroke), pass via the
  sentinel-file protocol
- `screenshots/manifest.json` entries carry `theme`; both-theme gallery
  reviewed for palette sign-off

PRD reference:
- Test plan (5, 6)
- Phase 4; Success criteria (6, 7)

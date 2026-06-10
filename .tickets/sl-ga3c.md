---
id: sl-ga3c
status: open
deps: [sl-wixe, sl-dw9x]
links: []
created: 2026-06-10T07:19:57Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-ubbp
tags: [playground, branding]
---
# Lexend typography for playground headings and chrome (R8)

EE brand guide (assets/ee-brand/brand-guidelines-summary.md) names Lexend as the primary font. The harness chrome sets JetBrains Mono on html,body (index.html:96-100) so all headings/buttons render monospace; viz sans token is Inter (tokens.css:64). Adopt Lexend (Normal/Medium/Light) for chrome text, self-hosted/subsetted — the static playground must make no third-party font requests. Code-like content stays JetBrains Mono. Decide and record whether --sz-font-sans switches to Lexend (affects VS Code webview and elk-layout char-width constants — coordinate with R2/R7). Note: Feature 31 left EE typography out of scope; user reversed that for the playground on 2026-06-10. See PRD P8/R8.

## Acceptance Criteria

Header, panel labels, toolbar buttons render in Lexend; source editor and field/type text remain JetBrains Mono; static bundle loads no cross-origin font resources (Playwright assertion); --sz-font-sans decision recorded in the ticket notes and, if changed, char-width constants re-tuned.


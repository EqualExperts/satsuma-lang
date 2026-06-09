---
id: sl-wxac
status: closed
deps: []
links: []
created: 2026-06-09T20:43:00Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-wyr1
---
# Feature 32 Phase 4: harness light mode

## Acceptance Criteria

?theme=light|dark deterministic; prefers-color-scheme fallback; header toggle restyles chrome+component; light .tok-* colours; __satsumaHarness.theme + theme-change events


## Notes

**2026-06-09T21:15:49Z**

Harness light mode: chrome colours + .tok-* syntax colours moved to CSS variables with a light variant under body[data-theme=light]; added a Light/Dark header toggle; theme resolution ?theme= → prefers-color-scheme → dark; __satsumaHarness.theme + theme-change events. Also fixed a latent server bug: the GET / → /index.html redirect dropped the query string, making ?theme= (and ?fixture=/?mode=) silent no-ops — now preserved. Verified via Playwright (all theme tests pass).

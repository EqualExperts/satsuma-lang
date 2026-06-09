---
id: sl-go45
status: closed
deps: [sl-o05i]
links: []
created: 2026-06-09T20:43:00Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-wyr1
---
# Feature 32 Phase 3: VS Code theme integration with live switching

## Acceptance Criteria

VizTheme+vizThemeForKind maps all four ColorThemeKind; envelopes carry theme; onDidChangeActiveColorTheme posts setTheme; viz.css has no --sz-* decls; tests updated


## Notes

**2026-06-09T20:47:56Z**

Cause: theme was a lossy isDark boolean sampled only at data-load time, and viz.css re-declared a drifted dark palette under body.dark — two sources of truth, no live switching. Fix: replaced isDark with VizTheme + vizThemeForKind (all four ColorThemeKind values mapped, default dark); envelopes and the vizModel/expandedModels messages carry theme; panel.ts subscribes to onDidChangeActiveColorTheme and posts a dedicated setTheme message (disposed with the panel); viz.ts assigns vizEl.theme and the body.dark token block was deleted from viz.css. Unit tests cover the full mapping + envelope shape. NOTE: manual VS Code GUI verification (light/dark/live-switch/HighContrastLight) still needs a human Extension-Host run — cannot be exercised in the agent sandbox.

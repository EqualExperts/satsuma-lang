---
id: sl-o05i
status: closed
deps: []
links: []
created: 2026-06-09T20:43:00Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-wyr1
---
# Feature 32 Phase 2: theme contract on <satsuma-viz>

## Acceptance Criteria

reflected theme property defaults to light; :host([theme=dark]) engages; unit tests for default + reflection


## Notes

**2026-06-09T20:44:51Z**

Cause: the <satsuma-viz> component had no theme contract; the light palette in tokens.css worked only by accident because no consumer set a theme attribute. Fix: added a reflected `theme` property (default "light") to SatsumaViz so :host([theme="dark"]) is the single switching mechanism, plus unit tests for the default value and the reflection contract (commit pending).

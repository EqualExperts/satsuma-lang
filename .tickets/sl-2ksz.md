---
id: sl-2ksz
status: in_progress
deps: []
links: []
created: 2026-06-10T07:18:28Z
type: bug
priority: 1
assignee: Thorben Louw
parent: sl-ubbp
tags: [viz, live-editor]
---
# Preserve viz view state across model updates (R1)

Any source edit resets <satsuma-viz> to the overview: updated() at tooling/satsuma-viz/src/satsuma-viz.ts:852-858 unconditionally sets _viewMode='overview' and clears _selectedMapping on every model change. Under live editing this is hostile. See PRD P1/R1.

## Acceptance Criteria

Detail view survives a model update when the selected mapping id still exists (re-bound to the new model object); graceful fallback to overview when the mapping was renamed/deleted; _expandedModels/compact expansions preserved by id on the same basis; Playwright tests for both paths.


## Notes

**2026-06-10T07:36:08Z**

Implemented: model-change reconciliation in satsuma-viz. _reconcileViewState keeps detail view open by re-binding _selectedMapping via a namespace+id key (_selectedMappingKey) captured at selection time; prunes _expandedModels/_compactExpandedIds to ids that still exist; falls back to overview when the mapping is gone. Unit tests in test/view-state.test.js (5 cases, 53/53 green); Playwright spec test/view-persistence.test.ts pending a watcher run (sandbox cannot launch browsers).

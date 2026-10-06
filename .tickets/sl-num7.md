---
id: sl-num7
status: closed
deps: []
links: []
created: 2026-03-26T07:18:41Z
type: task
priority: 2
assignee: Thorben Louw
parent: sc-k40o
tags: [docs, feature-22]
---
# Migrate merge-strategy docs from single quotes to backticks

docs/conventions-for-merge-strategy/README.md (5 blocks) and LLM-Guidelines.md (4 blocks) all use single-quote labels which were removed in Feature 22 Phase 4. Migrate to backtick labels.

## Acceptance Criteria

- All 9 stm blocks in merge-strategy docs use backtick labels
- All blocks validate without parse errors
- Doc narrative updated if needed

## Notes

**2026-03-26T08:30:00Z**

Cause: 9 stm blocks in merge-strategy docs used single-quote labels removed in Feature 22 Phase 4.
Fix: Replaced all `'label'` with `` `label` `` backtick labels. All 9 blocks validate with 0 errors.

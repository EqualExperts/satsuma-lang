---
id: sc-1tcm
status: closed
deps: []
links: []
created: 2026-03-26T07:01:13Z
type: task
priority: 2
assignee: Thorben Louw
tags: [testing, feature-22, hygiene]
---
# Audit test corpus for Feature 22 simplification redundancies

Feature 22 simplified the grammar (collapsed metadata value forms, unified quoting to backtick-only, added @ref, removed single quotes, simplified pipe steps). Some existing tests may now be redundant, test removed syntax, or no longer make sense post-simplification. Audit the full test suite (824 tests across integration, bug-purge, unit tests) and the tree-sitter corpus (482 cases) for: tests that validate removed syntax (single quotes, old kv_value forms), tests whose assertions no longer match the simplified behavior, snapshot expectations that reflect pre-simplification output, and corpus cases that test grammar rules that were collapsed or removed.

## Acceptance Criteria

- All test files in tooling/satsuma-cli/test/ audited
- All corpus files in tooling/tree-sitter-satsuma/test/corpus/ audited
- Redundant or invalid tests identified and either removed or updated
- No tests remain that validate removed v1/pre-Feature-22 syntax
- All remaining tests pass
- Test count may decrease — that is expected and acceptable

## Notes

**2026-03-26T12:00:00Z**

Cause: Feature 22 grammar simplification removed node types (token_call, arithmetic_step, kv_value forms, quoted_name) but left 5 corpus test titles and 3 CLI test titles referencing the old concepts. No test code or assertions referenced removed node types — the test suite had been properly updated during the simplification, only the descriptive titles lagged.

Fix: Renamed 5 corpus test titles (transforms.txt ×4, pipeline_extensions.txt ×1) and 3 CLI test titles (arrow-extract.test.js, integration.test.js, format.test.js) from pre-simplification terminology (token_call, arithmetic steps) to current grammar concepts (identifier pipeline, pipe step, arithmetic operators). All 824 CLI tests and 266 corpus tests pass. No tests needed removal — all validate distinct, valuable input patterns.


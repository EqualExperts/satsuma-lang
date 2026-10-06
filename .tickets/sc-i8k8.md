---
id: sc-i8k8
status: closed
deps: []
links: []
created: 2026-03-26T06:50:38Z
type: task
priority: 2
assignee: Thorben Louw
tags: [testing, hygiene]
---
# Audit tests that depend on canonical examples having errors/warnings

Tests should never depend on canonical example .stm files having validation errors or warnings. Examples are the gold standard of correct Satsuma — if a test needs a warning or error condition, it should use a dedicated fixture in test/fixtures/. One instance was already fixed (sl-5dyc import warning test moved to missing-import.stm fixture). Audit all tests that use EXAMPLES paths and verify none assert on error/warning conditions from canonical examples.

## Acceptance Criteria

- All tests using resolve(EXAMPLES, ...) audited
- Any test asserting on warnings/errors from canonical examples migrated to dedicated fixtures
- Canonical examples remain clean demonstration files with no test-required defects
- All tests pass after migration

## Notes

**2026-03-26T12:00:00Z**

Cause: Concern that tests might depend on canonical examples having validation errors or warnings, making examples serve double duty as error fixtures.

Fix: Audited all 60+ references to EXAMPLES paths across integration.test.js, arrow-extract.test.js, format.test.js, bug-purge.test.js, and graph.test.js. Every test using canonical examples either (a) asserts clean validation (`no issues`, exit 0), (b) tests structural output (schema fields, arrow extraction, formatting), or (c) tests comment display features (//! //? appearing in output). All warning/error assertion tests already use dedicated fixtures in test/fixtures/ (parse-error.stm, metric-bad-source.stm, undefined-spread.stm, missing-import.stm, etc.). No remediation needed — the prior fix (sl-5dyc) was the last remaining case.


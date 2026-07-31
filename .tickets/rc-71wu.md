---
id: rc-71wu
status: closed
deps: []
links: []
created: 2026-07-31T08:54:36Z
type: bug
priority: 3
assignee: Thorben Louw
---
# Fix stm_to_excel integration tests: fixture path examples/sfdc_to_snowflake.stm no longer exists

skills/satsuma-to-excel/scripts/test_stm_to_excel.py integration tests (TestIntegrationSfdc, TestIntegrationDbToDb, TestIntegrationFragments, TestIntegrationOptions) reference example files like examples/sfdc_to_snowflake.stm that were renamed/restructured (corpus now has examples/sfdc-to-snowflake/). 4 failed + 16 errors, pre-existing on main, not run in CI. Found during sl-5kvp.

## Acceptance Criteria

python3 -m pytest skills/satsuma-to-excel/scripts/test_stm_to_excel.py passes; decide whether these integration tests should run in CI


## Notes

**2026-07-31T09:25:18Z**

Cause: The example corpus was restructured from flat files (`examples/db-to-db.stm`, `examples/sfdc_to_snowflake.stm`) into per-example directories (`examples/db-to-db/pipeline.stm`, `examples/sfdc-to-snowflake/pipeline.stm`), and the extractor later gained NL-ref source expansion — so the skill's integration tests had stale fixture paths and stale mapping-row counts, and no CI job ran them.
Fix: Updated the four fixture paths and the two arrow-count assertions (30 = 19 explicit + 11 NL-ref rows for db-to-db; 12 = 10 + 2 for sfdc) with comments documenting the breakdown, and added a `stm-to-excel-skill` CI job (global CLI install + pytest, wired into test-report) so the suite now runs in CI. Also untracked accidentally committed `__pycache__` .pyc files and generalized the `.gitignore` rule.

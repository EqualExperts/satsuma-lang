---
id: rc-71wu
status: open
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


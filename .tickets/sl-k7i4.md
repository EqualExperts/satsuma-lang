---
id: sl-k7i4
status: open
deps: []
links: [lgc-4bxl]
created: 2026-08-03T12:30:52Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [viz, ui]
---
# viz mapping detail: sourceless derived arrows render an indistinguishable empty Source cell

Satsuma allows a target-only arrow with no source field -- e.g. '-> is_closed { "True if @StageName is Closed_Won or Closed_Lost, false otherwise." }' in examples/sfdc-to-snowflake/pipeline.stm. In the mapping detail arrow table this renders as a completely blank Source cell, visually identical to a rendering failure. Nothing marks it as a deliberate derived value.

Observed in the opportunity-ingestion detail view: the Source column reads Id, AccountId, Name, Amount, Amount, ARR_Override__c, StageName, <blank>, CloseDate, SystemModStamp. A reader cannot tell the blank row from a dropped source path, and the two consecutive 'Amount' rows just above it (legitimately two arrows off the same source) make the column look unreliable.

Sourceless arrows are a first-class construct, so they deserve a first-class presentation.

## Acceptance Criteria

- An arrow with no source field renders an explicit marker in the Source cell (e.g. a muted 'derived' label) rather than empty space.
- The marker is visually distinct from a real field path and does not read as a field name.
- A test asserts the marker for a minimal sourceless-arrow snippet.
- Arrows that do have sources are unchanged.


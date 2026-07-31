---
id: sl-hcan
status: open
deps: [sl-0pun]
links: []
created: 2026-07-31T14:44:00Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, vscode, viz, core]
---
# viz: schema card counts containers in its coverage ratio, disagreeing with satsuma coverage

PRD 38 R3, viz half. ADR-034 (Accepted) settles the rule — coverage counts leaf fields only, on each leaf's own flag — and states plainly that "consumers must not compute their own coverage denominators". Two consumers still do. The VS Code status bar half is already raised as 3cc-t6uo (on branch feat/35-coverage-command); this ticket is the viz half, which that ticket does not cover.

The three conventions shipping today:
1. VS Code status bar (vscode-satsuma/src/commands/coverage-logic.ts:78-86) counts TOP-LEVEL fields only via filter(f => !f.path.includes('.')), so a record is in the denominator and its leaves are not — 'address record {line1,line2,line3}' with only line1 mapped reports 100%.
2. viz schema card (satsuma-viz/src/components/sz-schema-card.ts:748-766) counts EVERY node including containers in both numerator and denominator, so one covered leaf inflates the numerator once per ancestor level.
3. The core rollup added by sl-4qvp counts LEAVES ONLY, with the correct rationale documented at coverage-rollup.ts:43-56 — a record is structure, not data, and counting it alongside its children would let nesting depth move the percentage.

(3) is right, is now ADR-034, and stays. (1) is 3cc-t6uo. (2) is this ticket: the viz card must delegate to core, or feature 36's requirement that overlay numbers equal coverage --json fails on the first nested schema — and a reviewer with the extension, a terminal and the viz panel open sees three different figures for one mapping.

## Acceptance Criteria

The viz card's _countFields/_countMapped stop computing their own figures and delegate to core summarizeFieldCoverage/leafFieldEntries per ADR-034; container states reported alongside as counts (records: {covered, partial, uncovered}) — useful review information but not a percentage; the depth-invariance invariant documented: a schema's percentage is unchanged by re-nesting, same leaves and same arrows give the same number; test asserting two schemas with the same four leaves, one flat and one nested three deep, report identical percentages; test asserting the same fixture reports the same number from the core rollup and the viz card (today 25% and 40%); once 3cc-t6uo also lands, all three surfaces agree; containers excluded from the denominator — 'amount' plus 'address record {city,line1,postcode}' with only address.city mapped reports 25%, not 40%; vscode and viz suites pass.


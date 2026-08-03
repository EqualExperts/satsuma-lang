---
id: sl-lctd
status: closed
deps: []
links: [ccc-3vaw]
created: 2026-08-02T21:41:45Z
type: task
priority: 3
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, coverage, cli, docs]
---
# coverage: container state counts (records covered/partial/uncovered) are never reported by the CLI

PRD 38 R3 requires container states to be reported alongside the percentage — 'records: {covered, partial, uncovered}' — and acceptance test 21 states it as a case. Core implements it (countContainerStates, ContainerStateCounts in satsuma-core/src/coverage-rollup.ts) and the viz card surfaces it in the card's tooltip, but satsuma coverage never does: tooling/satsuma-cli/src/commands/coverage.ts contains no reference to containers in either the human output or --json, and the --json shape documented in its help text has no field for them.

So the reviewer who most needs the signal — the one reading the terminal or gating CI — cannot see that two records are half-mapped, and a JSON consumer cannot reconstruct it, because fields[] lists leaves only.

Everything else in R3 shipped: leaf-only counting, and both former consumer-local denominators (VS Code status bar, viz card) now delegate to core.

## Design

Human output: one line per schema beside the ratio, printed only when there is something to say — the viz card's precedent is to mention partly-mapped records only when partial > 0, and the same restraint suits a terminal report. A record with every leaf covered needs no attention and one with none is already visible in the uncovered list.

--json: add the counts to each schema entry, under both 'mappings' and 'aggregate', and document the key in the help text's JSON shape block alongside covered/total/pct. The counts must come from core's countContainerStates, never recomputed here (ADR-034).

Also state in the help text what the counts are not: they are reported beside the percentage and are excluded from it, since a record is structure rather than data.

## Acceptance Criteria

coverage --json carries container state counts for every schema in both sections, sourced from core. Human output names partly-mapped records when there are any and stays silent when there are none. The PRD 38 acceptance-test-21 fixture (amount + address record {city, line1, postcode}, only address.city mapped) reports 25% with records {covered: 0, partial: 1, uncovered: 0}. The JSON shape in coverage --help and in SATSUMA-CLI.md documents the new key.


## Notes

**2026-08-03T08:41:12Z**

Cause: the container tally shipped in core (countContainerStates, ADR-034) and reached the viz card's tooltip, but satsuma coverage never rendered it — neither the schema rows nor the --json contract mentioned containers, so the reviewer reading the terminal and any JSON consumer could not see that a record was half mapped (fields[] lists leaves only, so it could not be reconstructed either).
Fix: coverage.ts now reads countContainerStates for every schema in both sections. Human schema rows gain '— N record(s) partly mapped' beside the ratio, printed only when partial > 0 (a fully covered record needs no attention; an uncovered one is already in the gap list). --json gains a 'records' {covered, partial, uncovered} object on each schema entry under both 'mappings' and 'aggregate', sourced from core and never recomputed; namespace and workspace subtotals keep percentages only, since a container belongs to one schema. Documented in coverage --help and SATSUMA-CLI.md, including that the counts sit beside the percentage and are excluded from it. New fixture coverage-partial-record.stm carries PRD 38 acceptance test 21 (amount + address record{city,line1,postcode}, only address.city mapped) and the CLI reports 1/4 25% with records {covered: 0, partial: 1, uncovered: 0}.

**2026-08-03T10:04:45Z**

Fix: as above, implemented in commit 2dcad0f3 (branch fix/coverage-container-counts, PR #431) — the Cause/Fix note above predates the commit and so omitted the reference AGENTS.md requires.

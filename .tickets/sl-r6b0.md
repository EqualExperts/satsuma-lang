---
id: sl-r6b0
status: closed
deps: [sl-fmx0]
links: [3cc-iedv]
created: 2026-07-31T14:43:38Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, core]
---
# core: whole-subtree arrow coverage (a record-targeted arrow covers its subtree)

PRD 38 R5. An arrow whose path resolves to a record or list_of record node covers that node's entire subtree. 'addr -> address' between two records asserts the structure maps across; reporting its leaves as gaps reports a gap the author explicitly closed. Closes 3cc-iedv (raised on branch feat/35-coverage-command; arrives on main when feature 35 merges).

## Design

R1's direct/derived split is what makes this safe. The record is DIRECTLY covered so its descendants inherit; a record that is merely an ancestor of a covered leaf confers nothing downward. 3cc-iedv records that the naive fix — a leaf inherits from any covered ancestor — was tried and rejected during sl-4qvp precisely because ancestor prefixes make a record read as covered when any single descendant is, which would turn 'one of twelve address fields is mapped' into 'all twelve are'.

Implement as subtree expansion at set-build time, not a probe-time wildcard, so the covered set stays a plain set and consumers do not change. Expansion needs the schema's field tree at build time; reuse the core resolver interface feature 35 introduced (CoverageSchemaResolver).

## Acceptance Criteria

addr -> address between records with three leaves reports all three leaves covered, the record covered, 3/3. Direct and derived are not confused: in one schema where address is covered by a whole-record arrow and billing only by an arrow to billing.city, address's leaves are all covered while billing.line1 is uncovered and billing is partial — the case 3cc-iedv says a naive ancestor-inheritance fix would break. Whole-subtree arrow plus a more specific sibling arrow does not double count and the percentage stays <= 100%. Whole-subtree arrow onto a list_of record expands the same way. 3cc-iedv closed with a note referencing this work.


## Notes

**2026-08-01T19:05:38Z**

Sequencing note from sl-fmx0: the CoveredFieldPaths model and hasDirectlyCoveredAncestor are in place, but the direct set is still kind-blind — extraction registers each/flatten iteration subjects as direct paths, so subtree inheritance must not be turned on until the direct set distinguishes plain arrows from iteration headers (ExtractedArrow currently carries no such kind). Otherwise 'each parcels -> .packed { }' manufactures coverage for every leaf of parcels, the exact case sl-0pun's empty-each AC forbids. A test in coverage.test.js ("sl-r6b0's boundary") pins current behaviour and must be flipped by this ticket.

**2026-08-02T15:42:49Z**

Cause: an arrow onto a record registered only that one path, so all of the record's leaves reported as gaps (3cc-iedv). The obvious fix was blocked because the direct set was kind-blind — extraction emitted an identical record for a plain arrow and for an each/flatten header, so subtree inheritance would have manufactured coverage for every leaf under every each block.
Fix: ExtractedArrow now carries `kind` (map/computed/nested/each/flatten) and `enumeratesChildren`. Coverage confers subtree coverage only when the declaration is a record-to-record correspondence (map or nested) AND its body enumerates no child arrows; each/flatten headers, computed arrows and resolved NL @refs never confer. Expansion runs at set-build time (expandWholeStructureRefs) against the resolver's declared field tree, so the covered set stays a plain set of paths and consumers need no new query. Recorded as ADR-037, amending ADR-034.
Note on scope: the empty-body condition was the user's decision after I flagged that conferring from any nested_arrow header would reverse sl-qzy3's invariant (addr -> address { .street -> .line } must leave zip a gap). Example-corpus percentages are unchanged — it contains no whole-structure arrow onto a record.

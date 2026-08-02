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

**2026-08-02T18:45:00Z**

PR #421 review round. Three changes, no behaviour change to the shipped rule.

1. Condition 1 was documented as a 'record-to-record correspondence' in ADR-037, CHANGELOG.md, SATSUMA-CLI.md and the ArrowFieldReference doc-comment, but arrowReference() only checks kind + enumeratesChildren — nothing verifies the field opposite the arrow is also a container, and coverageForSchema could not check it anyway (it holds one schema's field tree, not its counterpart's). Two existing tests already encoded the looser rule incidentally ('a -> address' with a STRING, 'v -> a' with v STRING). All four docs now state the shipped rule and name the source/target asymmetry: correct on the source side (a map arrow off a record consumes it whole), generous on the target side (a scalar credits every leaf). Pinned by a new test, 'confers onto a record target even when the source is a scalar', whose comment says it flips if 3ct-cs4y tightens it.

2. Three rules ADR-037 states had no test. Added: flatten never confers (empty body, so only the kind check stands between it and full coverage — the each test could not catch a flatten_block mis-mapping); a pipe-chain body is not enumeration (spec 4.4); every source of a multi-source arrow expands. Each verified discriminating by mutation — flatten added to WHOLE_STRUCTURE_KINDS, transform_raw folded into the enumeration test, and first-source-only expansion each fail exactly one of the three and nothing else.

3. hasDirectlyCoveredAncestor and isDirectlyCovered deleted. sl-fmx0 built them as scaffolding for this ticket; expansion happens at set-build time against the declared field tree instead, so neither had a production caller and the former's own doc-comment warned no caller holding only the model may use it safely. Their model-level invariants are retained in coverage-paths.test.js, probing covered.direct/covered.ancestors directly.

Also tightened the 'never reports a leaf as partial' test: it derived leafness from a hardcoded list of the fixture's paths and asserted notEqual('partial'), which passed on undefined. Now uses leafFieldEntries and asserts the state is one of the two legal values.

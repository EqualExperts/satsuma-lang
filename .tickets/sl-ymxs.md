---
id: sl-ymxs
status: open
deps: []
links: []
created: 2026-08-02T21:41:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [feature-35, coverage, cli]
---
# fields --unmapped-by is role-blind, contradicting coverage when one schema is both source and target

satsuma coverage separates a schema's source-side and target-side coverage; fields --unmapped-by unions the two. When a mapping names the same schema on both sides, the two commands disagree, and fields is the one that under-reports.

tooling/satsuma-cli/test/fixtures/ambiguous-scope.stm — schema customers is both source and target, id -> id plus a computed arrow -> name { "Look up the customer name from CRM" }:

  $ satsuma coverage ambiguous-scope.stm --mapping customers
    source  customers  1/2   50%
    target  customers  2/2  100%
      uncovered in customers (source): 1 field
        name
  $ satsuma fields customers ambiguous-scope.stm --unmapped-by customers
  All fields in 'customers' are mapped by 'customers'.

name is written by the mapping and never read by it. Coverage says so; fields says the review queue is empty.

Feature 35's sl-oqsj committed to the two commands reporting the identical field set, and PRD 38 R6 re-states it. A sweep of every mapping in examples/ plus tooling/satsuma-cli/test/fixtures/ found this as the only divergence — 64 other files agree leaf for leaf — so the invariant holds except for the both-roles case, which no test covers.

## Design

fields --unmapped-by takes no role, and for a schema on one side of a mapping there is nothing to choose. Options:

(a) Report the union of the two roles' gaps (a field is unmapped if it is unmapped in either role it plays). Keeps a single answer, makes the queue conservative, and is the reading that matches 'show me what still needs work'.
(b) Add --role source|target mirroring coverage, and default to (a).

Either way the parity invariant needs restating in terms both commands can satisfy, and a test with a both-roles fixture — ambiguous-scope.stm is already in the repo — must pin it. The logic is core's; put the role handling wherever filterUnmappedFields now reads its covered set, not in the command.

## Acceptance Criteria

fields --unmapped-by and coverage --uncovered --mapping report the same leaf set for ambiguous-scope.stm. A test asserts the invariant on a fixture where one schema is both source and target, and it fails if either command reverts to the other's convention. The chosen semantics are documented in fields --help.


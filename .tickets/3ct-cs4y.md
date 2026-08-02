---
id: 3ct-cs4y
status: open
deps: []
links: []
created: 2026-08-02T18:39:46Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-j6g9
tags: [feature-38, core]
---
# core: decide whether whole-structure expansion should require a container on both sides of the arrow

ADR-037 gates whole-structure expansion on the arrow's declaration kind (map|nested) and an empty body. It does NOT check that the field on the other side of the arrow is also a container, because coverageForSchema reports on one schema at a time and does not hold the counterpart's field tree. Raised from the PR #421 review, where the ADR text said 'record-to-record correspondence' but the implementation was looser; the docs were corrected to describe the shipped rule and this ticket carries the behavioural question.

## Design

Two sides behave differently and probably warrant different rules.

SOURCE side: 'addr -> out' with addr a record and out a scalar expands addr's leaves. This reads correctly — a map arrow off a record consumes the whole record, whatever the target's shape. No change wanted.

TARGET side: 'full_name -> address' with full_name a scalar and address a twelve-leaf record credits all twelve leaves. One scalar cannot populate twelve fields, and this is the direction ADR-034 called a 'large, silent overstatement'. It is also the figure --fail-under gates.

Option (a): leave as shipped. Simple, and the arrow is unusual enough that nobody has hit it. Costs: the generous reading is invisible in the number.
Option (b): require the counterpart to be a container for TARGET-side expansion only. computeMappingCoverage already has sourceIds, targetIds and resolveSchema, so it can resolve every participating schema up front and, per arrow, test whether some source schema declares the source path as a container. Keeps the source-side reading. Costs: a second resolve pass, and arrows whose source is in an unresolvable schema fall back to (a) or to no expansion — pick one and say which.
Option (c): require it on both sides. Loses the defensible source-side reading; probably wrong.

Check the example corpus and any real workspaces for scalar-to-record arrows before choosing — if the shape does not occur, (a) plus the documentation already added may be the whole answer.

## Acceptance Criteria

A decision recorded in ADR-037 (amendment or successor ADR, per the immutability rule). If the behaviour changes: target-side expansion requires a container source, source-side expansion is unchanged, the scalar-to-record test in coverage.test.js flips with a comment saying why, and CHANGELOG plus SATSUMA-CLI.md state the final rule. If it does not change: the ADR records the reasoning and this ticket closes as won't-do.


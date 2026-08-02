---
id: 3ct-cs4y
status: closed
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


## Notes

**2026-08-02T20:16:25Z**

Cause: ADR-037 gated whole-structure expansion on the arrow's declaration kind alone, never checking the field opposite the arrow — coverageForSchema reports on one schema at a time and held no field tree but its own. On the source side that reads correctly (a map arrow off a record consumes the whole record whatever receives it); on the target side it credited every leaf of a record to a single scalar, an overstatement on the number --fail-under gates and in the direction ADR-034 explicitly refused to risk.

Evidence gathered before choosing: a scan of all 270 expansion-eligible arrows in examples/ found every one is scalar-to-scalar — no arrow touches a container on either side, so neither the risk nor ADR-037's feature is visible in the corpus. That made every option free of measurable consequence today, which is the argument for picking the safe one now rather than after someone builds a threshold on the generous reading. (Detector validated against a synthetic positive control classifying all four shapes.)

Fix: option (b) plus option (e) from the PR #421 review.

(b) Target-side expansion now additionally requires that at least one source path names a declared container. Source-side expansion is unchanged. Sub-rules: any one container source suffices for a multi-source arrow; it fails closed, so a source naming nothing declared (or a schema the resolver cannot resolve) confers nothing; resolved NL @refs are untouched. computeMappingCoverage resolves participating schemas up front so the target-side test has the source field trees in hand.

(e) New CLI lint rule unenumerated-record-target (warning, not fixable): flags an arrow that targets a record while neither carrying a record nor listing child arrows. It is the explanation for the gap coverage now reports — otherwise the author sees twelve uncovered fields with no clue one arrow was nearly responsible.

The shared question 'what does this path name in this schema?' is answered once, by declaredFieldKind in satsuma-core/src/coverage.ts, called by both coverage and the lint rule so the number and its explanation cannot drift. ArrowRecord gained kind/enumeratesChildren (already flowing at runtime, only the type was narrow) and the index gained a flat arrows list.

Verified: corpus coverage fingerprint byte-identical to main across every example; the new rule reports 0 findings on the corpus; end-to-end run on a four-arrow file flags exactly the scalar-to-record arrow while record-to-record, enumerated and scalar-to-scalar stay silent and correctly counted. Recorded as ADR-038, amending ADR-037.

---
id: sl-f0x6
status: closed
deps: []
links: [sl-j6g9]
created: 2026-08-03T12:31:53Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [viz, ui, coverage]
---
# viz schema card: partial container coverage is visually identical to fully mapped

Hierarchical coverage distinguishes four states, but the schema card's port dot renders only three. A record whose subtree is PARTLY covered gets the same solid filled dot as a record that is fully covered, so a reader scanning a card cannot see partial coverage at all.

Evidence in satsuma-viz/src/components/sz-schema-card.ts:
- The row computes portClass = unavailable ? 'unknown' : isMapped ? 'mapped' : 'unmapped' (line ~760), where isMapped is entry.mapped -- true for BOTH 'covered' and 'partial'.
- The CSS defines exactly three port styles (lines 186-202): .port.mapped (solid fill), .port.unmapped (hollow ring), .port.unknown (dashed, faded). There is no .port.partial.
- The state IS known and IS exposed to automation: the row sets data-coverage-state to the real value including 'partial'.
- 'partial' currently reaches the human only through hover text: _fieldTitle appends '-- partly ...' (line 952) and the card ratio title appends '-- N records partly mapped' (lines 965-967). Both require hovering the exact element.

Observed on examples/filter-flatten-governance/filter-flatten-governance.stm, mapping order-line-facts: the probe recorded 3 fields at state 'partial' tier 'declared' (and 1 partial/nl), all rendering an indistinguishable filled dot. In the captured screenshot the 'customer' record shows a solid dot while two of its three children are hollow.

This undercuts the point of Feature 38 (epic sl-j6g9): the partial state is computed and carried through core, then discarded at the last rendering step. Note the .port.unknown comment already reasons carefully about needing a third state visually distinct from the other two -- the same argument applies to partial, which never got one.

## Acceptance Criteria

- A container at state 'partial' renders a port dot visually distinct from both 'covered' and 'uncovered' (e.g. a half-filled or ringed-and-filled dot), in light and dark themes.
- The distinction survives at the rendered port size; it must be discernible without hovering and without zooming.
- portClass derives from the coverage STATE, not from the boolean mapped, so a future fifth state cannot silently collapse into an existing style.
- A test asserts the partial port class for a minimal snippet where one record has some covered and some uncovered children.
- The existing hover text is kept as the detailed explanation, not removed.


## Notes

**2026-08-03T13:27:27Z**

Cause: sz-schema-card chose the port-dot class from entry.mapped, which core defines as state !== "uncovered" — true for 'covered' and 'partial' alike — so a partly covered record painted the same solid dot as a fully covered one, and the tri-state reached a reader only through hover text.
Fix: the dot class now derives from the coverage state via a total Record<FieldCoverageState, string> map (a fourth state fails to compile rather than collapsing into an existing style), and a new .port.partial rule draws a half-filled dot inside an accent ring. Verified in Firefox in both themes on examples/filter-flatten-governance (order-line-facts): order_totals and line_items render half-moons between currency's solid dot and subtotal's hollow ring.

**2026-08-03T13:30:02Z**

Commit: 9c4c253c (PR #440).

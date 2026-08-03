---
id: lgc-4bxl
status: open
deps: []
links: [sl-hi0z, sl-k7i4, lgc-fu7o]
created: 2026-08-03T22:23:44Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [viz, layout, lineage, feature-41]
---
# The viz draws a computed arrow as a line from a same-named source field, or drops it entirely

A computed arrow declares a target with NO source: '-> stamp { "Set at load time." }'. elk-layout.ts's addMappingEdges resolves its source with

  const sourceField = a.sourceFields[0]
    ? qualifyChildArrowPath(a.sourceFields[0], container.source)
    : targetField;                       // <-- invents the target's own path as the source

so a sourceless arrow is looked up in the SOURCE schema under the TARGET's field name. Two outcomes, both wrong:

1. The source schema happens to declare a field of that name — overwhelmingly common, since matching names on both sides is the normal case — and the viz draws a line asserting lineage the Satsuma explicitly denies:

     schema s0 { a STRING  stamp STRING }
     schema s1 { a STRING  stamp STRING }
     mapping m0 {
       source { s0 }
       target { s1 }
       a -> a
       -> stamp { "Set at load time; no source field." }
     }

   drawn: s0.a -> s1.a          (arrow.sourceFields = ["a"])
   drawn: s0.stamp -> s1.stamp  (arrow.sourceFields = [])   <-- phantom

2. The source schema does not declare that name — findPort returns null, the 'Skip edges with missing ports' branch fires, and the computed target gets no edge at all, indistinguishable from an unmapped field.

The CLI is correct here: graph --json emits the edge with "from": null.

A phantom lineage edge is worse than a missing one: it is a confident claim about where data came from. Found by Feature 41 R3's viz edge-completeness property (sl-hi0z), which is marked todo against this ticket rather than blessing either behaviour.

Related but distinct: sl-k7i4 is the DETAIL view's empty Source cell for the same declaration. This ticket is the overview/detail edge line.

## Acceptance Criteria

A computed arrow never produces an edge whose source is a field the arrow does not name. Whatever is drawn for a computed target is distinguishable from a mapped one and from an unmapped one. The fallback 'sourceField = targetField' is gone; a sourceless arrow is handled explicitly rather than by a lookup that happens to miss. Feature 41's viz edge-completeness property covers computed arrows and its todo marker is removed. Harness Playwright coverage for the rendered result.


## Notes

**2026-08-03T22:45:49Z**

Feature 41 R3 pinned this defect in an executable test rather than skipping it. The test asserts the CURRENT (wrong) behaviour and will go RED when this ticket is fixed, with a comment naming the invariant to replace it with. `{ todo: ... }` is not usable in this repo: node's JUnit reporter puts a `failure=` attribute on a failing todo testcase, and dorny/test-reporter then fails CI's Test report check.

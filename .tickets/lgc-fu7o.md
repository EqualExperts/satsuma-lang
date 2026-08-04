---
id: lgc-fu7o
status: closed
deps: []
links: [sl-hi0z, lgc-4bxl]
created: 2026-08-03T22:25:37Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [viz, layout, lineage, feature-41]
---
# The viz draws only the first source of a multi-source arrow, so hover highlights a line to the wrong card

Spec 4.2: 'Multi-source arrows appear in lineage as one edge per source field, all pointing to the same target.' satsuma graph does exactly that. The viz draws ONE line, from the first source only:

  elk-layout.ts addMappingEdges:
    const sourceField = a.sourceFields[0]      // <-- only ever the first
      ? qualifyChildArrowPath(a.sourceFields[0], container.source)
      : targetField;

Repro:

  schema s0 { field_0 STRING }
  schema s1 { field_0 STRING }
  schema s2 { field_0 STRING }

  mapping m0 {
    source { s0, s1 }
    target { s2 }
    s0.field_0, s1.field_0 -> field_0 { "Concatenate both sources." }
  }

  satsuma graph --json: two edges, ::s0.field_0 -> ::s2.field_0 and ::s1.field_0 -> ::s2.field_0
  viz layout:           one edge, from s0 only

It is worse than a missing line, because the hover path does NOT share the omission: sz-edge-layer.ts:218 highlights on 'edge.arrow.sourceFields.includes(this.highlightField)', which is the whole authored arrow. So hovering the SECOND source field highlights the single drawn edge — a line running to the FIRST source's card. The UI points at the wrong schema.

Secondary observation, same code path and same fix: LayoutEdge.sourceField holds the *authored* ref, so it is schema-local for a bare ref ('field_0') and schema-prefixed for a qualified one ('s0.field_0'). The field carries no doc comment and two meanings. The port lookup itself is correct — resolveSchemaLocalFieldPath normalises before matching — so this is latent rather than visible today, but any consumer that matched on it would break for exactly the multi-source case.

Found by Feature 41 R3's viz edge-completeness property (sl-hi0z), which is marked todo against this ticket.

## Acceptance Criteria

A multi-source arrow produces one drawn edge per source field, each attached to the card declaring that source. Hovering any source field highlights the edge from that field's own card. LayoutEdge.sourceField has a doc comment stating which form it holds, and holds that form for both bare and schema-qualified authored refs. Feature 41's multi-source viz property has its todo marker removed. Harness Playwright coverage for a multi-source mapping's rendered edges.


## Notes

**2026-08-03T22:45:49Z**

Feature 41 R3 pinned this defect in an executable test rather than skipping it. The test asserts the CURRENT (wrong) behaviour and will go RED when this ticket is fixed, with a comment naming the invariant to replace it with. `{ todo: ... }` is not usable in this repo: node's JUnit reporter puts a `failure=` attribute on a failing todo testcase, and dorny/test-reporter then fails CI's Test report check.

**2026-08-04T09:42:31Z**

Cause: The layout collapsed every ArrowEntry to sourceFields[0], while hover tested the shared authored source list, so later sources had no line and could highlight a sibling line from the wrong card.
Fix: The layout now emits and independently resolves one edge per source, records schema-local concrete endpoints, and highlights against those endpoints; generated, unit, and browser tests cover the invariant. (commit immediately after c625ff3e)

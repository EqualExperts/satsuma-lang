---
id: sl-lnbt
status: open
deps: []
links: [sl-3fou]
created: 2026-08-02T21:42:31Z
type: feature
priority: 3
assignee: Thorben Louw
---
# lint: an NL @ref naming a record confers no coverage on its leaves, and nothing says so

ADR-036 counts a resolved @ref toward coverage; ADR-037/038 expand a whole-structure *arrow* onto a record. The two do not meet: an @ref that names a record confers nothing on that record's leaves.

  -> geohash { "Encode @station.lat and @station.lon to a geohash" }   =>  3/4, 75% (1 declared, 2 nl)
  -> geohash { "Encode @station to a geohash" }                        =>  1/4, 25%

The 25% reading is deliberate — prose is not interpreted (ADR-038 rule 3). The problem is that it is silent. The equivalent declared arrow gets unenumerated-record-target explaining the gap; the prose form gets nothing, so the author sees three uncovered leaves with no indication that one @ref is responsible for them.

Symmetry with the existing rule argues for a warning along the lines of: this @ref names a record, so coverage counts its leaves as gaps — reference the leaves you actually use.

## Acceptance Criteria

- New rule (or an extension of unenumerated-record-target) fires when a resolved @ref names a declared container whose leaves are otherwise uncovered.
- No finding when those leaves are covered by other arrows — the point is to explain a gap, not to ban the reference.
- Shares declaredFieldKind with coverage so the explanation and the number cannot drift (ADR-038).
- docs/nested-data/README.md sections 7 and 9 updated.


---
id: sl-hrql
status: open
deps: []
links: [sl-ez36]
created: 2026-07-31T15:53:53Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [core, lineage, nl-refs]
---
# core: NL @ref target field is not qualified with its container base, producing phantom nl-derived edges

`walkArrowsForNL` in `tooling/satsuma-core/src/nl-ref.ts` records `targetField`
as the arrow's own `tgt_path` text verbatim. It never accumulates the target
base established by the enclosing `each` / `flatten` / `nested_arrow` container,
so a computed arrow written inside a container reports a relative target.

For:

    each items -> lines {
      -> .line_total { "Multiply @qty by @price" }
    }

`nl-refs --json` reports `targetField: ".line_total"`. Downstream,
`qualifyField(".line_total", ["tgt"])` strips the dot and attaches the leaf to
the schema root, yielding `::tgt.line_total` — a field that does not exist.
The real field is `::tgt.lines.line_total`.

The declared-arrow index gets this right, so `satsuma graph --json` emits two
contradictory target nodes for the same source line:

    { "to": "::tgt.lines.line_total", "classification": "nl",        "line": 32 }
    { "to": "::tgt.line_total",       "classification": "nl-derived", "line": 32 }

Confirmed in the shipped corpus: `examples/sap-po-to-mfcs/pipeline.stm:159`
(`each Items -> items { .MENGE -> .orderedQty { "... @MEINS ..." } }`) produces
an nl-derived edge to `::mfcs_purchase_order.orderedQty` instead of
`::mfcs_purchase_order.items.orderedQty`.

Affected consumers: `field-lineage` (both directions), `graph --json` edges,
`arrows`, and the nl-derived edge counts in `summary --json` /
`countNlDerivedEdgesByMapping`.

`coverage.ts:collectBlockItemPaths` already solves exactly this problem by
threading a `PathBases {src, tgt}` through the walk (see the sl-qzy3 and
sc-xnxp doc-comments). `walkArrowsForNL` needs the same treatment for its
target side — and see the sibling ticket for the source side.

## Acceptance Criteria

- `walkArrowsForNL` threads the enclosing container's target base through the
  recursion, mirroring `collectBlockItemPaths` in coverage.ts, and records a
  `targetField` that is fully qualified relative to the target schema root.
- `flatten` at mapping-body level keeps establishing no target base (its target
  names the target schema, per spec 4.6), matching `containerTargetBase`.
- `nl-refs --json` on an `each`-nested computed arrow reports
  `targetField: "lines.line_total"`, not `".line_total"`.
- `field-lineage tgt.lines.line_total` lists the @ref'd source fields upstream;
  `field-lineage tgt.line_total` no longer resolves to a phantom node.
- `graph --json` emits one target node per arrow: the `nl` and `nl-derived`
  edges for a given source line agree on `to`.
- Core tests cover targets nested in `each`, `flatten` (relative form),
  `nested_arrow`, and a container nested two levels deep.
- A corpus regression test asserts the corrected edge for
  `examples/sap-po-to-mfcs/pipeline.stm`.


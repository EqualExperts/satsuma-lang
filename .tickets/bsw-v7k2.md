---
id: bsw-v7k2
status: open
deps: []
links: [bsw-xivc]
created: 2026-10-06T10:37:02Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-sweep-2026-10, viz-backend, lsp, fragments]
---
# viz-backend index drops a block's top-level spreads when the block declares no fields of its own

`tooling/satsuma-viz-backend/src/workspace-index.ts:627` reads
`const spreads = fields.length > 0 ? extractBodySpreads(...) : [];`, so
`schema t { ...frag }` (spreads only, no explicit field) is indexed with no
spreads at all. Every consumer of that index (LSP coverage, the LSP's live
semantic diagnostics, VizModel cards) then sees `t` as an empty schema: its
fragment fields are not expanded and an undefined `...nope` is not reported
until a save runs the CLI validate fallback. Found while fixing bsw-xivc; the
guard looks like it meant "blocks with a schema body", which `effectiveKind`
already establishes.

```satsuma
fragment f { a INT }
schema t { ...f }
```

## Acceptance Criteria

- A spread-only schema or fragment carries its top-level spreads in the index.
- LSP coverage and the VizModel card count `t.a`; the LSP reports `schema t { ...nope }` live.
- Tests at the index level, and a parity check that the CLI and VizModel agree on the repro.

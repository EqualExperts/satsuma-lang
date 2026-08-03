---
id: sl-v6rt
status: open
deps: []
links: []
created: 2026-08-02T21:41:57Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [cli, docs]
---
# fields --json: documented shape omits children, isList, startRow and metadata

satsuma fields --help documents the JSON shape as an array of {"name": str, "type": str | null}. The command actually emits nested objects:

  $ satsuma fields warehouse_dispatch_events examples/nested-iteration/pipeline.stm --unmapped-by 'dispatch manifest' --json
  [ { "name": "orders", "type": "record", "isList": true,
      "children": [ { "name": "parcels", ..., "children": [ { "name": "barcode", "type": "STRING(40)",
        "startRow": 39, "startColumn": 6, "metadata": [ {"kind": "tag", "tag": "required"} ] } ] } ],
      "startRow": 29, "startColumn": 2 } ]

The nesting matters most: a consumer written against the documented shape reads only top-level names and silently misses every nested field, which for --unmapped-by means missing most of the gaps. Found while cross-checking fields --unmapped-by against coverage --uncovered, where a flat reading of the JSON produced 14 false divergences.

Compare coverage --json, whose help documents every key and its meaning. Note also that startRow/startColumn are 0-indexed here while coverage --json's 'line' is 1-indexed and documented as such — the same inconsistency cbh-7rvo and cbh-gz2v fixed elsewhere in the CLI.

## Design

Document the real shape in the help text: the recursive children array, isList, the position keys and their indexing base, and metadata. Decide whether startRow/startColumn should join the rest of the CLI on 1-indexed lines under a 'line' key — if so that is a contract change worth its own note in CHANGELOG.md, and it should be settled together with sl-9p2t (display key form in --json), which is already open against the same surface.

## Acceptance Criteria

fields --help documents every key the command emits, including the recursive children array and the indexing base of any position key. A test asserts the documented keys match the emitted ones for a nested schema, so the two cannot drift again.


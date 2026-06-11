---
id: bptar-l6n8
status: closed
deps: []
links: []
created: 2026-06-11T07:15:34Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-hunt, core, nl-ref]
---
# core: bare @refs in unquoted pipe text invisible to NL ref extraction and LSP indexing

The grammar parses bare (unquoted) pipe text structurally: 'a -> b { derived from @b }' yields (pipe_text (identifier) (identifier) (at_ref (identifier))). But extractNLRefData (satsuma-core/src/nl-ref.ts) only collects nl_string/multiline_string nodes from pipe steps, so the already-parsed at_ref node is ignored — the ref never reaches nl-refs output, lineage, or validation. Control: the quoted form '{ "derived from @b" }' extracts fine. Same blind spot in satsuma-viz-backend workspace-index indexNlRefs, which regex-scans NL strings only, so find-references/rename miss bare-text @refs. Found adjacent to sl-74m6 (which fixed lookbehind prefixes and map-literal values but not this).

## Acceptance Criteria

extractNLRefData emits ref items for at_ref nodes in bare pipe text (arrow and transform bodies); refs resolve and validate like quoted ones; workspace index registers bare at_refs as nl references with @-sigil-excluded ranges so rename round-trips; tests for both layers.


## Notes

**2026-06-11T07:25:46Z**

Cause: the grammar parses unquoted pipe text structurally — '{ derived from @b }' yields an at_ref node, not an nl_string — but both core extractNLRefData (pipe-step walkers) and the viz-backend workspace index's indexNlRefs collected/regex-scanned only nl_string/multiline_string nodes, so bare refs never reached nl-refs output, lineage, validation, find-references, or rename.
Fix: core's pipe-step helper (now nlRefNodesInPipeStep) also yields at_ref nodes, with a shared nlRefText payload helper keeping position math identical to the quoted form; viz-backend indexNlRefs indexes at_ref nodes directly as "nl" references with the @ sigil excluded from the stored range (sl-xf3f contract). Real-parser tests cover arrow/transform bodies, multiple refs per step, backtick names, position anchoring, index ranges, and a rename round trip.

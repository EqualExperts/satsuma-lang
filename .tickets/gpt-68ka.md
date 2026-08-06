---
id: gpt-68ka
status: open
deps: []
links: []
created: 2026-08-06T18:45:30Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [lsp, diagnostics, nl-ref]
---
# lsp: the editor never reports unresolved-nl-ref, so it under-reports against the CLI

`satsuma validate` reports `unresolved-nl-ref` for an `@ref` in a transform body that resolves to nothing. The LSP never does, so the same file is clean in the editor and dirty on the command line.

The cause is stated in the code rather than hidden: `tooling/satsuma-lsp/src/semantic-diagnostics.ts`'s `buildSemanticIndex` adapter carries a `Limitations` comment reading `nlRefData: not available (LSP does not extract NL ref data)`. Core's `checkNLRefs` iterates `index.nlRefData`, so with the field absent the whole rule is skipped — as are `nl-ref-not-in-source` and the lint registry's `hidden-source-in-nl`, which read the same data.

Found while building Feature 46 R4 (gpt-8izj): after an LSP rename left `@s0.field_1` naming a schema that no longer existed (gpt-fjo7), the LSP reported nothing at all, while the CLI reported the dangling reference. The rename bug is the more urgent of the two, but this is why a user would not notice it.

This is a real gap rather than a deliberate scope decision as far as the comment says — the LSP does index NL refs for *references* (the workspace index files them under their field path with context `nl`), so the data exists in some form; what is missing is the `SemanticNLRef` shape core's rule needs, which carries the raw text, the mapping and a position.

## Acceptance Criteria

The LSP reports unresolved-nl-ref, nl-ref-not-in-source and hidden-source-in-nl on the same inputs the CLI does, or the divergence is recorded as a deliberate decision with its reason and the Limitations comment cites this ticket. A parity case lands in tooling/integration-tests/ so the two surfaces cannot drift again.


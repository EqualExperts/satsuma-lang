# ADR-043 — Generated CST Symbol Contract Across Grammar and Core

**Status:** Accepted
**Date:** 2026-08-03 (gcsc-ejb2, feature 39)

## Context

All Satsuma tooling is tree-sitter-backed (ADR-001), and shared CST extraction
belongs in `satsuma-core` (ADR-003 and ADR-020). The boundary between those two
decisions was still represented by unchecked strings. Tree-sitter exposes a
node's type as `string`, while core, CLI, LSP, and viz-backend compare that value
with grammar symbols such as `schema_block`, `mapping_body`, and `record`. A
misspelled or renamed symbol therefore remained valid TypeScript and silently
turned a live branch into one that never matched.

The generated `tooling/tree-sitter-satsuma/src/node-types.json` is the complete
machine-readable symbol inventory. It contains both named CST kinds and
anonymous grammar tokens; the latter matter because consumers intentionally
compare tokens including `record`, `list_of`, `enum`, and `slice`. It does not
contain tree-sitter's synthetic `ERROR` recovery node. Missing nodes do not add
a `MISSING` type: they retain the expected grammar symbol and expose missingness
through `SyntaxNode.isMissing`.

Three ownership models were considered. Keeping a hand-maintained union in core
would move the unchecked convention without preventing drift. Exporting the
contract from the grammar package would make every consumer take a new package
dependency solely for TypeScript declarations. Generating a tracked artifact
from the grammar into core preserves the existing consumer boundary, but it
requires an explicit freshness gate because ordinary generation rewrites stale
output and can hide that it was not committed.

## Decision

The grammar package owns CST symbol discovery and generation. The deterministic
generator at
`tooling/tree-sitter-satsuma/scripts/generate-cst-symbols.mjs` reads
`src/node-types.json`, classifies and sorts named kinds and anonymous tokens, and
emits readonly symbol constants plus `SatsumaNamedKind`,
`SatsumaAnonymousToken`, `SatsumaGrammarSymbol`, and `SatsumaCstType`. The last
type adds `ERROR` to the grammar symbols; missing nodes continue to be detected
with `isMissing`.

Core owns the tracked public artifact at
`tooling/satsuma-core/src/generated/cst-types.ts` and re-exports it through
`@satsuma/core`. Consumers therefore gain the contract through their existing
dependency and do not depend on the grammar package at runtime or compile time.
`npm run generate` in `tree-sitter-satsuma` refreshes both tree-sitter's parser
outputs and this core artifact.

Freshness is checked before generation. `npm run check:cst-symbols` regenerates
to a temporary directory, compares that output with the tracked core module, and
fails without modifying the worktree when they differ. The repository commit
gate and parser CI job run this check before `npm run generate`, so a stale or
missing artifact cannot be repaired invisibly by the validation command itself.

## Consequences

**Positive:**

- Grammar symbols have one machine-generated TypeScript definition shared by
  core and every consumer.
- Named nodes, anonymous tokens, and the `ERROR` recovery exception are explicit
  parts of the public contract.
- A grammar rename or removal becomes a compile failure once typed CST use sites
  adopt the generated union, rather than a silent behaviour change.
- Deterministic sorting and a non-mutating freshness check keep generated diffs
  stable and make omitted regeneration fail locally and in CI.

**Negative:**

- Grammar generation writes a tracked file in another package, so contributors
  must understand that `tree-sitter-satsuma` owns an artifact physically located
  under `satsuma-core`.
- The checked-in contract duplicates information from `node-types.json` and must
  be regenerated after grammar changes; the build gate is required to keep the
  duplication safe.
- `SatsumaCstType` describes parser output, not semantic walker completeness.
  Adding a grammar symbol does not force every intentionally partial consumer to
  handle it.

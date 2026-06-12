# ADR-033 — Canonical Pipe-Chain Serialization Defines Structural Identity

**Status:** Accepted
**Date:** 2026-06-12 (sl-dxjh)

## Context

`satsuma fmt` guarantees that formatting does not change a file's meaning, and
`satsuma diff` claims to report *structural* differences. The two disagreed
about what structural identity means for pipe content: fmt freely re-lays a
pipe chain (steps split one-per-line beyond the column cap) and a `map`
literal (entries newline-separated instead of comma-separated), while the diff
engine compared transform bodies as raw source text and arrow transforms via
`transform_raw`, which embedded each step's raw text — including the internal
layout of map literals. Running diff between a file and its own fmt output
reported transform bodies and map-carrying arrows as `~` changed.

Since ADR-023, everything inside a pipe step is NL — human-interpreted text
that tooling must deliver verbatim. So the fix could not be "normalize the
text": collapsing whitespace inside NL strings would change what a human
reads. Nor could it be "compare formatted output": the formatter's layout is
line-length-dependent (a map literal renders single-line or multi-line based
on entry count and column position), so formatting is not a canonical form.

The alternative of making diff re-parse and walk CSTs was rejected: the diff
engine deliberately operates on extracted records, not trees (two workspaces'
trees cannot be alive simultaneously under the single parser buffer), and
every other consumer of pipe content already works from extraction output.

## Decision

Structural identity for pipe content is defined by a **canonical
serialization** computed at extraction time in `satsuma-core`
(`canonicalPipeChainText` in `extract.ts`): pipe steps joined with `" | "`,
`map` literals rebuilt as a single-line entry list (`map { k: v, k: v }`),
and every leaf token — pipe text, map keys, map values, spread names —
passed through verbatim. The canonical form normalizes exactly the layout
the formatter owns (separators between steps and between map entries) and
nothing else.

`ExtractedTransform` carries both `body` (raw source text, preserving the
author's layout for display) and `canonicalBody`; arrows' `transform_raw` is
now built from canonical step text. The diff engine compares canonical forms
only. The contract is pinned corpus-wide by a property test in the CLI suite:
for every file in `examples/`, `diff(file, fmt(file))` must be empty.

## Consequences

**Positive:**
- fmt and diff agree on meaning: formatting-only changes can never appear in
  a structural diff, verified for the whole example corpus.
- NL content remains verbatim end-to-end — quoted strings, casing, and inner
  whitespace are never normalized, consistent with ADR-023.
- Any future formatter layout rule that the canonical serialization does not
  normalize fails the corpus roundtrip test immediately rather than silently
  reintroducing false diffs.

**Negative:**
- `transform_raw` is no longer literally raw: map literals in `arrows --json`
  output and diff messages render in canonical single-line form regardless of
  authored layout. Consumers needing the authored text must use the raw body.
- The canonical serializer must be extended in step with any new pipe-step
  node type the grammar grows; an unhandled type falls back to raw node text
  and may reintroduce layout sensitivity for that construct.

# ADR-031 — Line-Aware External Scanner Tokens Make Silent Mis-Parses Loud

**Status:** Accepted
**Date:** 2026-06-12 (fix/grammar-bug-batch: sl-hjx1, sl-vnty, sl-zzaj, sl-w5st, sl-csd2)

## Context

Satsuma's grammar treats newlines as extras (plain whitespace), and several of
its constructs are deliberately greedy free-text runs: metadata tag values
(`value_text`), bare map values (`map_value`), pipe text, and the positional
field pattern `NAME [TYPE] [(metadata)] [{body}]`. The 2026-06 bug hunt showed
that this combination produces a class of bug worse than a parse error: a
**wrong-but-clean tree**. Adjacent typeless fields merged into one field with
the second name as the type (sl-hjx1); a forgotten comma folded constraint
flags into the previous tag's value (sl-vnty); multi-word map values leaked
into the next entry's key (sl-zzaj); and `src -> tgt` written in a pipe-text
position lexed as `src`,`-`,`>`,`tgt` and silently dropped a lineage edge
(sl-w5st). All four parsed with zero ERROR nodes, so every downstream tool
reported confidently wrong results.

Tree-sitter's regex tokens cannot see line boundaries or do lookahead, so the
fixes cannot live in `grammar.js` token definitions. The repository already
had one external token (`continuation_word`, which ends multi-word spreads at
the end of a line), proving the pattern. Alternatives considered: making
newlines significant grammar-wide (a far larger language change that would
break multi-line metadata and pipe chains, which are spec-sanctioned), or
leaving the traps documented-but-unfixed (rejected — parser-backed tooling is
the project's core promise).

## Decision

Line-sensitive and lookahead-sensitive tokens are produced by the external
scanner (`tooling/tree-sitter-satsuma/src/scanner.c`), which is the designated
home for any future token whose boundary depends on line position or on the
following character. The scanner now owns five tokens: `continuation_word`
(spread continuation), `inline_type` (field type, same line as the field
name, aliased to `type_expr`), `value_word` (metadata tag value word, same
line, refusing structural keywords and spec-7.1 constraint flags),
`map_value_word` (bare map value continuation, same line), and `minus_op`
(arithmetic minus, refusing to lex when `>` follows so an arrow in pipe text
cannot degrade to prose).

Two conventions bind future grammar work. First, the design principle: when
greedy free-text could absorb the *start of a different construct*, the
grammar must produce a loud parse error rather than a clean tree — silent
absorption is treated as a bug even when some interpretation of the input is
"valid". Second, the mechanism: tokens whose refusal must be final are
declared as **named** external tokens and aliased at the use site
(`alias($.minus_op, "-")`, `alias($.inline_type, $.type_expr)`). A string
literal in `externals` does not work for refusal semantics: when the external
scanner declines a literal token, tree-sitter falls back to the internal
lexer for the same literal, silently defeating the refusal. Aliases keep the
CST node names unchanged, so downstream consumers (core extraction, LSP, viz)
are unaffected.

## Consequences

**Positive:**

- The four silent-merge traps are now loud parse errors; lineage and
  constraint extraction can no longer report confidently wrong data for them.
- CST shape is unchanged for valid input (aliases preserve `type_expr` and
  `identifier` node names), so no consumer changes were needed.
- The scanner centralizes line-boundary policy (including `\r` as a line
  terminator, sl-2gle) and the no-trailing-hyphen identifier rule (sl-csd2)
  in one commented file instead of scattering it across regexes.

**Negative:**

- The grammar is no longer fully described by `grammar.js`; contributors must
  read `scanner.c` to understand type, tag-value, and map-value lexing, and
  keep its word-shape logic in sync with the `identifier` regex.
- The scanner hard-codes vocabulary blocklists (structural keywords and the
  spec-7.1 constraint flags); adding a constraint flag to the spec now
  requires a scanner update to keep the missing-comma protection complete.
- Some previously-clean (but misleading) inputs are now hard errors, which is
  a breaking change for any `.stm` files that relied on the old silent
  readings (none existed in the canonical examples corpus).

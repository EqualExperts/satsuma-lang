# ADR-055 — Lexical Form of Paths and Qualified Names

**Status:** Accepted
**Date:** 2026-10-07 (bsw-0twy, bsw-iuzs)

## Context

Two gaps in the grammar let one written path mean two things.

**Whitespace inside a path.** The grammar treated whitespace and comments as
extras everywhere, including straight after the path markers `.`, `^.` and
`$.` (ADR-053) and after a continuation dot. So `^. order_no`, `^. ^.id`,
`$. order_no`, `. sku` and `orders. order_no` all parsed. Extraction then read
the raw node text, gap included, and reported fields such as `'orders. oid'` as
undeclared. The formatter joined the leaf tokens and dropped the gap, so
`satsuma fmt` turned `^. ^.sid` into `^.^.sid`: one level higher than the
validator had read it. Formatting changed what an arrow resolved to (bsw-0twy).

**Quoting a namespaced name.** `qualified_name` allowed only a bare identifier
after `::`. A namespaced schema whose name needs backticks could be written
only by quoting the whole qualified name, `` `raw::crm-contacts` ``: a single
`backtick_name` that consumers split on `::` by hand. The form the docs showed,
`` raw::`crm-contacts` ``, did not parse (bsw-iuzs). Meanwhile `namespaced_path`
already accepted a backtick segment after `::`, so the language used both
spellings in different places.

## Decision

1. **A path contains no whitespace.** Nothing — no space, line break or
   comment — may follow `.`, `^.` or `$.`, or sit between two path segments.
   The grammar enforces this by making each segment after a marker or dot
   `token.immediate`, so the spaced forms are parse errors, not alternative
   spellings. Whitespace after `::` is outside this rule.

   We chose rejection over the alternative of accepting spaced forms and
   resolving them by CST segment. Rejection makes a path one lexical unit,
   which is how every author and tool already reads it. Accepting the spaced
   form would have kept a second spelling alive that the formatter must then
   normalise, and that a human reader can misjudge (`^. ^.id` reads as one
   level, means two).

2. **Only the name after `::` is quoted.** `` ns::`name` `` is the canonical
   way to write a namespaced name that needs quoting, everywhere a qualified
   name appears: imports, `source`/`target` entries, spreads, metadata values
   such as `(ref ...)`, arrow paths and `@` refs. A namespace name is always a
   bare identifier and is never quoted. The whole-name form,
   `` `ns::name` ``, still parses and resolves but is **deprecated**.

   Core reads both sides of `::` through one helper (`qualifiedNameText`,
   `pathSegmentText`); consumers do not split qualified names themselves.

This amends ADR-053, which defined `^.` and `$.` but said nothing about
whitespace. It supersedes no ADR.

## Consequences

- **Breaking for spaced paths.** Input that used to parse — and resolve to
  something unintended — is now a parse error. Every `.stm` file in the
  repository parsed identically before and after; the corpus has recovery
  cases for each rejected form.
- **The formatter can no longer change resolution through path spacing**,
  because no spaced path reaches it as valid input.
- **More inputs now produce error trees.** That makes two existing weaknesses
  more visible: format-on-save rewriting broken text (bsw-btjl) and `fmt
  --check` passing unparseable files (fixed in bsw-u11n).
- **The deprecated quoting needs a migration path.** Docs and examples use the
  new form; a few test fixtures keep the old one on purpose so its support
  stays tested. A lint rule with an auto-fix, and any removal date, are
  tracked in bsw-qdep.
- **Path identity is not settled here.** Resolved paths are still joined with
  `.`, so a field named `` `a.b` `` and a nested `a { b }` share an identity.
  That needs its own decision (bsw-h3qg).

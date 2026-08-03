# ADR-041 — One Coverage Entry Per Path: A Spread Cannot Redeclare a Field the Body Declared

**Status:** Accepted
**Date:** 2026-08-03 (sl-qead, feature 38)

## Context

ADR-035 settled what identifies a coverage entry: **the qualified field path from
the schema root, and nothing else.** It said so as a rule about *lookup* — a
covered-path set keyed by path rather than by bare field name, and every consumer
obliged to build a qualified path before probing it. It did not say the
corresponding thing about *emission*, and the omission turned out to matter:
nothing in core guaranteed that the list of declared fields a schema produces
holds each path once.

It did not, and a shipped example proved it. `expandDeclaredFields()` in
`spread-expand.ts` answers "what fields does this schema declare?" by
concatenating the fields the body wrote out with the fields its fragment spreads
contribute. `expandEntityFields()` returned every field of every resolved
fragment, including names the body had already declared itself, so a schema that
both wrote out a field and spread a fragment declaring it got two
`FieldCoverageEntry` rows with an identical `path`.

`examples/namespaces/ns-platform.stm`'s `vault::sat_contact_details` declares
`load_ts` and spreads `...standard_metadata`, which declares it again. Coverage
reported eleven leaves for a ten-leaf schema, and `coverage --json` listed
`load_ts` twice in `fields[]`. The same shape is in
`tooling/satsuma-cli/test/fixtures/platform.stm`; a sweep of `examples/` found no
other case.

Two things follow from a duplicated path, and both are worse than a cosmetic
repeat.

**The percentage moves with how many times a name is written.** The duplicate
lands in the denominator, and when the field is mapped it lands in the numerator
too. Three distinct leaves with two mapped reported 3/4 rather than 2/3. The
error is not symmetric: a redeclared field is more likely to be a mapped one
(authors write out the fields they are working with), so the bias is toward
*overstating* coverage — the one direction a `--fail-under` merge gate must not
fail in, and the same failure mode ADR-035 and ADR-040 were each written to close
from a different side.

**A path-keyed consumer silently disagrees with the printed counts.** This is
the part ADR-035 owns. That ADR obliges consumers to treat the path as identity;
any consumer that does so — building a `Map` from `fields[]`, decorating a gutter
line, joining an overlay to a card — collapses the two entries into one and then
reports a total that does not match `total` in the same JSON object. The contract
was violated by the producer, on its own terms, and no consumer could detect it.

Underneath the counting bug sat an unanswered language question. The v2 spec said
nothing about a spread colliding with an explicitly declared field: not that it
overrides, not that it is an error, not that it warns. Tooling had therefore
picked a behaviour by accident — emit both — and that accident was the bug.

## Decision

**A spread contributes only those field names the body has not already declared,
and every consumer therefore sees each path exactly once.**

The rule has a language half and a tooling half, and they are the same rule
stated at two levels.

*In the language* (`docs/developer/SATSUMA-V2-SPEC.md` §5.1, "Redeclaring a
spread field"): an explicit declaration **shadows** a same-named field reached
through a spread. The body's declaration — its type, constraints and note —
stands, and the fragment's copy is not a second field. Where two spreads in the
same body declare a name, the first wins. Shadowing is **whole-field, never a
merge**: if the body declares a record and a spread declares a record of the same
name, the body's record stands entire and the fragment's version of its children
contributes nothing, so a reader can always predict the field set from the
nearest declaration.

Redeclaration stays **legal and undiagnosed**. The permissive reading is what the
shipped corpus relies on, and a stricter one would either warn on two example
files from day one or invalidate them outright. That the author gets no signal is
a real gap — a reader has to know a fragment's contents to see that `...meta`
adds less than it appears to — and it is booked as a separate warning-level lint
(sqdsp-00kv), not folded in here, because cleaning up or accepting the corpus
warnings is its own decision.

*In the tooling*: the rule is enforced once, in core's `expandEntityFields()`,
which threads a set of claimed names seeded from the entity's own fields and
skips any fragment field whose name is already claimed. Seeding from the entity's
own fields is what makes the **nested** form fall out for free —
`expandNestedSpreads()` passes a record's children as that entity's fields, so
`audit record { load_ts  ...meta }` goes through the identical path. Every
consumer that reports declared fields reaches this through
`expandDeclaredFields()`, so the CLI, the LSP gutter and the viz card cannot
disagree.

**This amends ADR-035.** Read together, the identity rule now has both halves:
a path identifies a coverage entry *and* a path identifies at most one coverage
entry. The second half is the producer-side obligation the first half had always
assumed.

## Consequences

**Positive:**

- Coverage figures no longer depend on how many times a name was written. A
  schema's percentage is a function of its distinct leaves.
- The correction moves figures **down**, which is the safe direction for a gate:
  a spec that was reported more complete than it is stops being.
- ADR-035's contract is now something a consumer can rely on rather than
  something it happens to get. Keying `fields[]` by path is safe.
- The language question is answered in the spec instead of being decided by
  whatever the expander happened to do, and the answer is the one an author would
  guess: the declaration in front of you wins.
- One rule, one place. Because it lives where spreads are resolved rather than in
  a per-consumer dedupe, the CLI, LSP and viz were fixed by the same change and a
  fourth consumer inherits it.

**Negative:**

- **Recorded coverage figures move.** `vault::sat_contact_details` goes from
  eleven leaves to ten; any workspace with a redeclaration re-baselines. As with
  ADR-035, a consumer cannot tell a correction from a regression by looking at
  the number.
- **A redeclaration is still silent.** This ADR makes the shadowing correct
  without making it visible, and the case where an author *meant* to override a
  fragment's type or constraints is indistinguishable from the case where they
  forgot the fragment already had the field. That gap is sqdsp-00kv.
- **Whole-field shadowing loses information the author may have wanted.** If the
  body declares `address record { number }` and the fragment declares `address
  record { street, city }`, the fragment's two children are dropped rather than
  merged. Merging is defensible and was rejected for predictability — but a
  future contributor could reasonably ask for it, and the corpus contains no case
  that forces the question either way.
- **Order now carries meaning between spreads.** "First spread wins" makes
  reordering two `...` lines a semantic change in the collision case. It is a
  rule nobody has to think about until two fragments overlap, at which point it
  is a rule they must know.

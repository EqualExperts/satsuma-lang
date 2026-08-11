# ancestor-escape

Demonstrates the ADR-053 ancestor-escape path prefixes (`^.field` and
`$.field`) inside a nested `each` block: a parent field is referenced from
inside an inner iteration, where the existing dot-prefixing rule would
otherwise produce a path that does not exist.

## Key features demonstrated

- `^.transect_ref` inside a nested `each` — the parent transect's ref populates
  a field on each child (sighting) element. This is the case the nested-iteration
  guide previously had to relegate to a `note`, because there was no structural
  notation for it.
- `$.survey_id` inside the same nested block — a root-absolute escape from two
  levels of nesting, ignoring both enclosing containers.
- The existing `.field` semantics are untouched: `.species_code` still resolves
  against the current element exactly as in `examples/nested-iteration/`.

## Entry point

`pipeline.stm` — main pipeline (imports nothing)

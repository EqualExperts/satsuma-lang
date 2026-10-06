---
id: sl-ttw0
status: open
deps: []
links: [sl-pn00]
created: 2026-08-02T21:42:32Z
type: task
priority: 3
assignee: Thorben Louw
---
# docs: extend the doc-snippet check to the spec and the rest of docs/

Repo checks run `satsuma fmt --check` over the example corpus, but nothing checks the Satsuma shown in docs/**/*.md. Guides drift from the tooling silently — sl-kood was one instance, and the spec section 4.4 example (sl-pn00) is another that has been wrong long enough for the corpus to be fixed around it.

Writing docs/nested-data/README.md needed an ad-hoc harness: extract every fenced satsuma block, assemble fragments into a complete file with the context they need, run validate + lint, and allow specific expected findings for blocks that exist to demonstrate a warning. That harness is the shape of the check.

The hard part is fragments — a block showing three arrows is not a file. Options: a fenced-info convention (satsuma fragment schema=colony_survey), a per-doc fixture preamble, or checking only blocks that are complete files and requiring guides to keep one.

## Acceptance Criteria

- `scripts/check-doc-snippets.mjs` covers docs/developer/SATSUMA-V2-SPEC.md and every other Markdown file under docs/ (conventions-*, data-modelling, developer, product-owner, using-satsuma-without-cli.md), not only the three directories in `DOC_DIRS` today.
- Every snippet in those files that the checker's teeth rule catches (a complete mapping with an `each` or `flatten` block) carries a `satsuma-check` annotation, and every annotated snippet passes.
- If the existing annotations cannot express a case the spec needs (for example a block whose point is to show a warning), the mechanism is extended and the extension is covered in check-doc-snippets.test.mjs.
- Any snippet left unchecked uses `skip — <why>` with a ticket reference where the reason is a defect.


## Notes


**2026-10-06T09:01:33Z**

Rescoped in the 2026-10-06 ticket audit. PR #599 (gh-525) built most of what this ticket asked for: scripts/check-doc-snippets.mjs validates fenced satsuma blocks through the CLI, with an opt-in `satsuma-check` annotation for fragments (`standalone`, `schemas from <file>`, `schemas from earlier snippets`, `skip — <why>`), and a test that fails on a broken block. It only reads docs/tutorials, docs/nested-data and lessons. What remains is the spec and the rest of docs/, so the description above is now historical and the acceptance criteria cover only that remainder.

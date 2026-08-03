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
# docs: verify fenced satsuma blocks in guides run, as part of repo checks

Repo checks run `satsuma fmt --check` over the example corpus, but nothing checks the Satsuma shown in docs/**/*.md. Guides drift from the tooling silently — sl-kood was one instance, and the spec section 4.4 example (sl-pn00) is another that has been wrong long enough for the corpus to be fixed around it.

Writing docs/nested-data/README.md needed an ad-hoc harness: extract every fenced satsuma block, assemble fragments into a complete file with the context they need, run validate + lint, and allow specific expected findings for blocks that exist to demonstrate a warning. That harness is the shape of the check.

The hard part is fragments — a block showing three arrows is not a file. Options: a fenced-info convention (satsuma fragment schema=colony_survey), a per-doc fixture preamble, or checking only blocks that are complete files and requiring guides to keep one.

## Acceptance Criteria

- A script validates every fenced satsuma block in docs/ (and SATSUMA-V2-SPEC.md), with a documented mechanism for fragments and for blocks whose point is a warning.
- Wired into scripts/run-repo-checks.sh.
- Failing on a deliberately broken block is covered by a test.
- Existing docs are made to pass, or the exceptions are listed with ticket references.


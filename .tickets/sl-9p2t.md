---
id: sl-9p2t
status: open
deps: []
links: [sl-3de8]
created: 2026-07-31T15:30:59Z
type: task
priority: 3
assignee: Thorben Louw
tags: [cli, docs, breaking]
---
# cli: extend the display key form to --json output across all commands

Human output stopped printing the empty '::' namespace prefix in 755ef6e (displayKey in index-builder.ts); --json still emits the canonical key. That split was deliberate and is documented, but it leaves one entity with two spellings depending on which output you ask for. This ticket is the decision to finish the job by dropping the prefix from --json too, or to keep the split permanently.

The case for finishing it: '::name' is not valid Satsuma syntax (qualified_name is identifier '::' identifier), so a consumer cannot paste a canonical key back into a file, into a --mapping/--schema flag, or into an @ref. Its only value is signalling 'global namespace' unambiguously, which a bare name already does given namespaced entities keep their 'ns::' prefix — there is no collision to disambiguate.

The case against: it is a breaking change to output shapes documented as stable, and at least one is consumed by the satsuma-viz coverage overlay.

## Design

Scope — every canonicalKey() call site that feeds JSON or is compared against JSON:

- commands/coverage.ts (toJson, aggregate JSON)
- commands/field-lineage.ts (field, via_mapping, upstream/downstream entries)
- commands/graph-builder.ts (node ids, edge endpoints)
- commands/mapping.ts (sources, targets)
- commands/arrows.ts (mapping, source, target) — NOTE :151/:185-187 COMPARE canonical forms when resolving NL refs; those comparisons must move together or matching silently breaks
- commands/where-used.ts (:94 JSON name; :179 cName is comparison, same caveat)
- nl-ref-extract.ts (:121, :126, :145)

Docs to update: SATSUMA-CLI.md:150,153,167,241-243 (coverage and field-lineage JSON examples), AI-AGENT-REFERENCE.md:376, and the coverage command's --help JSON shape block which currently reads 'canonical mapping key, e.g. "::load" or "ns::load"'. Remove the human-vs-JSON spelling note added to the coverage JSON contract section, since the distinction would no longer exist.

If the split is kept instead, close this as won't-do and keep that note as the explanation.

Sequencing: worth doing before feature 36's viz overlay consumes coverage --json, so the overlay is written against one spelling rather than migrated later.

## Acceptance Criteria

Decision recorded (finish it, or keep the split and close won't-do). If finishing: no canonicalKey() call remains on a JSON output path; canonicalKey and displayKey are reconciled to one function if the distinction no longer earns its place; the NL-ref comparison sites in arrows.ts and where-used.ts are migrated in the same change with tests proving @ref resolution still matches; every documented JSON example updated; a CHANGELOG.md entry names the affected commands and shows before/after, since agents and the viz overlay consume these shapes; full CLI suite passes.


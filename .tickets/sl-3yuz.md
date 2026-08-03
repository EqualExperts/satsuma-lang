---
id: sl-3yuz
status: open
deps: []
links: []
created: 2026-08-03T16:35:15Z
type: task
priority: 2
assignee: Thorben Louw
tags: [core, cli, lint, coverage]
---
# core+cli: export ADR-037's whole-structure rule from core instead of duplicating it in the lint engine

ADR-037's rule about which arrow declarations assert a correspondence over a whole structure is written twice, across a package boundary, and kept in step by a comment.

satsuma-core/src/coverage.ts:500 defines WHOLE_STRUCTURE_KINDS = ["map", "nested"] (not exported) and wraps it in the private predicate declaresCorrespondence at line 510: WHOLE_STRUCTURE_KINDS.includes(arrow.kind) && !arrow.enumeratesChildren, documented as conditions 1 AND 2 of ADR-037.

satsuma-cli/src/lint-engine.ts:565 defines the same set again as a Set, with a doc-comment stating it is 'kept in step with WHOLE_STRUCTURE_KINDS in core's coverage.ts, which gates the coverage behaviour this rule explains'. Its use at line 531 — !WHOLE_STRUCTURE_KINDS.has(arrow.kind) || arrow.enumeratesChildren — is exactly !declaresCorrespondence(arrow).

These are the only two copies; no third exists in the LSP, viz or viz-backend. A domain rule maintained across two packages by a prose 'keep in step' note is the Core-vs-Consumer violation CLAUDE.md describes: coverage and the unenumerated-record-target lint rule must agree by construction, because the lint rule exists to explain the coverage behaviour. Today a kind added to ArrowDeclarationKind can be admitted by one and not the other, and nothing fails.

## Design

Export core's predicate — declaresCorrespondence, or a public name that reads well at the lint call site — from the @satsuma/core/coverage entry point, with the ADR-037 citation moving to the exported doc-comment. Delete satsuma-cli's WHOLE_STRUCTURE_KINDS and call the core predicate from checkUnenumeratedRecordTarget. The substitution is semantics-preserving: the CLI's guard is the exact negation of the core predicate.

Keep the rule listed positively, as core's comment explains: a declaration kind added to the grammar must default to the conservative reading rather than silently inheriting a whole-structure claim.

Per CLAUDE.md's test-quality standards, consolidate the tests too — the invariant belongs in core's suite once, and the CLI keeps only its own diagnostic-shape coverage rather than re-testing which kinds qualify.

## Acceptance Criteria

WHOLE_STRUCTURE_KINDS exists in exactly one place. The CLI lint rule calls the exported core predicate and no longer names the kinds itself. Adding a kind to ArrowDeclarationKind changes coverage and the lint rule together, demonstrated by a test. Existing lint and coverage behaviour is unchanged: the unenumerated-record-target suite and core's coverage suite pass without expectation edits. Which kinds qualify is tested once, in core.


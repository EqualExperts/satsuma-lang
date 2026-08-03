# ADR-047 — Lint Policy Detection Lives in Core Beside Semantic Validation, With Its Own Finding Type

**Status:** Accepted
**Date:** 2026-08-03 (sl-j30s, sl-hysg)

## Context

ADR-020 put extraction in `satsuma-core` and left consumers as thin wiring.
ADR-025 followed it for **semantic validation**: the rules and their
orchestration live in `tooling/satsuma-core/src/validate.ts`, which returns
`SemanticDiagnostic` records, and both the CLI and the LSP adapt their own index
into core's structural `SemanticIndex` interfaces rather than re-implementing the
rules.

`lint` did not follow either. Every rule lived in
`tooling/satsuma-cli/src/lint-engine.ts` — registry, detection and text fixes in
one 680-line module — which was defensible while lint rules were about NL `@ref`
hygiene that only the CLI surfaced. Feature 37 changed that. Both new rules,
`type-mismatch-direct-arrow` and `lineage-cycle`, are natural editor diagnostics:
an author writing a mapping in VS Code wants the squiggle at the moment the arrow
is written, not on the next CI run. The precedent for what happens when detection
sits in a consumer is `duplicate-definition`, which had to be mirrored into the
LSP and, per `sl-rw3e`, drifted while it was.

That settled *where* the detection goes. The open question was the **output
type**. Core already had `SemanticDiagnostic` — `file`, `line`, `column`,
`severity`, `rule`, `message` — which is structurally exactly what a lint rule
needs to report, and reusing it would have avoided a second shape for the same
six fields.

Two alternatives were considered. **Reusing `SemanticDiagnostic`** was rejected on
what the two types mean rather than on what they hold. A `validate` diagnostic
asserts the workspace is *wrong*; a lint finding asserts it breaks a *policy* the
workspace may legitimately have chosen — the distinction the `validate`/`lint`
split exists to draw, and the reason only one of the two is suppressible through
`satsuma.config.yaml`. One type for both would make a rule's suppressibility
invisible in its signature, and would tie the LSP protocol boundary (which
`SemanticDiagnostic` crosses) to any field lint later needs. **Returning
structured facts and letting each consumer compose the message** was rejected
because the message is where the rule's reasoning lives: `type-mismatch`'s
message has to say which field, which type, and what to do about it, and two
consumers phrasing that differently is the same drift the move to core is meant
to prevent.

## Decision

**Detection for any lint rule that a second consumer will surface lives in
`satsuma-core`, as a pure function over structural input interfaces, returning
`LintFinding` — a type distinct from `SemanticDiagnostic`.** The consumer's rule
is a wrapper that resolves its own workspace model into those inputs and maps the
findings onto its diagnostic shape. Nothing else moves: the rule registry,
suppression, `--select`/`--ignore`, and text fixes stay with the consumer, because
fixes rewrite files on disk and core imports no Node built-ins.

`LintFinding` is defined in `tooling/satsuma-core/src/lint-findings.ts` and
carries the rule id, the severity **the rule itself defines**, a 1-indexed
position, and the finished message. Severity is not a caller parameter: a rule's
severity is part of its meaning, and letting a consumer choose it is how an editor
and CI come to disagree about the same finding.

Each detector follows ADR-025's input pattern — minimal structural interfaces
that the CLI's `ExtractedWorkspace` records and the LSP's index satisfy by
TypeScript duck typing, so neither package builds an adapter object — plus a
**resolver callback** for anything requiring workspace identity.
`DeclaredTypeSchemaResolver` and `LineageSchemaIdResolver` exist because
canonicalizing an authored schema reference is the consumer's business (ADR-039),
while what to *do* with the resolved schema is core's.

The two detectors are `tooling/satsuma-core/src/lint-type-mismatch.ts` and
`tooling/satsuma-core/src/lint-lineage-cycle.ts`. Their wrappers in
`lint-engine.ts` are twelve lines each. Settings a rule needs from
`satsuma.config.yaml` reach it through a `LintRuleContext` passed to every
`check()` call, rather than being captured when the registry is built, so `RULES`
stays a plain constant that `--rules` and the help text can list without a config
in hand.

Rule **semantics** are tested once, in core. Consumer tests cover registration,
severity mapping and output shape only.

## Consequences

**Positive:**

- The LSP can mirror both rules by writing an index adapter, with no rule logic
  to re-implement and no opportunity for the editor and CI to disagree — the
  `duplicate-definition` failure mode is closed before it opens.
- A rule's severity and message are properties of the rule, so every consumer
  reports the same finding in the same words.
- The type of a detector's return value now says whether its findings are policy
  or correctness, which is the same distinction `satsuma.config.yaml` acts on.
- Rule semantics have one test home. `lint-type-mismatch.test.js` and
  `lint-lineage-cycle.test.js` build their inputs from core's own extraction, so
  a change to how types or arrow paths are extracted fails there rather than in a
  consumer.
- Detectors are pure functions over plain data, so a graph-theoretic rule can be
  tested without a parser fixture or a filesystem.

**Negative:**

- Core now has two structurally identical diagnostic types. A reader
  encountering both must read the header of `lint-findings.ts` to learn why, and
  a future contributor may reasonably propose merging them.
- Each detector needs its own structural input interfaces and resolver callback,
  which is more surface than a function taking `ExtractedWorkspace` directly, and
  the interfaces must be kept in step with the records that satisfy them —
  duck typing means a renamed field on `ArrowRecord` fails at the wrapper, not at
  the detector.
- Lint is now split across two packages: detection in core, registry and fixes in
  the CLI. Adding a rule means touching both, and reading how lint works means
  reading both.
- The split is only justified for rules a second consumer will surface. A
  CLI-only rule put in core would pay this cost for nothing, so the boundary
  needs judgement per rule rather than a blanket "all rules in core".

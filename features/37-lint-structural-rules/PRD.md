# Feature 37 — Structural Lint Rules: Type Mismatch & Lineage Cycles

> **Status: COMPLETE** (2026-08-03) — independent of Features 35/36; shares
> their motivation. Large multi-layer mapping specs — especially ones
> reverse-engineered from spreadsheet workbooks — accumulate two classes of
> silent structural defect that the current toolchain accepts without
> comment: bare arrows connecting fields of different declared types, and
> unintended cycles in the schema-level lineage graph.

## Goal

Add two deterministic, parser-backed rules to `satsuma lint`:

1. `type-mismatch-direct-arrow` — a bare arrow (no transform body) connects
   two fields whose declared types differ.
2. `lineage-cycle` — the schema-level mapping graph contains a cycle that is
   not an intentional self-mapping.

The primary success criteria are:

1. **Copy-paste and drift errors surface at lint time.** A `STRING → DATE`
   bare arrow — almost always a wrong field reference, a stale type after a
   schema edit, or a missing transform — is flagged with both declared types
   in the message.
2. **No false pressure on legitimate specs.** Arrows with transform bodies
   are exempt (a transform may legitimately change type), self-mappings are
   exempt (an explicit, documented design decision), and both rules are
   warnings, not errors — `validate` semantics are unchanged.
3. **Each cycle is reported exactly once**, as a readable path
   (`a → b → c → a`), not once per participating mapping.
4. **The rules are documented and machine-consumable** via the existing
   `lint --json` output and the rules table in `SATSUMA-CLI.md`.

## Background

- The lint framework exists: `tooling/satsuma-cli/src/lint-engine.ts` +
  `commands/lint.ts`, currently shipping three rules
  (`hidden-source-in-nl` error/fixable, `unresolved-nl-ref` warning,
  `duplicate-definition` error). `validate` owns structural correctness;
  `lint` owns policy and convention — both new rules are policy (a type
  mismatch or cycle can be intentional), so they belong in lint at warning
  severity.
- Arrow transform classification is already deterministic and simple
  (`SATSUMA-CLI.md` § Transform Classification): `none` (bare
  `src -> tgt`), `nl` (any transform body — all pipe content is natural
  language by design), `nl-derived` (synthetic arrow inferred from an NL
  `@ref`). This gives the type-mismatch rule a crisp applicability
  criterion: **only `none` arrows**. Any transform body means the spec
  author has said "something happens here", and judging whether that
  something preserves type is NL interpretation — which the CLI's design
  principle explicitly leaves to agents.
- Field types are declared in schemas and already extracted (`satsuma
  fields <schema>` returns them), so both sides of a bare arrow have
  resolvable declared types whenever the author provided them.
- Cycle policy is already decided in `docs/product-owner/ROADMAP.md`:
  *"self-mappings (same source and target schema) are OK — we can use that
  to represent things like increments, and DON'T cause graph cycles."* The
  carve-out is a recorded product decision, not an implementation
  convenience, and the rule must cite it.
- Traversal code already defends against cycles — `field-lineage` is
  documented as cycle-guarded (`tooling/satsuma-cli/src/commands/
  field-lineage.ts`) — but guarding is not reporting: a traversal that
  quietly stops at a visited node hides the cycle from the one audience
  (spec reviewers) who need to know it exists.

## Problems

### P1 — Bare arrows between incompatible types are silent

In a spec spanning several representation layers, the same logical field is
declared repeatedly with per-layer types. A bare arrow asserting "these are
the same value, unchanged" between fields declared as different types is
almost always one of: a mis-picked field (adjacent-row copy-paste in the
source workbook), a schema edit that outran its mappings, or a transform
that was never written down. Today nothing flags it — `validate` checks
references resolve, not that the assertion is coherent — so the error
survives until a human happens to read that arrow.

### P2 — Unintended lineage cycles are invisible

A cycle across distinct schemas (`a → b` in one mapping, `b → a` in
another) is occasionally intentional (bidirectional sync specs) but more
often a mistake: a reversed arrow, or two mappings authored independently
that disagree about direction. Because traversal is cycle-guarded, the
symptom is subtle — lineage output that silently omits expected upstream
hops — and users have no diagnostic pointing at the cause. The self-mapping
decision in the roadmap explicitly anticipated distinguishing benign
self-loops from real cycles; the "real cycles" half was never built.

### P3 — Rule logic risks landing in the wrong package

Per the Core vs Consumer rule and the established precedent of
duplicate-definition detection being surfaced by both the CLI and the LSP,
any rule the LSP will eventually mirror as an editor diagnostic must have
its detection logic in `@satsuma/core`, not in `satsuma-cli/src/lint-engine.ts`.
Both of these rules are natural editor diagnostics.

## Requirements

### R1 — `type-mismatch-direct-arrow` rule (fixes P1)

- **Applies to**: arrows classified `none` only. Arrows classified `nl` are
  skipped entirely; `nl-derived` synthetic arrows are skipped (they carry no
  authored type assertion).
- **Check**: resolve the declared type of the source field and target
  field. If both are present and their normalized forms differ, report a
  warning naming both fields and both types.
- **Normalization (initial)**: case-insensitive exact match on the declared
  type token, with parameterized forms compared on the base token (e.g.
  declared lengths/precision do not count as mismatches in v1). No
  cross-type compatibility table in v1 — see Open Questions.
- **Skips silently**: either side lacking a declared type; either field
  unresolvable (that's `validate`'s territory).
- **Value-map arrows are always exempt, and this is decidable today** — no
  hedging needed. `map_literal` is a `pipe_step` (`grammar.js:483-488`), and
  `classifyTransform` returns `nl` for any non-empty pipe chain
  (`satsuma-core/src/classify.ts:26-28`). An arrow bearing a `map { … }`
  therefore always classifies `nl` and is skipped by the `none`-only
  criterion, with no special case in the rule. A regression test must lock
  this: a future refactor that classifies map literals separately would
  silently start type-checking value maps, which convert values and so may
  legitimately change type.
- **Severity**: warning. **Fixable**: no (the fix is a human judgement:
  correct the field, correct the type, or add the missing transform).
- Message format includes both qualified field paths and both declared
  types, so `lint --json` consumers can group by type-pair.

### R2 — `lineage-cycle` rule (fixes P2)

- **Graph**: schema-level directed edges from each mapping's source schemas
  to its target schemas (the same edge semantics as `satsuma lineage` /
  `graph --compact`).
- **Exemption**: edges where source schema == target schema (self-mappings)
  are excluded before cycle detection, citing the roadmap decision in the
  rule's doc comment.
- **Detection: one cycle per strongly-connected component**, not every
  elementary cycle. Compute the SCCs of the schema graph (Tarjan); each SCC
  with more than one node — or a single node with a retained self-edge — is
  one finding, reported as one representative cycle through it.

  Enumerating elementary cycles (Johnson) is output-exponential: a densely
  cross-linked platform graph can contain combinatorially many cycles that
  all describe *the same* tangle of mappings, which is why R2 originally
  needed a truncation cap. SCC-per-finding removes the need for the cap
  entirely, and matches what the reviewer must actually do — untangle the
  component, not audit each rotation through it. The count is bounded by the
  number of schemas, so there is no scale guard and nothing is truncated.
- **Stability**: the representative cycle is canonicalised — enter the SCC at
  its lexicographically smallest schema id and walk a deterministic shortest
  cycle from there — so output does not vary with run order or file order.
- **Message**: the representative cycle path (`crm::a → billing::b → crm::a`)
  plus the mapping name responsible for each edge — the reviewer's next
  question is always "which mapping do I look at?". When the component holds
  more schemas than the representative path shows, name them ("component also
  includes: …") so nothing in the tangle is hidden.
- **Severity**: warning. **Fixable**: no.

### R3 — Detection logic in core, surfaced by the CLI (fixes P3)

- Both detectors are implemented in `@satsuma/core` operating on core
  extraction types, with `lint-engine.ts` registering thin rule wrappers.
- Tests for detection semantics live in core; CLI-level tests cover rule
  registration, severity, message formatting, and `--json` shape only (test
  each invariant once).
- LSP mirroring of the two diagnostics is explicitly deferred (see Out of
  Scope) but must require no re-implementation when picked up.

### R4 — Workspace config file: `satsuma.config.yaml`

Resolves Open Questions 1–3. A YAML config, default path
`./satsuma.config.yaml`, overridable with `--config <path>`:

- `lint.suppress`: list of rule ids excluded from all runs.
- `lint.typeAliases`: alias groups consumed by R1 (a group declaring
  `STRING`/`TEXT`/`VARCHAR` equivalent).
- `lint.strict`: escalate warnings to a failing exit code.

Loader and config types live in `@satsuma/core` — the LSP needs the same
config when it mirrors these diagnostics. A missing file is not an error (all
defaults); malformed YAML fails loudly.

**Naming**: `satsuma.config.yaml`, not a dotfile. `.satsuma` is a first-class
Satsuma *source* extension (`SATSUMA_FILE_EXTENSIONS = [".stm", ".satsuma"]`,
`core/source-files.ts:18`), so a config named `.satsumacfg` sits one character
from a source-file glob and gets no editor YAML association or schema support.

**Precedence — keep it simple**: `lint.suppress` is the persistent form of the
existing `--ignore <rules>` flag (`SATSUMA-CLI.md:104`), not a new mechanism.
One rule, stated once: **flags win over config, and the union of
`--ignore` + `lint.suppress` is suppressed.** `--select` continues to mean
"run exactly these", so an explicitly selected rule runs even if the config
suppresses it — selecting a rule by name is an unambiguous instruction to run
it. Config suppression reuses the existing rule-id validation, so a typo in
`lint.suppress` is reported the same way as a typo in `--ignore`.

### R5 — Lint exit codes get their own documented table (fixes P1, P2)

`lint` already contradicts the CLI-wide exit-code table: `commands/lint.ts:114`
returns `EXIT_PARSE_ERROR` (`2`) when there are **error-severity findings**,
where `2` is documented as "parse error or filesystem error"
(`SATSUMA-CLI.md:164-169`). Adding strict mode would make `1` — documented as
"not found / no results" — mean "warnings present", giving all three codes a
third meaning.

Before strict mode ships, `lint` publishes its own exit-code table, following
the `fmt` precedent (`SATSUMA-CLI.md:86`):

| Code | Meaning |
|---|---|
| 0 | No findings, or warnings only without `--strict` |
| 1 | Warnings present and `--strict` active |
| 2 | Error-severity findings present |
| 3 | Parse or filesystem error (lint could not run) |

This moves lint's "could not run" case off `2` and leaves `2` meaning "the
workspace has lint errors" — the meaning it already has in practice. It is a
breaking change for any CI job keying off lint's current codes, so it must be
called out in `CHANGELOG.md`. Suppressed rules never trigger a strict failure.

### R6 — Documentation (fixes P1, P2)

- Add both rules to the `SATSUMA-CLI.md` lint rules table with severity and
  fixability.
- Document the `satsuma.config.yaml` schema with commented examples, and the
  lint exit-code table from R5.
- Document the exemptions prominently: transform-bearing arrows are never
  type-checked (with the design-principle rationale), and self-mappings are
  never cycles (with the roadmap citation).
- Update `AI-AGENT-REFERENCE.md` so agents drafting mappings know a bare
  arrow asserts type-preserving identity and a transform body suppresses
  the check — this makes the rule a forcing function for honest specs.

## Acceptance Tests

Minimal-snippet cases (per test quality standards):

- Bare arrow `STRING → DATE` → one `type-mismatch-direct-arrow` warning
  naming both fields and types.
- Same fields with any transform body → no warning.
- Bare arrow between same-type fields with different case/parameters
  (`String` vs `STRING`; parameterized vs bare base token) → no warning.
- Arrow where one side has no declared type → no warning.
- An arrow bearing a `map { … }` value map between differently-typed fields →
  no warning (locks the classification reasoning in R1).
- Two mappings forming `a → b → a` → exactly one `lineage-cycle` warning
  with the canonical path and both mapping names.
- Self-mapping (`a → a`) → no warning (regression-locks the roadmap
  decision).
- Three-schema cycle reported once regardless of file/mapping declaration
  order.
- A densely connected component containing several elementary cycles → one
  finding, naming the other schemas in the component (locks SCC-per-finding
  rather than per-rotation reporting).
- `lint --json` includes both rules with stable ids, severities, and
  locations.
- Config: `lint.suppress` removes a rule; `--select` on a config-suppressed
  rule still runs it; an alias group makes an otherwise-mismatching type pair
  pass; a missing config file yields defaults silently; a malformed one exits
  `3` with an actionable message.
- Lint exit codes: clean → 0; warnings without `--strict` → 0; warnings with
  `--strict` → 1; error findings → 2; unparseable workspace → 3.

## Out of Scope

- LSP diagnostics for these rules (follow-up once core detectors exist).
- A **built-in** type-compatibility matrix (widening conversions, a shipped
  `TEXT`/`STRING` equivalence table). Deciding those equivalences on users'
  behalf requires a convention decision this feature does not make. Users
  declare their own equivalences via `lint.typeAliases` (R4); nothing is
  presumed equivalent by default beyond base-token equality.
- Field-level cycle detection (the schema-level graph is the reviewable
  unit; field-level traversal already guards itself).
- Autofixes for either rule.
- Any change to `validate` — both findings remain policy warnings.

## Open Questions

1. **Type alias table**: should `TEXT`/`STRING`/`VARCHAR`-style equivalences
   be recognized in v1, and if so where does the table live (a documented
   convention in `docs/conventions-for-schema-formats/`, consumed by core)?
   Proposed: ship v1 with base-token equality only, gather false-positive
   data from real workspaces, then decide. **RESOLVED** — ship a YAML config
   (default `./satsuma.config.yaml`, `--config` override) with a type-alias
   section and lint rule suppression. Specified in R4. Config file name
   changed from the originally proposed `.satsumacfg` to avoid collision with
   the `.satsuma` source extension (see R4).
2. **Suppression mechanism**: lint has no *per-line* suppression (it does
   already have run-scoped `--select` / `--ignore` flags —
   `SATSUMA-CLI.md:104`). Is an intentional cross-schema cycle common enough
   to need per-line suppression (e.g. a metadata token on the mapping), or is
   "warnings are advisory" sufficient for v1? **RESOLVED** — advisory is
   sufficient; no per-line suppression in v1. Workspace-wide suppression via
   `lint.suppress` in the config, defined in R4 as the persistent form of the
   existing `--ignore` flag rather than a parallel mechanism.
3. **Severity escalation**: should CI users be able to promote these
   warnings to errors (`lint --strict` or per-rule severity config)? That's
   a lint-framework feature, not specific to these rules, but these two may
   be what first creates the demand. **RESOLVED** — yes, via exit code:
   `--strict` (or `lint.strict`) makes warnings exit non-zero. This forced
   lint's exit codes to be pinned down properly; see R5.

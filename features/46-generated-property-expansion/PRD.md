# Feature 46 — Generated-Input Confidence for Diagnostics and Editor Intelligence

> **Status: PROPOSED** (raised 2026-08-06) — raised while assessing where else
> the generated-property machinery from Features 39 and 41 pays off, now that
> `@satsuma/scenario-gen` is a package every suite can reach.
>
> **State this PRD was checked against:** `main` at `15d143ee`.
>
> **Recommendation.** Proceed, in the order R1 → R2 → R3 → R4 → R5 → R6. Two
> structural gaps are worth closing and the rest is opportunistic. The first gap
> is that **every generated workspace in the repository is valid by
> construction**, so the whole diagnostic surface — `validate`, `lint`, and the
> LSP's mirror of both — is still proved by fixtures a person wrote. The second
> is that **the LSP has no generated coverage at all**, even though three of its
> features are inverse relations over ground truth the generator already states.
>
> **What this feature is not.** It changes no Satsuma syntax, no diagnostic
> semantics, no rule severities and no command output. It adds no user-facing
> surface. Every deliverable is a test, a test-only generator addition, or a
> doc. If a property fails against current behaviour, that is a bug ticket, not
> a licence to change the behaviour under cover of this feature.

## Goal

Make the diagnostic and editor-intelligence surfaces defend their own invariants,
so that a missed diagnostic, a spurious one, a reference the editor cannot find,
or a rename that corrupts a workspace fails a test instead of shipping.

1. A workspace with one known defect produces exactly the diagnostics that defect
   predicts — no fewer (missed) and no more (spurious).
2. A change that preserves semantics produces no new diagnostic at all.
3. `references`, `definition` and `rename` agree with the declared usage sites of
   a workspace whose shape the test chose.
4. A rename is proved to preserve the workspace, not assumed to.
5. The formatter is proved to preserve meaning, not only shape (R7 — adjacent to
   the goal rather than part of it, and included because the property is one
   test against machinery that already exists).

## Background — measured state

### What generated suites cover today

| Package | Suite | What it proves |
|---|---|---|
| `satsuma-core` | `generated-coverage-oracle`, `generated-coverage-properties` | coverage semantics against an independent oracle (Feature 39 R4) |
| `satsuma-core` | `generated-format-properties` | formatter idempotence, CST preservation, no recovery nodes |
| `satsuma-cli` | `generated-workspace` | every generated workspace parses and validates clean |
| `satsuma-cli` | `generated-edge-invariants` | nothing invented, nothing dropped, order-invariance |
| `satsuma-cli` | `field-lineage-reachability` | upstream/downstream is reachability over declared edges |
| `satsuma-viz` | `generated-edge-completeness` | the layout draws every declared arrow |
| `integration-tests` | `field-edge-parity` | the CLI and the VizModel agree about edges |

Every row asserts a property of the form *"the tool accepts this valid input and
returns the right answer"*.

### Gap 1 — the negative surface is entirely hand-picked

`workspace-arbitraries.js` builds well-formed workspaces on purpose: Feature 41
needed input the toolchain accepts, and `generated-workspace.test.ts` asserts
exactly that ("produces no semantic diagnostic for any generated workspace").
Nothing generates input the toolchain should *reject*.

The diagnostic surface that is therefore fixture-only:

| Site | Rules |
|---|---|
| `satsuma-core/src/validate.ts` | `duplicate-definition`, `undefined-ref`, `field-not-in-schema`, `unresolved-nl-ref`, `nl-ref-not-in-source`, `constraint-in-type-args`, `namespace-metadata-conflict` |
| `satsuma-core/src/import-reachability.ts` | import-scope violations (ADR-022 selective transitive reachability), with a caller-supplied rule/message policy |
| `satsuma-cli/src/lint-engine.ts` `RULES` | `hidden-source-in-nl`, `unresolved-nl-ref`, `duplicate-definition`, `unenumerated-record-target`, `type-mismatch-direct-arrow`, `lineage-cycle` — the last two registered through the `TYPE_MISMATCH_RULE_ID` and `LINEAGE_CYCLE_RULE_ID` constants core exports, so all six are reachable from `satsuma lint` |

The bug history is concentrated here and has the shape a generator finds cheaply:
`sl-rw3e` (duplicates reported at one site but not the other), `sl-padl` and
`lnd-qqo7` (namespace duplicates), `validate-bugs.test.ts` and
`namespace-bugs.test.ts` — both files named after batches of hand-found defects.

Two directions matter equally, and fixtures under-sample the second badly. A
fixture suite is written by someone thinking "does it catch this?", so **spurious**
diagnostics on legal-but-unusual input are found by users, not by tests.

### Gap 2 — the LSP has no generated coverage, and its oracle is free

`satsuma-lsp` is the only consumer package that does not depend on
`@satsuma/scenario-gen`. Its 26 test files are fixture-driven.

Three of its features are inverse relations over data the generator already
produces, so they need no new oracle — only an adapter:

- `references(decl)` must be exactly the usage sites the scenario declares.
- `definition(usage)` must be the declaration, for every usage.
- Duality: `x ∈ references(d)` iff `definition(x) = d`.
- `rename` must preserve the declared edge set modulo the rename, and the renamed
  workspace must still validate clean.

`rename.ts` and `references.ts` both delegate to `workspace-index.ts`'s
`resolveDefinition` / `findReferences` / `resolveReferenceKey`, so one adapter
reaches all three features.

## Requirements

### R1 — A defect-mutator layer in `@satsuma/scenario-gen`

Add `src/mutators.js`: functions that take a valid generated workspace and return
a **`WorkspaceDefect`** — the mutated workspace plus the diagnostics the mutation
predicts.

```
WorkspaceDefect = {
  workspace,              // the mutated scenario
  mutation,               // { kind, target } — what was broken, for failure messages
  expected: [             // every diagnostic this mutation predicts, and no others
    { rule, file, entity, line }
  ]
}
```

Two design rules make this honest rather than circular:

**The predicted set is complete, not minimal.** One defect can legitimately
cascade — deleting a field breaks every arrow that names it. An "exactly one
diagnostic" oracle would be wrong, so a mutator must enumerate *all* the
diagnostics it causes. A mutator that cannot predict its own full consequence set
does not belong in this package.

**A mutator states its precondition and the property checks it.** A mutator that
silently produces still-valid Satsuma would fail the suite for the wrong reason.
Each property therefore asserts the pre-mutation workspace validates clean, then
applies the mutation, so a vacuous mutation fails visibly and is not mistaken for
a missed diagnostic.

Mutators must stay pure data-to-data, with no dependency on `@satsuma/core` — the
same rule the package already has, and for the same cycle reason.

Initial set, one per rule the mutation can reach: delete a field a target arrow
names; duplicate an entity into a second file; duplicate an entity within one
file; break an `import`; reference an undefined entity; point an NL `@ref` at a
name no source declares; introduce a lineage cycle; change a field's declared
type so a bare arrow connects mismatched types; add a second declaration of a
namespace-level metadata tag with a conflicting value.

Also deliver **null mutators** — changes that must produce no new diagnostic at
all: reorder declarations, split declarations across more files, reformat, rename
an entity consistently everywhere. `workspace-arbitraries.js` already has
`permuteWorkspaceDeclarations` and `splitWorkspaceAcrossFiles`; this requirement
promotes them from "the edge set is stable" to "the diagnostic set is stable".

### R2 — Diagnostic properties over mutated workspaces

Properties in `satsuma-cli` (whole-workspace `validate` and `lint`) driven through
the existing `test/support/generated-workspace.ts` adapter:

- The diagnostic set for a mutated workspace equals `expected`, compared as sets
  of `(rule, file, entity)`. Both directions — a missing entry is a missed
  diagnostic, an extra entry is a spurious one.
- Reported positions land inside the mutated construct.
- Every null mutation leaves the diagnostic set unchanged.
- `lint --select`/`--ignore` partition the findings: selecting a rule yields
  exactly that rule's findings from the unfiltered run.

### R3 — An LSP scenario adapter, and definition/references duality

Add `tooling/satsuma-lsp/test/support/generated-workspace.ts`: render a generated
workspace to in-memory documents, build a `WorkspaceIndex`, and expose position
lookup for a declared entity or usage site. This is the first generated suite in
the LSP, so the adapter is the deliverable as much as the properties are.

Properties: the four inverse relations listed under Gap 2, over
`workspaceScenarioArbitrary`, including the namespaced and multi-file domains
where the reference key is not simply the authored spelling.

### R4 — Rename round-trip

For every entity in a generated workspace, rename it to a name the workspace does
not use, apply the `WorkspaceEdit`, then reparse:

- The workspace still validates clean.
- The declared edge set is identical modulo the rename.
- No occurrence of the old name survives, and no occurrence of an *unrelated*
  entity's name changed.

The fresh-name choice belongs to the property, not the arbitrary: renaming onto an
existing name is a legitimate collision the editor may reject, and is a separate
case rather than part of the round-trip.

### R5 — `diff` algebra and mutation oracle

- `diff(w, w)` is empty for every generated workspace.
- `diff` is empty across every null mutation from R1 — reordering and reformatting
  are not changes.
- After one R1 mutation, `diff` reports that change and nothing else.

Depends on R1 for its mutators, which is why it follows R2 rather than leading.

### R6 — Inverse-relation properties for the query commands

`where-used`, `find` and `arrows` answer questions the ground truth already
states. For every declared field, `where-used` must return exactly the arrows
`scenarioFieldEdges` says touch it. Cheap once R3 has shown the pattern; listed
last because the commands are read-only and their blast radius is smallest.

### R7 — The formatter preserves semantics, not just shape

`generated-format-properties.test.js` proves the formatter is idempotent,
preserves CST structure, and reparses without recovery nodes. All three are
claims about *shape*. Nothing proves the formatter preserves *meaning*.

A formatter that dropped the trailing source of a multi-source arrow, or
re-associated a pipe chain, would keep the CST well-formed and pass every
property in that file. The missing property spans the whole pipeline the
formatter can damage:

`extract(parse(src))` deep-equals `extract(parse(format(src)))`, compared over
the extracted semantic index rather than over text or CST.

No new oracle is needed — `test/support/scenario-pipeline.js` already drives
parse and extract. Independent of R1's mutators and R3's adapter, so it is
unblocked today.

## Ticket map

Epic: **`gpt-uazn`**.

| Req | Ticket | Title | Depends on |
|---|---|---|---|
| R1 | `gpt-pwze` | defect mutators and the `WorkspaceDefect` contract | — |
| R2 | `gpt-vq0r` | validate and lint properties over mutated workspaces | `gpt-pwze` |
| R3 | `gpt-21jp` | LSP scenario adapter; definition/references duality | — |
| R4 | `gpt-8izj` | rename round-trip | `gpt-21jp` |
| R5 | `gpt-ocmp` | `diff` algebra and mutation oracle | `gpt-pwze` |
| R6 | `gpt-clpj` | inverse-relation properties for `where-used`/`find`/`arrows` | — |
| R7 | `gpt-h0dc` | the formatter preserves semantics, not just shape | — |

R1, R3, R6 and R7 are unblocked today.

One ticket outside the requirement set, raised by this feature's own planning
rather than by its goal:

| Ticket | Title |
|---|---|
| `gpt-o0fk` | pin the registered lint rule set against the docs, like `docs.test.ts` does for commands |

See decision 3 for why. It is linked to the epic rather than parented to it: the
epic's acceptance is R1–R7, and this is hygiene the feature happened to expose.

## Acceptance tests

Each requirement is accepted by a **mutation check**: the property must be shown
to fail against a deliberately broken implementation, and the counterexample must
name the defect. A property that passes both before and after the break proves
nothing.

| Req | Break this | The property must fail with |
|---|---|---|
| R2 | suppress the `duplicate-definition` push in `validate.ts` `checkDuplicates` | the missing rule and the duplicated entity |
| R2 | make `checkDuplicates` fire on same-name entities in unrelated entry files | a spurious diagnostic, on a null mutation |
| R3 | make `resolveReferenceKey` return the authored spelling instead of the canonical name | a namespaced usage site missing from `references` |
| R4 | drop the cross-file edits from the rename `WorkspaceEdit` | a surviving old-name occurrence, or a broken edge |
| R5 | make `diff` compare formatted text rather than structure | a non-empty diff for a reformat null mutation |
| R6 | drop NL-derived edges from `where-used` | a declared arrow missing for an `@ref`-touched field |
| R7 | make `format` drop the trailing source of a multi-source arrow | the semantic property failing, naming the arrow — while the existing CST-preservation and idempotence properties both still pass |

R7 additionally needs the **negative** half of its mutation check: a shape-only
defect, such as altered indentation, must *not* fail the semantic property. That
belongs to the existing idempotence test, and a property that fires on both is
not testing what it claims to.

Every property carries a purpose comment naming the invariant or defect class it
defends, and failures report the seed, the mutation and the shrunk Satsuma source
— the standard `generated-edge-invariants.test.ts` set.

## Decisions

**1. Mutators go in `scenario-gen`, not in each consumer's adapter.** A mutation
is a statement about a scenario, so it is the same kind of thing the package
already owns. Predicted diagnostics are named by rule id and entity, never by
message text or byte offset — message wording is a consumer concern and would
make the generator a second implementation of diagnostic formatting.

**2. The LSP adapter does not reuse the CLI's.** The CLI's
`test/support/generated-workspace.ts` writes to disk and loads through the entry
file's import graph; the LSP indexes a folder of in-memory documents. Those are
genuinely different pipelines — `sl-rw3e` exists because they scope duplicates
differently — so sharing an adapter would hide exactly the class of defect this
feature targets.

**3. All six lint rules are in scope for R2, including `lineage-cycle` and
`type-mismatch-direct-arrow`.** An earlier draft of this PRD claimed those two
were exported from core but never registered with the CLI's engine. That was
wrong: `lint-engine.ts` registers them through the `TYPE_MISMATCH_RULE_ID` and
`LINEAGE_CYCLE_RULE_ID` constants rather than as literal id strings, and
`lint-command.test.ts` already drives both end to end. Nothing is missing, and no
bug arises from this. It is recorded here because a rule registered through a
constant is easy to miss when auditing the registry by eye — including for the
R1 mutator set, which must cover all six.

The near-miss is worth one cheap test, raised as **`gpt-o0fk`**: nothing pins
the registered rule set. `lint-command.test.ts`'s `--rules` case asserts only
that two named rules appear, not that the printed list *is* the registry, and
nothing checks it against `SATSUMA-CLI.md`'s rule table. `docs.test.ts` already
does exactly this for commands (`sl-w1dr`), so the pattern and the home both
exist. That ticket makes the registry auditable; it does not restyle it.

**4. R2 asserts diagnostic positions to the mutated construct, not to the exact
line.** Confirmed by the project owner, 2026-08-06. An exact line number couples
the properties to the renderer's layout choices, and `scenario-gen` deliberately
owns rendering. `WorkspaceDefect.expected` therefore carries a position only as a
hint for failure messages; the assertion is containment. If diagnostic positions
later become part of the public contract, this is the decision to revisit.

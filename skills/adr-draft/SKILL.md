---
name: adr-draft
description: Review recent changes and determine whether a new Architectural Decision Record is warranted. If so, draft it (and mark any superseded ADRs) for user review before writing to adrs/.
license: MIT
metadata:
  author: satsuma
  version: "1.0"
---

# ADR Draft Skill

You are reviewing recent work to decide whether it represents an architectural
decision worth recording. ADRs capture the *why* behind structural choices so
that future contributors (human or AI) understand the constraints that shaped
the codebase.

## Arguments

`$ARGUMENTS` is optional context describing what changed (e.g. a PR title or
branch name). If omitted, inspect the current branch's commits against `main`.

---

## Step 1 — Gather Context

Run these commands to understand what changed:

```bash
# Commits on the current branch not yet in main
git log main..HEAD --oneline

# Full diff of everything changed
git diff main..HEAD --stat
```

Also read:
- `adrs/` — every existing ADR (filename + first 10 lines to get Status and title)
- `docs/developer/ARCHITECTURE.md` — current architecture overview

---

## Step 2 — Assess Whether an ADR Is Warranted

An ADR is warranted when a change:

- Introduces or changes a **tool, library, or framework** used across the system
- Establishes a **new abstraction boundary** (e.g. a new shared package, a new
  interface pattern)
- Makes a **non-obvious trade-off** that a future contributor might reasonably
  question or reverse
- **Replaces or reverses** a previous decision (which means the old ADR must be
  marked Superseded)
- Sets a **convention** that must be followed consistently (naming, file layout,
  output format contracts)

An ADR is **not** warranted for:
- Bug fixes that don't change the design
- Documentation-only changes
- Refactors that preserve the existing design (same abstraction, cleaner code)
- Adding tests or fixtures
- Version bumps

If no ADR is warranted, output a short explanation and stop. Do not create an
empty or trivial ADR.

---

## Step 3 — Check for Superseded ADRs

Read each existing ADR in `adrs/`. For each, ask:

> Does this change contradict, replace, or render obsolete the decision in this ADR?

If yes, note the ADR number — you will mark it Superseded in Step 5.

ADRs are **immutable**. Never edit the body of an existing ADR. The permitted
edits are:

1. Adding a supersession line to the Status field:

   ```
   **Status:** Superseded by ADR-XXX
   ```

2. Repointing a file path that moved, when the referenced file still exists at
   a new location — most often a feature spec moving from `features/` to
   `archive/features/`. This is a link repair, not a revision: the path names
   the same artifact and the ADR's reasoning is untouched. A dead link makes an
   ADR harder to audit, which is the opposite of what immutability protects.
   Never use this as cover for editing the surrounding prose.

Anything else — reasoning, alternatives, consequences — stays as written, even
when later events prove it wrong. A superseding ADR is how the record changes.

---

## Step 4 — Check User Before Proceeding

Present your assessment to the user:

1. State whether you believe an ADR is warranted and why (one paragraph).
2. If yes, name the proposed ADR title and the next available number.
3. If any existing ADRs would be superseded, name them explicitly.
4. Ask for confirmation before writing any files.

Example:
> I think ADR-010 is warranted here. The tarball packaging change establishes
> a convention (always replace `file:` symlinks before `npm pack`) that affects
> how every future release is built. No existing ADR is superseded.
>
> Shall I draft it?

Wait for the user to confirm before continuing.

---

## Step 5 — Draft the New ADR

Determine the next ADR number by counting files in `adrs/`:

```bash
ls adrs/ | wc -l
```

The filename format is `adr-NNN-slug.md` where `NNN` is zero-padded to three
digits and `slug` is a short kebab-case description of the decision.

Write the ADR to `adrs/adr-NNN-slug.md` using this exact structure:

```markdown
# ADR-NNN — <Title>

**Status:** Accepted
**Date:** <YYYY-MM-DD> (<ticket-id if known, else branch name>)

## Context

<2–5 paragraphs explaining the situation that made a decision necessary.
Include: what the system was doing before, what problem or question arose,
what alternatives were considered and why they were rejected or not chosen.
Be specific — name files, packages, commands, or patterns where relevant.>

## Decision

<1–3 paragraphs stating precisely what was decided. Begin with the decision
itself, then explain the mechanism (how it is enforced, where it lives in
the codebase). This section must be unambiguous: a future contributor must
be able to read it and know exactly what the rule is.>

## Consequences

**Positive:**
- <bullet per positive consequence>

**Negative:**
- <bullet per negative consequence or constraint imposed>
```

Guidelines:
- Context explains the *situation*; Decision explains the *choice*; Consequences
  explain the *impact*.
- Mention specific file paths, function names, or commands where they make the
  decision concrete.
- Keep each ADR focused on **one** decision. If the changes warrant two separate
  decisions, write two ADRs.
- Do not editorialize or celebrate the decision. State it plainly.

---

## Step 6 — Mark Superseded ADRs

For each ADR identified in Step 3 as superseded, make a minimal edit — change
only the Status line:

```
**Status:** Superseded by ADR-NNN
```

Do not change any other content. The rest of the ADR remains as historical
record.

---

## Step 7 — Present for Review

Show the user:
1. The full content of the new ADR (rendered as markdown).
2. The before/after Status line of any superseded ADR.

Ask the user to confirm the content before treating the draft as final. Offer
to revise the Context or Consequences if the user has corrections.

Once the user approves, the files are ready to be staged and included in the
PR commit.

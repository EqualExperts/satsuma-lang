# Feature 31 — Alignment with the Equal Experts Brand

> **Status: DRAFT** (2026-06-04)

## Goal

Reflect the project's transfer of ownership to Equal Experts in every place a
contributor, downstream tool, or visitor encounters Satsuma. The project keeps
its MIT licence, its name, and its existing technical scope — what changes is
the canonical home (`EqualExperts/satsuma-lang`), the maintainer identity (EE),
and a light pass of EE brand presence on the README and the public site.

The primary success criterion is:

**Every reference under the project's current source of truth points at
`github.com/EqualExperts/satsuma-lang`, Equal Experts is visibly named as the
maintainer in the README and the published site, and the EE logo is a first-class
brand asset in both surfaces — without re-skinning the existing Satsuma visual
identity.**

The work is mostly mechanical (URL and copy edits) plus a small amount of design
work to integrate the EE logo cleanly alongside the existing Satsuma logo.

---

## Background

Until recently Satsuma lived at `github.com/thorbenlouw/satsuma-lang` and was
authored by Thorben Louw, with EE acknowledged as employer. The project has now
been transferred to the `EqualExperts` GitHub organisation and is being adopted
as an EE open-source project that we are finding useful across a range of data
engineering and integration client engagements. The MIT licence is retained, the
codebase is unchanged, and Thorben remains a core contributor.

A current sweep of the repo (excluding `archive/` and `.tickets/`) finds
`thorbenlouw` URLs in 15 distinct files, including the README, the security
report, every page under `site/`, the OpenLineage skill (where the producer URL
is a stable JSON identifier), the VS Code extension's `package.json` and README,
and `CITATION.cff`. The `LICENSE` already says "Copyright (c) 2026 Equal
Experts", so the legal text is already correct.

Four official EE logo PNGs have been placed in `tmp/`:

- `Equal_Experts_Logo_CMYK_Colour.png` — full-colour wordmark (light backgrounds)
- `Equal_Experts_Logo_Monochrome_Black.png` — black wordmark
- `Equal_Experts_Logo_Monochrome_White.png` — reversed wordmark (dark backgrounds)
- `Equal_Experts_Brand_Mark_CMYK_Blue.png` — the `[ee]` bracket mark alone

The EE brand guideline summary in `tmp/visual_prompt.md` codifies the palette
(EE Blue `#1795D4`, Tech Blue `#22567C`, Dark Data `#212526`), typography
(Lexend), and visual motifs (the `[ ]` brackets). This PRD does **not** propose
adopting that palette wholesale — Satsuma already has a warm orange/peach/cream
identity on the site and that identity should remain. The aim is co-branding:
Satsuma stays Satsuma, with EE clearly named as the maintainer and the EE mark
visible on key surfaces.

---

## Problem

1. Anyone landing on the README, the published site, or any release artifact
   sees URLs pointing at the previous personal fork. Some of those URLs are
   already broken (GitHub redirects org transfers, but only for as long as the
   old name is unclaimed).
2. The "Author" section of the README still reads as a personal project. New
   contributors and prospective adopters cannot easily tell that the project is
   now an EE-maintained open-source effort.
3. Equal Experts has explicit brand assets and brand guidance, but none of it
   surfaces in the project. The README and site say nothing visual about EE's
   stewardship.
4. The OpenLineage skill emits a `_producer` URL into every event it documents.
   That URL is a stable identifier that downstream lineage consumers may key on.
   It needs to change, but the change has downstream impact that should be
   acknowledged in a release note.
5. The four logo files are sitting in `tmp/` — not version-controlled as
   first-class assets, not described, and at risk of being lost when `tmp/` is
   cleaned up.

---

## Design Principles

1. **Mechanical edits go through a single sweep.** Replace `thorbenlouw/satsuma-lang`
   with `EqualExperts/satsuma-lang` everywhere it appears outside `archive/`.
   The `archive/` directory describes the project as it was — leave it alone.
2. **Co-brand, do not re-skin.** Satsuma's existing visual identity stays.
   EE branding is added as an explicit "maintained by" presence: the logo, a
   short statement, and a link to `equalexperts.com`. We do not adopt the EE
   colour palette, typography, or bracket motif into the Satsuma site at this
   point.
3. **The README is the canonical source of brand truth.** Whatever the README
   says about ownership and licence is the version the site mirrors. Don't let
   the two drift.
4. **Acknowledge stable-identifier impact.** OpenLineage `_producer` URLs are
   public contracts. Changing them is a downstream-visible event and gets
   called out in `CHANGELOG.md`.
5. **Assets live in `assets/` (or `site/img/`), not `tmp/`.** The EE PNGs move
   into the repo with named, intentional filenames and a short README explaining
   what each file is for.

---

## Scope

### 1. Source-of-truth URL sweep

Replace every `https://github.com/thorbenlouw/satsuma-lang` reference with
`https://github.com/EqualExperts/satsuma-lang` in the following files:

- `README.md` — three CI/Release/Security badges; the "Releases" install
  command; the "latest release" link; the GitHub link in the Author section.
- `SECURITY-REPORT.md` — the GitHub Issues link.
- `CITATION.cff` — `repository-code` and `url` fields.
- `tooling/vscode-satsuma/package.json` — `repository.url`.
- `tooling/vscode-satsuma/README.md` — release download links.
- `site/_includes/footer.njk`, `site/_includes/nav.njk` — GitHub button and
  all footer links.
- `site/index.njk`, `site/cli.njk`, `site/vscode.njk`, `site/examples.njk`,
  `site/learn.njk` — every embedded GitHub URL (download URLs, file links,
  blob links, issues link, agent skills tree link).
- `skills/satsuma-to-openlineage/SKILL.md`,
  `skills/satsuma-to-openlineage/references/facet-mapping.md`,
  `skills/satsuma-to-openlineage/references/event-template.md` — every
  `_producer` and `_schemaURL` URL in the documented event payloads.

Out of scope: `archive/` (historical), `.tickets/` (historical), and any
file under `node_modules/`. Lockfile entries should be regenerated only if
the package metadata change requires it; do not hand-edit them.

### 2. Reframe authorship and maintainership

Replace the README "Author" section with a "Maintained by Equal Experts"
section that:

- States Equal Experts as the current maintainer, with a link to
  `https://www.equalexperts.com/`.
- Credits Thorben Louw as the creator and explains in a sentence that the
  project is now under EE stewardship.
- States that the project is used across EE engagements in data engineering
  and integration work, framed as a credibility signal not a marketing pitch
  ("confident but not arrogant" per the brand guidelines).

Update `CITATION.cff`:

- Keep Thorben Louw as the primary author.
- Add an `entity` author for Equal Experts, with the EE URL, reflecting that
  the project is institutionally maintained.
- Update `repository-code` and `url`.

### 3. EE logo as a first-class asset

Move the four PNGs out of `tmp/` into `assets/ee-brand/` (new directory) with
descriptive filenames:

- `ee-logo-colour.png`
- `ee-logo-black.png`
- `ee-logo-white.png`
- `ee-brand-mark.png`

Add an `assets/ee-brand/README.md` that briefly describes each file, references
the EE brand guidelines, and states that these are official EE brand assets
distributed under EE permission for use in this project (so future contributors
do not delete or replace them).

Mirror the chosen public-facing asset(s) into `site/img/` so the github-pages
build can reference them with relative paths.

### 4. README brand touch

Stack the EE logo under the existing Satsuma logo at the top of the README:
the Satsuma logo stays at its current size as the primary identity, and the EE
full-colour wordmark sits directly underneath at a smaller height (~24–32px),
clearly subordinate. Use the EE full-colour wordmark on the light README
background. The tagline "An Equal Experts open-source project" appears as the
caption text under the EE wordmark and links to `https://www.equalexperts.com/`.

The "Maintained by Equal Experts" text in §2 sits at the bottom of the README,
so the brand presence is bracketed (logo + tagline at top, attribution at
bottom) without flooding the document.

### 5. Site brand touch

EE presence on the site is in two places:

- **Footer.** A small EE brand mark + the tagline "An Equal Experts open-source
  project" linking to `https://www.equalexperts.com/`. Use `ee-logo-black.png`
  (or the brand mark at the same height) on the light footer background. Sit
  it next to the existing "MIT License" line.
- **Top nav.** An EE logo link placed immediately **after** the GitHub button
  in the top navigation, pointing at `https://www.equalexperts.com/` and
  opening in a new tab (`target="_blank" rel="noopener"`). Logo only — no
  accompanying text — sized to match the GitHub button height visually
  (~24–28px). Use `ee-logo-black.png` for tonal consistency with the existing
  dark GitHub button, or the colour wordmark if it reads better against the
  cream nav background — pick during implementation. Include a descriptive
  `aria-label` (e.g. "Equal Experts") so the link is accessible. Apply the
  same change to the mobile menu so the link is reachable on small screens.

No hero changes, no colour palette changes, no font changes, no bracket-motif
adoption. The aim is clear EE attribution without a visual rebrand.

### 6. Tagline

The tagline **"An Equal Experts open-source project"** is the single canonical
phrase. Use it verbatim in:

- the README, as caption text under the stacked EE wordmark (top of file);
- the README "Maintained by Equal Experts" section (bottom of file);
- the site footer, next to the EE mark;
- any future release note or surface introducing EE attribution.

Do not vary it ("Stewarded by…", "Brought to you by…", etc.) — consistency is
the whole point.

### 7. CHANGELOG and release-note callouts

Add a `CHANGELOG.md` entry under "Unreleased" (or whatever convention this
repo uses — confirm before drafting):

- Note the GitHub URL change.
- **Explicitly flag** the OpenLineage `_producer` URL change as a
  downstream-visible event. Downstream lineage consumers that key on the
  producer URL string will see a new value after this release; the producer
  URL is treated as movable rather than as a long-lived stable identifier.

### 8. Cleanup

- After §3, `tmp/` should no longer contain logo files. If `tmp/` becomes
  empty, delete it; if `tmp/visual_prompt.md` is still useful, decide whether
  to keep it in `tmp/` or move it into `assets/ee-brand/` as reference material.
- Verify no broken relative image links remain in README or site after the
  asset moves.

---

## Out of scope

- Adopting the EE colour palette (EE Blue, Tech Blue), typography (Lexend),
  or `[ ]` bracket motif into the Satsuma site. That is a separate visual
  redesign decision and is not required for this feature.
- Renaming the npm package or any published artifact names.
- Migrating any external service (Slack, mailing list, domain) — those don't
  exist for this project today.
- Touching `archive/` content. The archive is historical truth.
- Updating PR/issue references inside `.tickets/` notes. The `tk` history is
  a record of what happened at the time.

---

## Acceptance Criteria

1. `git grep "thorbenlouw"` returns matches only inside `archive/`, `.tickets/`,
   and files explicitly inside `node_modules/` or build outputs.
2. The README displays the EE logo at the top, names Equal Experts as the
   current maintainer, and credits Thorben Louw as the creator.
3. `CITATION.cff` lists both Thorben Louw (person) and Equal Experts (entity)
   as authors, and its URLs point to `EqualExperts/satsuma-lang`.
4. The published site top nav contains an EE logo link (placed after the
   GitHub button) pointing at `https://www.equalexperts.com/`, mirrored in
   the mobile menu and with an accessible label. The footer shows the EE
   wordmark/brand mark plus the link text "An Equal Experts open-source
   project", also pointing at `https://www.equalexperts.com/`. No other site
   surface is changed.
5. The four EE logo files live under `assets/ee-brand/` with descriptive
   filenames and a short README explaining their purpose. `tmp/` no longer
   contains them.
6. `CHANGELOG.md` notes the URL migration and explicitly flags the
   OpenLineage `_producer` URL change as downstream-visible.
7. The site builds cleanly (`npm --prefix site run build` — or whatever the
   command is — confirm during implementation) and all internal links work.
8. The VS Code extension's `package.json` repository URL points at the new
   org; a clean `npm install` and extension build still succeeds.

---

## Resolved Decisions

Recorded so the rationale is visible without digging through PR history.

1. **Site EE presence is footer + top-nav logo link.** No hero line, no
   "About the maintainer" section. The footer carries the tagline; the top
   nav carries a logo-only EE link placed after the GitHub button (mirrored
   in the mobile menu).
2. **README header layout is stacked.** Satsuma logo prominent; EE wordmark
   resized smaller underneath.
3. **OpenLineage `_producer` URL changes outright.** No deprecation window —
   the producer URL is treated as movable, not as a long-lived stable
   identifier. CHANGELOG flags it so downstream consumers can adjust.
4. **Tagline is "An Equal Experts open-source project"** verbatim, everywhere
   EE attribution appears.
5. **No `[ ]` bracket motif adoption.** The brand mark is used as a logo where
   appropriate, but the brackets do not enter the Satsuma visual language.

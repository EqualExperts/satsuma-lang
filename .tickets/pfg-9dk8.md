---
id: pfg-9dk8
status: closed
deps: []
links: []
created: 2026-08-01T21:39:42Z
type: chore
priority: 3
assignee: Thorben Louw
tags: [tooling, lint, ci]
---
# Adopt Prettier as the JS/TS formatting gate (and ruff format for Python)

JS/TS — the bulk of the repo — has no formatting gate at all. `eslint.config.mjs` carries only correctness rules (js.configs.recommended, no-unused-vars, two @typescript-eslint rules on a subset of packages), and ESLint has shipped zero formatting rules since v9 (deprecated in 8.53, removed since), so `npm run lint:js` on ESLint 10 cannot express a style opinion even in principle. Markdown has markdownlint-cli2 and YAML has yamllint, but Python runs `ruff check` only — never `ruff format --check` — so Python has the same hole one size smaller.

Surfaced in PR #414 review: eight viz test fixtures gained `flattenBlocks: [], nestedArrows: [],` collapsed onto a single line, a mechanical sed-shaped edit that reads badly in a codebase whose stated purpose is to be a teaching example (CLAUDE.md, Code Readability). Nothing in lint, CI, or the pre-commit hook flagged it. Note the honest scope limit: a formatter would have caught that nit and nothing else in that review — the real regression there (edge scopeLabel) needed a test, not a formatter. This ticket is worth doing on consistency grounds, not as a defect-prevention measure.

## Design

Measured cost before proposing the shape: `prettier --check` over tooling/*/src + tooling/*/test reports 229 of 266 files would reformat. elk-layout.ts alone changes 354 lines at Prettier's default printWidth 80, 184 at 100, 135 at 120 — the codebase was simply not written to Prettier's shape.

printWidth 100 is the recommendation: 80 fights the prevailing style badly, and 120 is too wide for this repo's prose-heavy doc-comments (CLAUDE.md mandates module-level, function, and type comments everywhere, so lines are comment-dense).

The churn is the real risk, not the tool. A multi-thousand-line reformat flattens git blame across exactly the files a reader is meant to learn from, so the reformat must be isolated in one commit that contains nothing else and be recorded in a new .git-blame-ignore-revs (none exists today), with blame.ignoreRevsFile documented in AGENT-CONTRIBUTIONS.md so contributors actually get the benefit locally.

Wiring point: adding `prettier --check` to the existing `lint:js` script pulls it into the Lint CI job and into the pre-commit hook (scripts/run-repo-checks.sh runs `npm run lint`) for free — no new CI job needed. `ruff format --check` is a one-line addition to lint:python that closes the Python half.

Rejected alternative — checking only files touched by the current diff: avoids the big-bang commit but leaves the repo permanently half-formatted, which is the worst of both and makes the gate's output depend on branch history rather than on file contents.

## Acceptance Criteria

A .prettierrc at repo root sets printWidth 100 with a comment stating why that value (measured against the existing style, not a default), and a .prettierignore excludes the same generated surfaces eslint.config.mjs ignores (dist, build, node_modules, .worktrees, minified site assets, generated parser artifacts). prettier is a root devDependency, pinned in the same style as the other lint tools.

The repo-wide reformat lands as its own commit containing no other change; its SHA is recorded in a new .git-blame-ignore-revs, and AGENT-CONTRIBUTIONS.md documents `git config blame.ignoreRevsFile .git-blame-ignore-revs` as a setup step.

`npm run lint:js` runs `prettier --check` alongside eslint and fails on unformatted JS/TS; `npm run lint:python` runs `ruff format --check` alongside `ruff check`. Both therefore gate the Lint CI job and the pre-commit hook without a new CI job. Verified by deliberately misformatting one file and confirming both `npm run lint` and the pre-commit hook reject it.

Every package's test suite passes after the reformat (the reformat must be behaviour-neutral), and all existing CI checks stay green.


## Notes

**2026-08-02T06:30:34Z**

Cause: JS/TS had no formatting gate (ESLint 10 ships no formatting rules) and lint:python never ran ruff format --check.
Fix: prettier pinned at root with printWidth 100 (.prettierrc documents the measurement) and .prettierignore mirroring eslint's ignores (commit eedb8e4); isolated repo-wide reformat of 230 files (commit 4041154, recorded in .git-blame-ignore-revs — three lit html-template files needed a second prettier pass to reach the fixed point); gates wired into lint:js (prettier --check) and lint:python (ruff format --check) so CI Lint and the pre-commit hook both enforce them, plus npm run format and a Claude Code PostToolUse format-on-edit hook in .claude/settings.json for a tight loop. blame.ignoreRevsFile documented in AGENT-CONTRIBUTIONS.md. Verified by deliberate misformat: npm run lint rejected it, passed after restore.

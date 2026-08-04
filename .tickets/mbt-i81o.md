---
id: mbt-i81o
status: closed
deps: [mbt-45v2]
links: []
created: 2026-08-04T11:08:48Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R6: Update docs for workspaces + Turborepo install/build flow

Update AGENTS.md, HOW-DO-I.md, and docs/developer/AGENT-CONTRIBUTIONS.md worktree setup instructions to reflect the new single-command workspaces install and Turborepo-driven build/test flow. Remove references to the old per-package install:all chain and the --ignore-scripts workaround.

## Acceptance Criteria

- AGENTS.md's worktree setup / install:all instructions match the new commands
- AGENT-CONTRIBUTIONS.md's worktree checklist (npm run install:all step) matches the new flow
- HOW-DO-I.md updated if it references the old install/build process
- No remaining doc references to the removed --ignore-scripts workaround or the old hand-sequenced build order


## Notes

**2026-08-04T20:29:08Z**

Cause: four merged commits (R2–R5) changed how the repo installs, builds and
tests, and no doc outside AGENTS.md's sandbox section had been revised. Several
docs asserted the *opposite* of reality — the contributor guide's §9 said "it is
still not an npm-workspaces-style monorepo", and AGENT-CONTRIBUTIONS.md told
agents to verify work with `npm test` in the relevant package, which no longer
builds that package's dependencies.
Fix: audited every doc outside the historical directories and corrected fourteen
files. (commit immediately after bbf9c75f)

The ticket named three files; the audit found the flow described across fourteen.
What changed, and why each mattered:

**The two that were actively misleading, not merely stale:**
- `docs/developer/AGENT-CONTRIBUTIONS.md` told agents to check "all tests pass
  (`npm test` in relevant packages)". With the cross-package `prebuild`/`pretest`
  hooks removed, that passes or fails against whatever build output happens to be
  on disk. Now points at `npm run test:all` / `turbo run test --filter=<pkg>`.
- `tooling/vscode-satsuma/README.md` documented `npm run test:lsp` (deleted in R4)
  as the way to run the language server's suite, told readers to
  `cd server && npm install` into a directory that does not exist, and claimed
  `check` covers the LSP's tests, which it no longer does.

**The biggest gap was an absence, not an error.** AGENTS.md documented the two
sandbox env vars turbo needs but never the commands. It now has a "Building and
testing" section: a command table, how `--filter` takes a package's declared name,
and — the point of it — that `npm --prefix tooling/<pkg> test` no longer builds
dependencies. That is the one new failure mode this feature introduced and it was
documented nowhere. HOW-DO-I.md gained a matching entry, since it is the
question-index and had none for building the repo.

**docs/developer/ARCHITECTURE.md needed the most care.** It is what HOW-DO-I.md
points at for "the tooling architecture" and it said nothing about the build. It
now has a Build orchestration section, and its Dependency Matrix — previously nine
columns, missing scenario-gen and integration-tests, and several edges out of date
— is complete and labelled as *being* the build order rather than describing it,
since `dependsOn: ["^build"]` reads exactly those declarations. The matrix was
derived from the manifests programmatically and every one of the eleven rows
checked, not transcribed from memory. It also explains the three surprising-looking
edges (tree-sitter-satsuma almost everywhere; lsp -> cli; vscode -> viz-backend)
and points at scripts/workspace-build-graph.test.mjs as what keeps it honest.

**Two files were deliberately not rewritten:**
- `satsuma-lang-contributor-guide.md` is a dated review ("Last reviewed:
  2026-04-07") whose §9 and R9 recommended exactly this feature. Rewriting its
  findings would falsify the record of what was reviewed, so it got a banner
  saying §9/R9 shipped as Feature 42 and to read those sections as history.
- `site/SITE-DEV.md` was correct and gained a defensive note instead: the site is
  deliberately outside `workspaces: ["tooling/*"]` and keeps its own lockfile, so
  nobody "fixes" it by folding that lockfile into the root one.

Also corrected: README (setup, per-package snippets, CI job list, audit scope),
SATSUMA-CLI.md and tooling/satsuma-cli/README.md (install now root-first),
tooling/tree-sitter-satsuma/README.md (claimed a C toolchain and `node-gyp build`
— neither exists, ADR-002), tooling/satsuma-viz-harness/README.md (per-package
test commands that no longer build their deps), ROADMAP.md (Feature 42 moved to
Shipped), and hardcoded test counts replaced with pointers to test-stats.json.

Raised mbt-1s1s for the one piece of drift left in CI-WORKFLOWS.md: it describes
release.yml as jobs `build` and `vsix`, which that workflow has not had for some
time. Pre-existing and unrelated to this feature, so left out of this diff.

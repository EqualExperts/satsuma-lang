---
id: mbt-14vo
status: closed
deps: []
links: []
created: 2026-08-04T18:25:23Z
type: task
priority: 4
assignee: Thorben Louw
parent: mbt-5l7g
---
# harden workspace-build-graph.test.mjs against detection forms it currently cannot see

Raised from the adversarial review of R4 (PR #482). Each item below is a way the
guard could miss a real edge, or report one that is not there. **None has a live
instance in the repo today** — the review's verifiers refuted each on impact, not
on fact — so this is hardening, not a bug.

Missed forms (false negatives):
- Reaches expressed outside code files. `tooling/satsuma-viz-harness/tsconfig.json`
  names `@satsuma/viz-model` in a `paths` mapping and is the only place it appears
  outside package.json; CODE_EXTENSIONS covers only .ts/.mts/.cts/.js/.mjs/.cjs,
  so a tsconfig-only edge would be invisible. (viz-harness does declare viz-model,
  so nothing is wrong today.)
- `require.resolve("pkg/asset")` and `createRequire(import.meta.url)("pkg")` — the
  idiom R2 adopted for resolving hoisted workspace assets — are not matched by the
  specifier form.
- The "no script builds a sibling" guard names two spellings (`--prefix ..` and
  `cd ..`). Others exist: `npm -w <pkg> run build`, `npm run build --workspace=<pkg>`,
  `(cd ../sibling && ...)` inside a subshell.
- The carried-over "no build script implies no built output" invariant inspects
  only `exports`. Two packages declare their entry points via `main`/`bin`
  instead, so a package growing a built `main` without a build script would pass.

Possible false positives (none triggering today):
- A script reaching the *repo root* (`--prefix ../..`, `cd ../..`) is matched by
  the sibling-script guard, which would report a legitimate root invocation as a
  cross-package escape.
- Detection form 3 matches any string literal equal to a sibling's directory name,
  which includes the `satsuma-viz` custom-element tag. The packages most likely to
  write that tag are the ones for which the demanded declaration would be a cycle.
- The scan walks gitignored build output under a package's scanned subdirectories
  when it is present, so results can in principle depend on build state.

Also worth noting: `tree-sitter-satsuma#test` runs `generate`, which writes
`satsuma-core/src/generated/cst-types.ts`, and no graph edge can order that
against `@satsuma/core#build`'s reads of the same file (the edge would be a cycle
— see PERMITTED_UNDECLARED_REACHES). `turbo run test` with no filter could
schedule them concurrently. `test:all` excludes tree-sitter-satsuma, so the
repo's own entry points do not hit it.

## Acceptance Criteria

- Each missed form above is either detected, or has a comment in the test saying why it is deliberately out of scope
- The two false-positive shapes are either excluded or shown to be unreachable
- Every change is mutation-tested: the new detection must fail against a constructed instance of the form it claims to catch, and the suite must stay green without it


## Notes

**2026-08-11T10:21:00Z**

Cause: `scripts/workspace-build-graph.test.mjs` could miss real build-graph edges and could misreport non-edges, because its detectors predated several reach/escape spellings and walked untracked build output. None of the forms had a live instance today, so this was hardening, not a bug fix.

Fix: extended `siblingsReachedBy` to catch `require.resolve("pkg")` and `createRequire(...)("pkg")` (form 2) and to exclude a sibling dir-name used as a custom-element tag/selector via a DOM-API lookbehind (FP-B). Added `siblingsReachedByTsconfig`/`siblingsReachedByPaths` to flag a sibling named in a tsconfig `compilerOptions.paths` mapping (form 1), fixing a scoped-name bug the new test surfaced (`@satsuma/core` split to `@satsuma`). Extracted `siblingBuildEscapeIn` to catch the `npm -w`/`--workspace` and subshell `(cd ../sibling ...)` spellings (form 3) while excluding repo-root reaches `--prefix ../..` / `cd ../..` (FP-A). Extended the no-build invariant via `builtEntryWithoutBuildScript` to check `main`/`bin` for `dist/`, not just `exports` (form 4). Switched `codeFilesOf` to scan only `git ls-files`-tracked paths so untracked build output under a scanned subtree can no longer change what the scan sees (FP-C), honouring the committed `satsuma-core/src/generated/` exception. Refactored turbo.json's inline JSONC stripper into a shared `parseJsonc`. Added a `describe` block of 8 constructed-instance unit tests; each new/refined detector was mutation-verified to be load-bearing (reverting it flips the suite from 43 pass to 1 fail). The 35 workspace invariants stay green. (commit immediately after c11de8c4)

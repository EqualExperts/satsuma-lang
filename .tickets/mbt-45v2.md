---
id: mbt-45v2
status: open
deps: [mbt-npy0]
links: []
created: 2026-08-04T11:08:48Z
type: task
priority: 2
assignee: Thorben Louw
parent: mbt-5l7g
---
# R5: Wire Turborepo into CI

Route CI's existing per-package job/matrix steps in .github/workflows/ci.yml through turbo run <task> --filter=... so a package whose inputs are unchanged is skipped (cache hit) rather than always re-executed. Persist .turbo via actions/cache. Measure and record the before/after CI wall-clock delta against the R1 baseline. Keep the existing per-package job/matrix structure -- do not restructure the job graph in this ticket unless investigation shows it's required.

## Acceptance Criteria

- CI steps use turbo run --filter for build/test/lint tasks
- .turbo cache is persisted across CI runs via actions/cache
- A scoped test (no-op change under one package only, e.g. tooling/satsuma-viz) demonstrates turbo reports other packages as cached/skipped in CI
- Before/after CI wall-clock time recorded and compared against the R1 baseline
- All existing CI checks (Tree-sitter parser, VS Code extension, etc.) still pass and gate PRs as before


## Notes

**2026-08-04T17:03:05Z**

**2026-08-04T17:10:00Z**

Post-R2 CI measurement, for the before/after this ticket has to record.

R1 baseline (main @ ec45cfba, run 30908680698):
- Install job: 1m 34s
- Full pipeline: 4m 35s

After R2/R3 (PR #478 @ 579449ab, run 30931626552, all 23 jobs green):
- Install job: **58s** (16:57:57 -> 16:58:55) — down 38%
- Full pipeline: **4m 37s** (16:57:38 -> 17:02:15) — unchanged

Read it this way: replacing eleven sequential `npm ci` calls with one
workspace install cut the install job by a third, and this was a *cold* run —
the new root-lockfile npm cache and the wasi-sdk cache were both empty on first
use, so a warm run should be faster again. End-to-end time is unchanged because
R2 adds no affected-only execution: every job still runs every suite. That is
exactly the gap R4's content-hash cache and this ticket's `--filter` wiring are
meant to close, so the number to move here is the 4m 37s, not the 58s.

Compare like-for-like main runs when measuring, not a PR run against a main run.

**2026-08-04T18:25:37Z**

From R4's adversarial review (PR #482) — one finding lands squarely in this
ticket's scope rather than R4's.

**Downstream jobs trust the install job's blob, and R4 removed the per-job builds
that used to hedge against it.** ci.yml restores `workspace-${{ github.sha }}` with
`restore-keys: workspace-`. The exact-SHA key hits whenever the install job saved
successfully, and that blob is a complete ordered build, so this is correct by
design. But if the save fails or is evicted, the fallback silently supplies
*another commit's* dist/, and jobs like `satsuma-cli` (which R4 reduced to
`npm run test:typecheck`) would then check a different commit's output and pass.

R4 deliberately left this alone: adding `turbo run build` to those jobs would have
made four of them rebuild the grammar and re-download the 119MB wasi-sdk, which is
the opposite of this feature's goal. Persisting `.turbo` via actions/cache — this
ticket's own acceptance criterion — is what makes the honest fix cheap: with the
content-hash cache available, each job can run `turbo run <task> --filter=...` and
either hit the cache or rebuild exactly what is stale, instead of trusting a blob
it cannot verify. Consider dropping the `restore-keys: workspace-` fallback at the
same time, so a miss is loud rather than silently stale.

Also carried forward for measurement: R4 changed no job structure, so the expected
before/after here is still against the 4m37s full-pipeline figure recorded above.
R4's own run (30937118776, 28 checks green after the build:all fix) is the new
"before" for this ticket.

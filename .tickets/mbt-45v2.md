---
id: mbt-45v2
status: closed
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

**2026-08-04T18:58:28Z**

Measured "before" for this ticket — a main run, like-for-like with the earlier
figures.

main @ c2d447b4 (run 30940705927, immediately after R4 merged), all 28 checks
green: **4m18s** end to end (18:53:10 -> 18:57:28). Install job 61s.

Progression: R1 baseline 4m35s -> post-R2/R3 4m37s -> post-R4 4m18s. R4's ~19s
came from deleting the vscode job's four hand-ordered build steps, not from any
caching, which R4 did not add to CI.

Where the time actually goes (per-job, from run 30940255914 on main):

| Job | Duration |
|---|---|
| Test stats freshness | 150s |
| Satsuma CLI | 135s |
| Satsuma-to-Excel skill | 74s |
| Install dependencies | 61s |
| Smoke tests (BDD) | 48s |
| VS Code extension | 41s |
| Lint | 41s |
| Tree-sitter parser | 39s |
| everything else | <=29s |

The pipeline is install (61s) then the longest downstream job, so the number to
move is `Test stats freshness` at 150s, with `Satsuma CLI` at 135s right behind.
Both are pure re-execution: test-stats re-runs *every* package's suite from
scratch purely to count tests, and the CLI job re-runs a suite whose inputs
usually have not changed.

Two consequences for how this ticket is done:

1. **No job graph restructuring is required** — the ticket's own instruction.
   Both poles are fixed by making each job's work cacheable and persisting
   `.turbo`, not by moving work between jobs.
2. **Cache keys must be per-job.** A local cache is not shared between jobs, so a
   single repo-wide key would have jobs racing to save and each overwriting the
   others' entries. Namespacing on the job (`turbo-<job>-<os>-<sha>` with a
   `turbo-<job>-<os>-` restore-key) lets each job accumulate exactly the task
   entries it runs and hit them on the next push. The cost is that the first run
   after this lands is no faster, and build outputs are stored once per job.

**2026-08-04T19:14:15Z**

Measured "after". All five acceptance criteria met; closing.

**Wall clock, all like-for-like full pipelines:**

| | Total | Install | Test stats | Satsuma CLI |
|---|---|---|---|---|
| R1 baseline | 4m35s | 1m34s | — | — |
| post-R2/R3 | 4m37s | 58s | — | — |
| post-R4 (main c2d447b4) | 4m18s | 61s | 150s | 135s |
| R5 cold cache (run 30941702833) | **3m36s** | 41s | 110s | 148s |
| R5 warm cache (run 30942106375) | **1m56s** | <=31s | 39s | 32s |

**55% off the post-R4 baseline, 58% off the R1 baseline.**

Cold is already 42s faster, before any cache exists: `turbo run test` parallelises
what generate-test-stats.mjs used to spawn sequentially (150s -> 110s), and the
install job dropped 61s -> 41s. The CLI job is the one that got *slower* cold
(135s -> 148s), as expected — it now builds its dependency chain through
`--filter` and pays turbo's overhead, and its win only appears warm.

**Scoped-change evidence** (the criterion asking that an unaffected package's
suite not re-run). Commit 44d0ee9b appended a comment to one @satsuma/viz source
file and nothing else. satsuma-cli does not depend on @satsuma/viz, and its job
reported:

```
##[group]satsuma-cli:test:coverage
ℹ tests 1061
 Tasks:    6 successful, 6 total
Cached:    6 cached, 6 total
  Time:    571ms >>> FULL TURBO
```

All 1061 tests reported from a replayed log, none executed, in 571ms against
59.8s of real work. `satsuma-cli:test:typecheck` was likewise 6/6 cached in 89ms.
That probe commit was reverted in the commit immediately after 44d0ee9b; it exists
in history only as the evidence above.

**All 28 checks green on both runs**, so nothing was weakened to get the number.

Two things deliberately left, neither on the critical path:

- The new longest job is `Satsuma-to-Excel skill` at 70s. It installs the CLI
  globally from a packed tarball and runs pytest, so Turborepo cannot cache it —
  a different kind of work, not a caching gap.
- `tooling-modules` (12-36s per shard) and the LSP's coverage run inside the
  vscode job are still raw commands. Converting them means giving each a
  package-local output path as satsuma-cli's JUnit XML got; worth doing only when
  one of them is the pole, which it is not.

Also settled here: the `restore-keys: workspace-` fallback concern raised from
R4's review. It stays, because it is now much less load-bearing — the jobs that
matter verify their own inputs through turbo rather than trusting the blob.

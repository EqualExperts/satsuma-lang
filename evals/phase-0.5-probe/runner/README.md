# Phase 0.5 probe runner

The episode runner for ticket `sl-x9m1`: run T4 and T5 across arms X-P0, X-P2,
M0, S and S+ at *n* = 2, one model, one harness, then the 1-mapping crossover
cell — recording per episode the input/output/cache-read/cache-write tokens, the
turn count, and, for arm S+, every `satsuma` invocation with its flags, exit code
and output size.

The scenario and answer keys it runs against are `../scenario/` and
`../answer-keys/`, authored under `sl-jdho` before any episode ran. Grading is
`sl-3yzd`, by hand. Probe results are **non-publishable** — see the probe
[README](../README.md).

## Layout

| File | What it owns |
|---|---|
| `probe_matrix.py` | The treatments: arms, cells, the two task prompts, workspace layout |
| `episode.py` | The world one episode runs in: directories, artifact copy, PATH, assertions |
| `satsuma_shim.py` | The `satsuma` arm S+ actually invokes — logs every call, blocks `context` |
| `pi_harness.py` | Pi argv, hermeticity flags, and the parse of its JSON event stream |
| `run_probe.py` | Sequencing, budget guard, per-episode and per-run manifests |
| `test_probe_runner.py` | The suite, also run by `npm run test:scripts` |

## Running it

```bash
# Materialise every episode environment and print its command. Spends nothing.
python3 run_probe.py --dry-run

# The real run, under the PRD's ~$8 probe budget
python3 run_probe.py --run-id 2026-08-11a

# A slice, e.g. re-running one failed episode
python3 run_probe.py --run-id 2026-08-11b --cells full --arms S+ --tasks T4 --repeats 1
```

Results land in `../runs/<run-id>/`: one directory per episode holding the exact
prompt, the raw harness stream, the invocation log and a manifest, plus a
`run.json` carrying provenance and totals. They are committed — a probe whose
transcripts were thrown away cannot be re-graded when a threshold is questioned.

The tests run with no API key and no spend:

```bash
python3 -m unittest            # from this directory
npm run test:scripts           # from the repo root, via scripts/probe-runner.test.mjs
```

## Two protocol decisions this runner makes

Both are judgement calls the PRD leaves open. They are recorded here because
`sl-3yzd` must grade knowing them, and a later re-probe must be able to vary
them deliberately rather than rediscover them.

**1. Each Satsuma arm gets its own shipped reference envelope.** Feature 45
shipped the agent reference in three forms with very different resident costs
(`reference/token-costs.md`). Arm S has no CLI, so its only delivery mechanism is
the portable blob: it is appended to the system prompt and charged on every turn.
Arm S+ has the CLI, whose whole design is that nothing is resident and the agent
pays per `--section`/`--profile` slice; so arm S+ starts with no reference at all
and is told the command exists.

This means S and S+ differ in *two* ways, not one — CLI access and reference
delivery. That is deliberate: each arm is the configuration that would actually
ship, and pairing them on reference delivery would measure a configuration nobody
uses. The cost is that a S+ − S difference cannot be attributed to the CLI alone,
and the write-up must say so.

**2. Every arm gets the same tools.** `read`, `write`, `edit`, `bash`, `grep`,
`find`, `ls` — including `bash` for the markdown and Satsuma arms, which do not
strictly need it. Arm X cannot open a workbook without python3, and giving bash
only to X would confound "the CLI helped" with "a shell helped". The arms differ
in their artifact and in whether `satsuma` is reachable. Nothing else.

## What makes the arm treatments enforced rather than intended

- **Arm S's withholding.** Every PATH entry providing a `satsuma` binary is
  removed for *every* arm, and `assert_satsuma_absent` re-checks the final
  environment with `shutil.which` before the episode starts. A reachable binary
  raises rather than warns. The PRD is explicit that an agent told not to use a
  binary on its PATH will use it.
- **Arm S+'s invocation record.** The only reachable `satsuma` is
  `satsuma_shim.py`, which appends one JSON line per call — argv, subcommand,
  exit code, stdout/stderr bytes, duration — before forwarding to the real CLI.
  `assert_shim_reachable` refuses to start if PATH resolves anywhere else. The
  PRD's finding that `--json` on aggregate commands costs *more* than reading the
  source files is only visible through those byte counts.
- **`satsuma context` is excluded** and returns exit code 69 with the attempt
  recorded, rather than being silently absent — whether the agent reaches for it
  is itself a result.

## Provenance recorded per run

`run.json` carries the git sha and whether the tree was dirty, the harness
version and its flags, the tool list, the requested model and the *resolved dated
snapshot id* seen in each episode, the thinking level, and the identity of the
satsuma CLI arm S+ was measured against — invoked path, resolved path, reported
`--version` and `package.json` version. The last two are recorded separately on
purpose: a locally built CLI can report a release version it is not (`sl-13p5`),
so "which build was this" cannot be taken on trust.

## Budget

`--budget-usd` defaults to 8.0, the PRD's probe budget, and the run **stops**
when cumulative cost reaches it rather than warning. An overspend on a
deliberately cheap probe is the exact failure mode "it must not be allowed to
grow" is written against.

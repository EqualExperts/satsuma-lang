---
id: sl-x9m1
status: open
deps: [sl-jdho]
links: [tced-ewd4]
created: 2026-08-05T09:29:28Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-qz3v
tags: [eval, feature-44]
---
# Run the five probe arms and record usage

Run T4 and T5 across arms X-P0, X-P2, M0, S and S+ at n=2, one model, one harness. Then the 1-mapping variant.

Record per episode: input/output/cache-read/cache-write tokens, turn count, and - for arm S+ - every satsuma invocation with flags, exit code and output size.

Arm S must run with the CLI absent from PATH, asserted before the episode starts. satsuma context is excluded from arm S+; record any attempt to call it.

## Acceptance Criteria

- Transcripts and usage recorded for every episode
- Arm-S CLI absence asserted, not merely requested
- Arm-S+ invocation mix captured, including whether the agent used --json on aggregate commands
- Spend stayed within the ~$8 probe budget


## Notes

**2026-08-11T09:06:29Z**

Episode runner built under evals/phase-0.5-probe/runner/ (Python): arm/cell matrix, task prompts pinned to the answer keys by a drift test, isolated per-episode workspaces, enforced PATH withholding for arm S, an invocation-logging shim that is the only reachable satsuma for arm S+ (and blocks the excluded `context` command), and a pi JSON-event-stream parser recording input/output/cache-read/cache-write tokens plus turn count. 31 unit tests, wired into `npm run test:scripts`.

Verified end to end without spend: a materialised arm-S+ workspace resolves the spec's ../lookups import, `satsuma validate` passes on both files, `satsuma field-lineage claim_header.loss_amount` returns exactly the four fields in the T4 answer key, and every invocation is logged with flags, exit code and output bytes.

Two defects found and fixed while proving it: the workspace layout would have broken the spec's relative import, and the shim's /usr/bin/env shebang resolved against the agent's PATH (on macOS that selects the Xcode python3 stub, which would have made every arm-S+ CLI call fail in a way that looked like the agent choosing not to use the CLI).

Not yet run - no credentials configured. Decisions taken with the user 2026-08-11: harness is pi (the PRD anchor) via OpenRouter; model Claude Sonnet 5; episodes run inside Gondolin micro-VMs with only the episode directory mounted and the API key held host-side as an httpHooks placeholder so the guest never sees it; and the arm-S+ CLI pinned to a version downloaded from the GitHub releases page rather than whatever is on PATH (the installed CLI reports 0.12.0 but carries v0.13.0 flags - see sl-13p5).

The behavioural eval is being split into its own repository (user decision, 2026-08-11), so this runner moves there before the first paid episode. (commit immediately after b7781a77)

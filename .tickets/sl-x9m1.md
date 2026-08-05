---
id: sl-x9m1
status: open
deps: [sl-jdho]
links: []
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


---
id: sl-3yzd
status: open
deps: [sl-x9m1]
links: []
created: 2026-08-05T09:29:28Z
type: task
priority: 1
assignee: Thorben Louw
parent: sl-qz3v
tags: [eval, feature-44]
---
# Grade the probe by hand and record the go/no-go decision

Grade T4 by set-F1 against the answer key and T5 by flagged-vs-silently-guessed plus false-positive rate. By hand - no graders, no judge.

Evaluate against the PRD's pre-committed thresholds:
- S+ >= 0.85 x M on tokens AND no quality separation on T5 -> STOP, correct the site copy downward without a full study
- S+ <= 0.6 x M -> build the full protocol
- in between -> build Phases 1-2, re-probe before the primary slice

Also report: whether the 1-mapping cell showed S+ losing (the crossover), and an n estimate for the full run.

## Acceptance Criteria

- Go/no-go decision recorded as a PRD note with the measured ratios behind it
- Crossover at the 1-mapping cell confirmed or refuted explicitly
- An n recommendation for the full run, replacing the current guess of 5
- A list of protocol bugs found, each either fixed in the PRD or raised as its own ticket


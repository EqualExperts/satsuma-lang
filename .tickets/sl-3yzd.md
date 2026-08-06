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

Evaluate against the PRD's pre-committed thresholds. These are stated against arm X (Excel), not arm M - X is the anchor arm, tokens(X)/tokens(S+) is the study's primary statistic, and the published "3-8x less token usage than mapping spreadsheets" claim is X-relative. Settled 2026-08-06, PRD open decision 7:
- S+ >= 0.5 x X on tokens (less than a 2x advantage) AND no quality separation on T5 -> STOP, correct the site copy downward without a full study
- S+ <= 0.33 x X (at least the published claim's own lower bound of 3x) -> build the full protocol
- in between (0.33-0.5 x X) -> build Phases 1-2, re-probe before the primary slice

Report S+/M as a secondary ratio. It is not a gate. The PRD predicts near-parity with a total markdown table, with the advantage showing in quality rather than tokens, so record whether that prediction held.

Also report: whether the 1-mapping cell showed S+ losing (the crossover), and an n estimate for the full run.

## Acceptance Criteria

- Go/no-go decision recorded as a PRD note with the measured ratios behind it, evaluated against arm X
- The secondary S+/M ratio reported, and the PRD's near-parity-with-markdown prediction confirmed or refuted
- Crossover at the 1-mapping cell confirmed or refuted explicitly
- An n recommendation for the full run, replacing the current guess of 5
- A list of protocol bugs found, each either fixed in the PRD or raised as its own ticket


## Notes

**2026-08-06T16:35:57Z**

Thresholds restated against arm X, not arm M. As first written the gate was markdown-relative while every other part of the PRD treats arm X as the anchor and tokens(X)/tokens(S+) as the primary statistic, so a probe where S+ beat spreadsheets but tied with markdown would have triggered STOP - and near-parity with markdown is what the PRD itself predicts, meaning the gate was set to fire on its own registered prediction. New thresholds are pinned to the published claim: stop below 2x, build at or above 3x. S+/M is still reported as a secondary. Pre-registered 2026-08-06, before sl-jdho authored any scenario and before any episode ran; no probe data existed. Recorded as PRD open decision 7 (commit immediately after fba794db).

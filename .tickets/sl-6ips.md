---
id: sl-6ips
status: open
deps: []
links: []
created: 2026-08-05T09:30:11Z
type: chore
priority: 1
assignee: Thorben Louw
tags: [eval, feature-44, feature-45]
---
# Gate: Feature 45 shipped and released before the Feature 44 eval probe runs

Feature 44's Phase 0.5 probe must not run until Feature 45 (agent-reference progressive disclosure) has shipped AND been released.

Two reasons, both from features/45-agent-reference-progressive-disclosure/PRD.md:
1. The probe charges AI-AGENT-REFERENCE.md's resident cost against the Satsuma arms. If the reference changes after the probe, the measured artifact is not the shipped one.
2. F45 carries a 'no iteration against eval outcomes' Goodhart control. A probe running in parallel would put that under strain.

This gate exists so tk does not surface the probe tickets as ready work early. Feature 45's own implementation tickets are not cut yet - closing this gate means F45 has shipped and released, however that work ends up being tracked.

## Acceptance Criteria

- Feature 45 is merged and included in a release
- AI-AGENT-REFERENCE.md's shipped delivery mechanism and its measured resident token cost are known, so Feature 44 can charge the real figure rather than a bytes/4 estimate


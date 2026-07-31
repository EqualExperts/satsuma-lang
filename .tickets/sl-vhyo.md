---
id: sl-vhyo
status: in_progress
deps: []
links: []
created: 2026-07-31T08:29:53Z
type: chore
priority: 1
assignee: Thorben Louw
---
# Bump brace-expansion across all lockfiles (1.x -> 1.1.16, 5.x -> 5.0.8) to clear Dependabot alerts 53/55/66

New brace-expansion DoS advisory wave: 1.x line patched in 1.1.16 (dev-scope, site + vscode-satsuma flagged) and 5.x line patched in 5.0.8 (runtime-scope, vscode-satsuma flagged, but every package lockfile carries 5.0.7). Transitive-only deps; fix is lockfile-only npm update in each package dir.

## Acceptance Criteria

brace-expansion >=1.1.16 / >=5.0.8 in all lockfiles; npm audit clean for brace-expansion in every package; Dependabot alerts 53/55/66 close on next default-branch scan


---
id: sl-xcqm
status: closed
deps: []
links: []
created: 2026-07-13T16:24:35Z
type: task
priority: 2
assignee: Thorben Louw
---
# Pin GitHub Actions to commit SHAs to satisfy Semgrep mutable-tag rule

Semgrep SAST now blocks on yaml.github-actions.security.github-actions-mutable-action-tag (61 findings). All workflow 'uses:' references use mutable tags like actions/checkout@v7. Every PR since ~2026-07-07 shows a failing (non-required) Semgrep SAST check. Fix: pin each action to a full 40-char commit SHA with a version comment, e.g. 'uses: actions/checkout@<sha> # v7'. Acceptance: Semgrep SAST check green on a fresh PR; all workflows under .github/workflows/ pinned; dependabot github-actions ecosystem still able to update pinned SHAs.


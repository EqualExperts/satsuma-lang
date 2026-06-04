---
id: 3eb-4vjj
status: open
deps: []
links: []
created: 2026-06-04T10:40:01Z
type: chore
priority: 2
assignee: Thorben Louw
tags: [ci, security, follow-up]
---
# Re-enable gitleaks secret-scanning once the EqualExperts GITLEAKS_LICENSE is provisioned

gitleaks-action v3 requires an org-tier licence for org-owned repos. The CI step in .github/workflows/ci.yml currently skips itself when the GITLEAKS_LICENSE repo secret is absent (gated via 'if: env.GITLEAKS_LICENSE != ""'). Once a licence has been obtained from gitleaks.io and the secret has been set on the EqualExperts/satsuma-lang repo (or organisation), no code change is required — the step re-runs automatically on the next push. Verify by checking that the 'Secret scanning' job in CI shows the gitleaks-action step running (not skipped) on a subsequent PR build.


---
id: sl-1wtv
status: in_progress
deps: []
links: []
created: 2026-08-02T06:23:57Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [ci, security]
---
# Semgrep OSS PR check reports 'configuration not found' and never gates PRs

The 'Semgrep OSS' code-scanning check on every PR reports neutral ('skipping', '1 configuration not found') instead of gating. Cause: release.yml calls security.yml via workflow_call on pushes to main, so main's code-scanning baseline gains a second configuration, .github/workflows/release.yml:semgrep, alongside .github/workflows/security.yml:semgrep. github/codeql-action/upload-sarif derives the analysis category from the CALLING workflow file, not the workflow that owns the job. PRs only run security.yml directly, so the release.yml configuration has no counterpart on the PR and GitHub cannot diff alerts.

## Acceptance Criteria

1. On a push to main, exactly one Semgrep code-scanning configuration is written. 2. The 'Semgrep OSS' check on a PR reports a real conclusion, not 'skipping / configuration not found'. 3. docs/developer/CI-WORKFLOWS.md explains why the release-invoked security gate does not publish SARIF.


## Notes

**2026-08-02T06:25:46Z**

Confirmed via the code scanning API: refs/heads/main carries two Semgrep analyses per push — analysis_key '.github/workflows/security.yml:semgrep' (from the push trigger) and '.github/workflows/release.yml:semgrep' (from release.yml's workflow_call), both 19 results at the same commit. PR check run 91464141061 is conclusion=neutral, output.title '1 configuration not found', naming '.github/workflows/release.yml:semgrep'. Semgrep itself was always running and passing; only the code-scanning diff was broken.

---
id: sl-1wtv
status: closed
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

**2026-08-02T08:02:39Z**

Cause: release.yml invokes security.yml via workflow_call on pushes to main, and github/codeql-action/upload-sarif keys a code scanning configuration on the CALLING workflow file plus job id. Main's baseline therefore carried '.github/workflows/release.yml:semgrep' alongside '.github/workflows/security.yml:semgrep', while a PR (which runs security.yml directly) could only ever produce the latter — so code scanning could not diff and the 'Semgrep OSS' check resolved neutral ('1 configuration not found'), gating nothing. Semgrep itself always ran and passed.
Fix: added a skip_sarif_upload workflow_call input to security.yml, guarding both SARIF steps with `always() && !inputs.skip_sarif_upload`; release.yml passes true and uses the workflow purely as a gate (commit 795dfbb, PR #417). Verified on the merge commit: the Release-invoked job shows Generate SARIF=skipped / Upload SARIF=skipped with Run Semgrep=success, and 795dfbb has exactly one analysis on main.
Baseline cleanup: deleted all 345 pre-existing '.github/workflows/release.yml:semgrep' analyses from refs/heads/main via the code scanning API (user-approved). Two API constraints mattered — only the newest analysis in a set is deletable, and next_analysis_url chains only within one set, so each boundary needs a re-scan of ALL pages (the newest stale survivor migrates to later pages as recent ones are removed). Open alerts verified identical before and after: 7, unchanged.

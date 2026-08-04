---
id: sl-mo1e
status: open
deps: [sl-k7po]
links: []
created: 2026-08-04T09:54:30Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-unr3
---
# Add a CI job that fails if test-stats.json has drifted

Add a job to .github/workflows/ci.yml (needs: install, so it can reuse the cached node_modules/dist) that runs 'node scripts/generate-test-stats.mjs' directly (default mode, not --from-logs -- CI has no local-hook cost constraint, and this mirrors the existing tree-sitter job's own 'generate then git diff --exit-code' pattern) and then 'git diff --exit-code test-stats.json'. On failure, print a clear ::error:: pointing at the likely cause (hook not installed -- see 'git config core.hooksPath' -- or hook bypassed with --no-verify) and telling the developer to run the script and commit the result, matching the existing '::error::Generated parser sources are out of date...' message style used by the parser job.

## Acceptance Criteria

A PR that changes a package's test count without updating test-stats.json fails this CI job with an actionable error message. A PR where test-stats.json is already correct passes. npm run lint:yaml passes on the modified workflow file.


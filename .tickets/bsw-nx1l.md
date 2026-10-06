---
id: bsw-nx1l
status: closed
deps: []
links: []
created: 2026-10-06T09:45:31Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, release, ci]
---
# release: gh release create has no --target, so the tag can land on a later commit than the one built

`.github/workflows/release.yml:152` runs `gh release create "$RELEASE_TAG"` without `--target`. When the tag does not exist yet, gh creates it at the default branch tip at the moment the release job runs, which can be minutes after the commit the artifacts were built from. Dependabot merged five PRs in about 20 minutes on 2026-10-06, so this is realistic on a release day.

## Acceptance Criteria

- The release step passes `--target "$GITHUB_SHA"` (or the checked-out sha), and the `latest` release at line 195 is checked for the same issue.

## Notes

**2026-10-06T10:06:11Z**

Cause: Both `gh release create` calls in release.yml omitted `--target`, so a tag gh had to create landed on the default branch tip when the step ran, not on the commit the artifacts were built from. The `latest` step deletes and recreates its tag every run, so it had the same gap.
Fix: Pass `--target "$GITHUB_SHA"` (the runner env var, so no expression interpolation in the script) to both the tagged and the `latest` release; no automated test covers workflow files, yamllint passes (commit immediately after cc097c32)

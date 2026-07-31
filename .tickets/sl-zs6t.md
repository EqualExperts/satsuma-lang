---
id: sl-zs6t
status: in_progress
deps: []
links: []
created: 2026-07-31T08:55:41Z
type: chore
priority: 2
assignee: Thorben Louw
---
# Patch site/ dev-chain high advisories (liquidjs et al) invisible to CI's --omit=dev audit

Full npm audit in site/ reports 5 high-severity advisories in the Eleventy build chain (e.g. liquidjs <=10.27.0 memoryLimit bypass). All transitive dev deps: CI audits --omit=dev and Dependabot doesn't raise PRs for fully-transitive packages, so these sit invisible. Same shape as the js-yaml case (sl-4wo3).

## Acceptance Criteria

npm audit in site/ reports 0 high advisories; lockfile-only change within existing semver ranges; site builds


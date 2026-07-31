---
id: sl-zs6t
status: closed
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


## Notes

**2026-07-31T09:02:14Z**

Cause: brace-expansion GHSA-mh99-v99m-4gvg declares all 1.x vulnerable (only patch: 5.0.8), reachable via old minimatch@3 chains in site (eleventy->recursive-copy) and vscode-satsuma (vscode-tmgrammar-test->glob@7); plus liquidjs memoryLimit bypass and esbuild dev-server file read. All dev-only transitives invisible to CI's --omit=dev audit and to Dependabot version PRs.
Fix: minimatch ^10.0.3 overrides in both packages (consumers verified to only use minimatch.match/.Minimatch, which v10 keeps), liquidjs in-range audit fix, esbuild ^0.28.1; full npm audit now 0 in both, eleventy build + vscode test suite green (commit 6e18145)

---
id: sl-i5ew
status: closed
deps: []
links: []
created: 2026-08-07T14:24:16Z
type: chore
priority: 2
assignee: Thorben Louw
external-ref: gh-alert-67,gh-alert-68
---
# Fix js-yaml quadratic-complexity DoS in site/ again — earlier fix not backported (Dependabot #67/#68)

Dependabot alerts #67/#68 (high, GHSA-5p4m-2wfm-xmqj): site/ resolves js-yaml 3.15.0 (via gray-matter) and 4.3.0 (via @11ty/eleventy), both dev-only/build-time transitive deps. These are the exact versions sl-4wo3 bumped to in July for the original quadratic-complexity DoS (CVE-2026-59870) — but that CVE's fix was only ever applied in the 5.x line; this new advisory (published 2026-08-06) covers the same weakness still present in 3.x/4.x. Patched releases 3.15.1 and 4.3.1 now exist and satisfy the existing ^3.13.1/^4.1.1 ranges. Fix: npm update js-yaml in site/, lockfile-only.

## Acceptance Criteria

site/package-lock.json resolves js-yaml >=3.15.1 and >=4.3.1; npm audit in site/ reports 0 high advisories; eleventy build passes; Dependabot alerts #67/#68 auto-close after merge.


## Notes

**2026-08-07T14:25:44Z**

Cause: sl-4wo3 bumped site/'s js-yaml to 3.15.0 and 4.3.0 in July for the quadratic-complexity !!omap DoS (CVE-2026-59870), but that CVE's fix was only ever applied in the 5.x line — GHSA-5p4m-2wfm-xmqj (published 2026-08-06) covers the same weakness still present in 3.15.0 and 4.3.0. Fix: npm audit fix in site/ bumped gray-matter's nested js-yaml to 3.15.1 and eleventy's to 4.3.1, both within existing ^3.13.1/^4.1.1 ranges; lockfile-only, no package.json change. npm audit now reports 0 vulnerabilities and the eleventy build passes. (commit immediately after 1f40ab23)

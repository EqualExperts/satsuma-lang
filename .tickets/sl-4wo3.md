---
id: sl-4wo3
status: closed
deps: []
links: []
created: 2026-07-22T16:26:40Z
type: chore
priority: 2
assignee: Thorben Louw
external-ref: gh-alert-42,gh-alert-43
---
# Fix js-yaml quadratic-complexity DoS in site/ (Dependabot #42/#43)

Dependabot alerts #42/#43 (medium): js-yaml quadratic-complexity DoS via merge-key repeated aliases. site/ resolves js-yaml 3.14.2 (via gray-matter) and 4.1.1 (via @11ty/eleventy), both dev-only/build-time transitive deps. Fix: npm update js-yaml in site/ bumps to patched 3.15.0 and 4.3.0 within existing ^ ranges (no package.json or override changes; site builds clean).

## Acceptance Criteria

site/package-lock.json resolves js-yaml >=3.15.0 and >=4.2.0; eleventy build passes; Dependabot alerts #42/#43 auto-close after merge.


## Notes

**2026-07-22T16:27:52Z**

2026-07-22T16:27:52Z

Cause: site/ resolved js-yaml 3.14.2 (via gray-matter) and 4.1.1 (via @11ty/eleventy), both matching the js-yaml quadratic-complexity DoS advisory (Dependabot #42/#43, medium); dev-only build-time transitive deps, not audited by CI (--omit=dev).
Fix: 'npm update js-yaml' in site/ bumped both to patched 3.15.0 and 4.3.0 within existing ^ ranges (lockfile-only, no package.json/override changes). Eleventy build verified clean.

---
id: sl-bblz
status: open
deps: []
links: []
created: 2026-07-14T06:38:18Z
type: task
priority: 2
assignee: Thorben Louw
---
# Adopt TypeScript 7 across tooling packages

Dependabot proposed typescript 6.0.3 -> 7.0.2 (PRs #358 root, #363 viz-model, #366 core) on 2026-07-14. Declined: typescript-eslint 8.64.0 peers on 'typescript >=4.8.4 <6.1.0', so TS 7 (the native-compiler major) breaks the lint stack. Told dependabot to ignore the TS 7 major in all three directories. Acceptance: when typescript-eslint (and any other TS-consuming tooling) supports TS 7, clear the dependabot ignores (reopen the closed PRs or bump manually), upgrade all packages together, and verify build + lint + full test suites.


## Notes

**2026-08-05T12:13:39Z**

Status check (2026-08-05): TypeScript 7.0 went GA 2026-07-08 (Go-native compiler,
~8-12x faster builds, same type-checking semantics as v6). It ships with no
stable programmatic API. typescript-eslint's type-aware rules depend on that
API, so a same-day support request (typescript-eslint/typescript-eslint#12518)
was closed as "not planned" — their peer range still caps at
`typescript <6.1.0`; installing TS 7 alongside it throws ERESOLVE, and forcing
past that crashes ESLint inside typescript-estree. ESLint core itself, plus
Vue/Svelte/Astro template checking, are blocked the same way.

The stable API is targeted for TypeScript 7.1, still "several months out" per
Microsoft as of this check. Still blocked; acceptance criteria unchanged.
Re-check after TypeScript 7.1 ships.

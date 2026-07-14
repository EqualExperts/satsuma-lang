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


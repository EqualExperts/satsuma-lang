---
id: sl-kxt4
status: open
deps: []
links: [sl-p47a]
created: 2026-10-06T17:00:00Z
type: chore
priority: 3
assignee: Thorben Louw
external-ref: dependabot-alert-82
tags: [security, deps, lint]
---
# security: katex prototype-pollution alert via markdownlint (GHSA-238p-pmpm-9mq7), fix outside the pinned range

Dependabot alert #82 (low): https://github.com/EqualExperts/satsuma-lang/security/dependabot/82. katex `>= 0.11.0, < 0.18.2`: existing prototype pollution can bypass katex's trust restrictions. Fixed in 0.18.2 (latest is 0.19.0).

## Where it comes from

Root `package-lock.json`, dev only, through the Markdown linter:

    markdownlint-cli2 → markdownlint → micromark-extension-math (katex ^0.16.0) → katex 0.16.47

Dependabot's security update fails because 0.18.2 is outside micromark-extension-math's `^0.16.0` range.

## Risk assessment (2026-10-06)

Low. markdownlint only parses Markdown into tokens and never renders maths to HTML, so katex's rendering path, where the trust check lives, should not run. It processes only this repository's own docs.

## Options

1. **Track and wait (current decision).** Revisit when micromark-extension-math or markdownlint moves to katex >= 0.18.2.
2. Force it with an npm `overrides` entry (`"katex": "^0.18.2"`). Caution: katex is also why the root package.json declares `commander` (katex pins commander ^8.3.0, which once hoisted over the CLI's ^15; see the `//devDependencies` note). Moving katex can change that hoisting, so run the full pre-commit suite and `npm ls commander`.
3. Dismiss the alert as "vulnerable code not used", citing this ticket.

## Acceptance Criteria

- The alert is resolved by an upstream bump or an override, or dismissed with a reason recorded here.
- If an override is used, `npm ls commander` shows satsuma-cli still resolving commander ^15, and the full hook passes.

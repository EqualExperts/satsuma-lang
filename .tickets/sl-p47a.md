---
id: sl-p47a
status: open
deps: []
links: [sl-kxt4]
created: 2026-10-06T17:00:00Z
type: chore
priority: 3
assignee: Thorben Louw
external-ref: dependabot-alert-88
tags: [security, deps, site]
---
# security: sprintf-js DoS alert in the site build (GHSA-hp3w-g68c-fv3c), no patched version exists

Dependabot alert #88 (medium): https://github.com/EqualExperts/satsuma-lang/security/dependabot/88. sprintf-js `<= 1.1.3` can be made to spend unbounded time on a format string with a huge precision specifier. **No patched version exists for any release line**, so Dependabot cannot open a PR.

## Where it comes from

`site/package-lock.json` only, as a dev dependency of the website build:

    @11ty/eleventy → gray-matter → argparse 1.x (~1.0.2 pin) → sprintf-js 1.0.3

Nothing in the CLI, LSP, VS Code extension or the published site depends on it.

## Risk assessment (2026-10-06)

Low in practice. The flaw needs an attacker-controlled format string. At build time gray-matter only parses our own front matter, and argparse formats only its own help strings, so no untrusted input reaches sprintf-js.

## Options

1. **Track and wait (current decision).** Revisit when a sprintf-js fix ships, or when gray-matter/Eleventy drop argparse 1.x.
2. Dismiss the alert in GitHub as "tolerable risk", citing this ticket.
3. Replace gray-matter's YAML path, which is not in our control while Eleventy depends on gray-matter.

## Acceptance Criteria

- The alert is resolved by an upstream fix, or dismissed with a reason recorded here.
- `npm audit` in `site/` is re-checked when this is picked up.

---
id: sl-ypu1
status: closed
deps: [sl-k7po]
links: []
created: 2026-08-04T09:54:30Z
type: task
priority: 2
assignee: Thorben Louw
parent: sl-unr3
---
# Bake test-stats.json into the website build and fix the site's own count inconsistencies

site/_data/site.json is already written by .github/workflows/deploy-site.yml just before 'cd site && npx @11ty/eleventy' runs (the precedent for injecting build-time data into Eleventy). Add one step there that copies the repo-root test-stats.json (already fresh and CI-gated by the time a release triggers this workflow) to site/_data/stats.json. Replace every hardcoded number this epic covers in site/index.njk (the 4-stat block: CLI Commands/Parser Tests/CLI Tests/LSP Tests; the '23 commands . 987 tests' and 'Full LSP . 296 tests' card captions), site/cli.njk (meta description's '22 deterministic...commands', 'All 22 CLI commands with usage patterns', the '23 commands available' terminal mock line, the 'All 23 commands' heading), site/vscode.njk (the 'LSP Tests' stat-bar number), and site/learn.njk ('Explore all 23 commands') with '{{ stats.* }}' template expressions reading from the new data file. Do not touch site/vscode.njk's '8' Commands or '11' LSP Capabilities stats or site/examples.njk's example count -- those aren't test/CLI-command counts and are out of scope for this epic. Confirm the previously-contradictory 22-vs-23 CLI command mentions across cli.njk/learn.njk now agree because they both read the same field.

## Acceptance Criteria

site/_data/stats.json is produced by deploy-site.yml from the repo-root test-stats.json. Every stat this epic covers in index.njk, cli.njk, vscode.njk, and learn.njk reads from {{ stats.* }} -- grep for the literal old numbers (22, 23, 296, 315, 879, 293, 987, 318) in those 4 template files' stat/count contexts finds none left hardcoded. A local Eleventy build (cd site && npx @11ty/eleventy) succeeds and the built HTML shows the current real counts.


## Notes

**2026-08-04T10:44:56Z**

## Notes

**2026-08-04T12:00:00Z**

Cause: The site's four static pages hardcoded CLI-command and per-package test counts by hand, so they drifted from reality and even disagreed with each other (cli.njk said 22 commands, learn.njk said 23).
Fix: Added a deploy-site.yml step that copies the repo-root test-stats.json into site/_data/stats.json (committed a real snapshot for local builds too), and replaced every in-scope hardcoded count in index.njk/cli.njk/vscode.njk/learn.njk with {{ stats.* }} lookups; left front-matter description/og_description prose non-numeric since Eleventy front matter isn't template-rendered here. (commit immediately after 20e63bb9)

---
id: saf-s5q4
status: closed
deps: []
links: []
created: 2026-08-04T21:25:27Z
type: task
priority: 2
assignee: Thorben Louw
parent: saf-dmvx
tags: [site, cli, redesign]
---
# Redesign cli.njk: agent-first, token-efficient framing; drop exhaustive command grid

Reposition the CLI as a deterministic, token-efficient tool for agents (with fmt/validate/lint as the human daily-driver subset), and remove the 'All 23 commands' categorized card grid in favour of a short pointer to satsuma --help / SATSUMA-CLI.md for the exhaustive reference. This isn't meant to be an exhaustive docsite.

## Acceptance Criteria

cli.njk keeps the agent-workflow narratives (lineage, NL extraction, metadata/codegen, whole-workspace reasoning) and the day-to-day human commands section, but no longer lists every subcommand in a card grid. A compact callout links to satsuma --help output / SATSUMA-CLI.md instead.


## Notes

**2026-08-04T21:32:47Z**

## Notes

**2026-08-04T00:00:00Z**

Cause: the "All 23 commands" section listed every subcommand in a
categorized card grid, duplicating SATSUMA-CLI.md as an exhaustive reference
on a marketing page -- the project owner called this out as not the point
of the page and asked for an agent-first, token-efficient framing instead,
pointing curious readers at `satsuma --help` / SATSUMA-CLI.md rather than
listing everything in place.
Fix: tightened the hero to explain token efficiency qualitatively (small
deterministic JSON slices vs. loading whole files, no invented benchmark
numbers) and that most commands exist for the agent, not the human. Replaced
the exhaustive command grid with a compact "that's the shape of it" callout:
one paragraph naming the command families, a styled `satsuma --help`
terminal snippet, and a link to the full GitHub reference
(commit immediately after 1518bacf).

---
id: bsw-u11n
status: open
deps: []
links: []
created: 2026-10-06T09:57:03Z
type: bug
priority: 2
assignee: Thorben Louw
tags: [bug-sweep-2026-10, cli, fmt, ci]
---
# cli: fmt --check exits 0 on a file with parse errors

`satsuma fmt --check` on any file with a parse error (e.g. containing `x INT (`) prints "skipping ...: parse error" and exits 0. Plain `fmt` and `fmt --diff` exit 2, as SATSUMA-CLI.md's fmt table and the fmt.ts header document. Cause: `&& !opts.check` at `tooling/satsuma-cli/src/commands/fmt.ts:114`. A CI gate using `fmt --check` passes unparseable files. Pre-existing.

## Acceptance Criteria

- `fmt --check` exits 2 when any file has parse errors; test added.

---
id: bsw-u11n
status: closed
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

## Notes

**2026-10-06T18:20:42Z**

Cause: `fmt.ts` returned exit 2 only when no file changed and `--check` was off (`parseErrors > 0 && wouldChange === 0 && !opts.check`). So `--check` never exited 2, and in every mode a parse error was masked once any other file was or would be reformatted.
Fix: as the user decided, any file skipped for parse errors now makes every mode (write, `--check`, `--diff`) exit 2, outranking exit 1; good files are still formatted or listed and the "would be reformatted" summary still prints. Tests cover the lone broken file and the mixed case in all three modes; SATSUMA-CLI.md and the fmt.ts header document the rule. (commit immediately after 13fbebbc)

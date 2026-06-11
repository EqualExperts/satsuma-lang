---
id: sl-00rw
status: closed
deps: []
links: []
created: 2026-06-11T02:40:50Z
type: bug
priority: 3
assignee: Thorben Louw
tags: [bug-hunt, cli]
---
# cli: summary bypasses runCommand error contract and stdout drain

satsuma-cli/src/commands/summary.ts:55 is the only async command not wrapped in runCommand; errors escape to the unhandledRejection net (index.ts:44-47) which prefixes "Unhandled error:" — breaking the CommandError message contract and bypassing the flushAndExit stdout drain that prevents truncated piped --json output. index.ts comment claims every handler is wrapped. Repro: satsuma summary /nonexistent.stm -> "Unhandled error: Error resolving path ..." vs bare message from any other command.

## Acceptance Criteria

summary wrapped in runCommand; error output matches other commands; piped --json not truncated.


## Notes

**2026-06-11T06:15:21Z**

Cause: summary.ts was the only command whose .action() handler was not wrapped in runCommand, so loadWorkspace failures escaped to the index.ts unhandledRejection net — gaining an 'Unhandled error:' prefix and bypassing the flushAndExit stdout drain.
Fix: wrapped the handler in runCommand like every other command; added a subprocess regression test asserting a bare 'Error resolving path' message on stderr with exit code 2.

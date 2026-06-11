---
id: sl-00rw
status: open
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


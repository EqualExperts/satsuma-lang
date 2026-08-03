---
id: cbdr-joay
status: closed
deps: []
links: [cbdr-xgy5]
created: 2026-08-03T16:28:14Z
type: bug
priority: 1
assignee: Thorben Louw
tags: [cli, build, ci]
---
# cli: pretest's direct tsc call skips postbuild, leaving dist/index.js non-executable

satsuma-cli's pretest script runs prebuild then the bare 'tsc' binary directly, not 'npm run build'. npm's implicit pre/post-script hooks only fire for scripts invoked by name via 'npm run <name>' -- calling tsc directly bypasses postbuild, which chmods +x onto dist/index.js (tsc itself emits it 0644). Any local 'npm test' (which fires pretest) therefore leaves dist/index.js non-executable. The LSP's validate-diagnostics.test.js spawns that file directly via child_process.execFile (no shell), which fails to exec a non-executable file; runValidate's synchronous-throw catch swallows the error and resolves an empty Map, so the sl-rngq real-CLI contract test silently reports zero diagnostics and fails fast (~1ms, not a timeout) whenever satsuma-cli's dist was last built via pretest/npm test rather than npm run build. Discovered while verifying scripts/run-repo-checks.sh end-to-end for cbdr-xgy5 (R6): the CLI's own test:typecheck and test steps run before the LSP step and leave dist non-executable, making the local pre-commit gate flaky depending on incidental prior build history. CI is unaffected: the vscode-extension job has its own explicit 'npm run build' step for satsuma-cli ("needed by LSP formatting provider") immediately before running LSP tests, which does fire postbuild.

## Design

Change satsuma-cli's pretest script from 'npm run prebuild && tsc && npm run test:typecheck' to 'npm run build && npm run test:typecheck'. npm run build already fires the prebuild hook automatically, so the explicit prebuild call becomes redundant and can be dropped; and because it is invoked by name, the postbuild hook (chmod +x) fires too, so dist/index.js is always executable after any pretest run, and npm test/pretest are no longer weaker than npm run build for this invariant. No change needed to the already-correct CI vscode-extension job.

## Acceptance Criteria

After 'npm --prefix tooling/satsuma-cli test' (a plain run, not 'npm run build'), dist/index.js has the executable bit set; tooling/satsuma-lsp's validate-diagnostics.test.js real-CLI contract test passes when run immediately after that CLI test run, with no intervening 'npm run build'; scripts/run-repo-checks.sh passes end-to-end from a from-scratch dist state; satsuma-cli's full test suite and npm audit continue to pass; the ticket receives a timestamped cause/fix note before closure.


## Notes

**2026-08-03T16:32:23Z**

Cause: satsuma-cli's `pretest` script ran the bare `tsc` binary directly instead of `npm run build`. npm's implicit pre/post-script hooks only fire for scripts invoked by name via `npm run <name>`, so the direct `tsc` call bypassed `postbuild` (which chmods +x onto `dist/index.js`; tsc itself emits it 0644). Any local `npm test` therefore left the CLI binary non-executable. `satsuma-lsp`'s `validate-diagnostics.test.js` spawns that file directly via `child_process.execFile` (no shell); a non-executable target fails to exec, and `runValidate`'s synchronous-throw catch swallowed the error into an empty Map, silently degrading the sl-rngq real-CLI contract test to a fast, misleading "zero diagnostics" failure. Found while verifying `scripts/run-repo-checks.sh` end-to-end for cbdr-xgy5 (R6): the local script has no equivalent to CI's `vscode-extension` job's explicit "Build satsuma-cli (needed by LSP formatting provider)" `npm run build` step, so the local gate was flaky depending on incidental prior build history.
Fix: changed `pretest` to `npm run build && npm run test:typecheck` — `npm run build` fires the `prebuild` and `postbuild` hooks automatically (invoked by name), so the explicit `prebuild` call became redundant and was dropped, and `dist/index.js` is now always executable after any `npm test`/`pretest` run. Verified end-to-end with `scripts/run-repo-checks.sh` from a from-scratch `dist` state. (commit immediately after c93b1130)

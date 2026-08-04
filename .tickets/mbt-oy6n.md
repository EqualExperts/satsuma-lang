---
id: mbt-oy6n
status: open
deps: []
links: []
created: 2026-08-04T17:43:52Z
type: task
priority: 3
assignee: Thorben Louw
parent: mbt-5l7g
---
# lsp: separate the esbuild bundle from the tsc output so both can be cached

`@satsuma/lsp` writes two different things to the same path. `npm run build` is an esbuild bundle emitted to `dist/server.js`; `npm run compile` is `tsc`, which compiles `src/server.ts` to the *same* `dist/server.js` alongside the per-module output (`dist/hover.js`, `dist/diagnostics.js`, ...) that the test suite's `require("../dist/...")` calls resolve against.

They have always collided — whichever ran last won, and before feature 42 that was decided by the order `install:all` and the `pretest` hook happened to run in. `npm run pack` does not rebuild, so it ships whichever `dist/server.js` is on disk.

Turborepo makes the collision visible rather than fixing it: `@satsuma/lsp#compile` is declared `"cache": false` in turbo.json precisely because it cannot declare `dist/**` as an output without a cache restore silently deciding which of the two `server.js` files survives. The cost is that tsc runs on every test invocation of this package.

## Acceptance Criteria

- The esbuild bundle and the tsc output no longer share a directory (e.g. tsc keeps `dist/`, the bundle moves to its own tree, or vice versa)
- `main`, `bin/satsuma-lsp.js`, the `files` list, `scripts/pack.js` and `scripts/verify-pack.js` all agree with the new layout
- `.c8rc.json`'s `include` covers the tsc output and not the bundle
- `@satsuma/lsp#compile` becomes a normally cached Turborepo task with declared outputs, and the `cache: false` note in turbo.json is removed
- `npm run pack` produces a tarball whose `dist/server.js` is the bundle regardless of what ran before it, verified by `scripts/verify-pack.js`


## Notes

**2026-08-04T18:13:42Z**

Evidence from R4's CI run (PR #482, run 30937118776): this is not only a tidiness
issue — the split output tree made `turbo run build` insufficient to leave a
usable workspace.

The `Test stats freshness` job spawns `npm run test` in each tracked package after
restoring the install job's blob. `ci:all` ran `turbo run build`, which for
@satsuma/lsp is the esbuild bundle only, so dist/ held server.js and the WASM
assets but none of the per-module tsc output the suite's `require("../dist/…")`
calls resolve against. Every LSP test failed with `Cannot find module
'../dist/action-context'`. Reproduced locally by deleting the LSP's dist/, running
`turbo run build`, then `npm --prefix tooling/satsuma-lsp test`.

Fixed in R4 by making `build:all` run `turbo run build compile`, which is correct
but leaves dist/server.js as the *tsc module* rather than the bundle (compile is
ordered after build). Two things now depend on that ordering detail:

- scripts/build-artifacts.sh must keep packing the LSP after calling that
  package's own `build` directly, not via build:all, or the tarball ships a
  non-self-contained server. bin/satsuma-lsp.js requires ../dist/server.js with
  no node_modules beside it, so that would fail at runtime, and
  scripts/verify-pack.js only checks the file is *present*.
- .c8rc.json includes dist/**/*.js. Folding tsc into `build` with esbuild last —
  the other obvious way to make one task produce a complete dist — would put a
  923KB bundle of inlined dependencies into the coverage denominator and take the
  LSP below its 85% line threshold. Measured 92.09% with the tsc module in place.

So the separation this ticket asks for should put the bundle outside dist/ rather
than reorder the two steps inside it.

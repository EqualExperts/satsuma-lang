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


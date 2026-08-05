# ADR-051 — Use `moduleResolution`/`module: "nodenext"`, not `"node16"`, for CommonJS packages that import ESM-only siblings

**Status:** Accepted
**Date:** 2026-08-05 (di-xup1)

## Context

`satsuma-core`, `satsuma-cli`, `satsuma-viz-model` and `satsuma-viz`/`integration-tests`
all declare `"type": "module"` in `package.json` and use
`module`/`moduleResolution: "node16"` in `tsconfig.json`. That pairing is the
repo's baseline: an ESM package resolved with the TypeScript mode introduced
alongside Node 16's stable ESM support.

`satsuma-viz-backend` and `satsuma-viz-harness` are different: both declare
`"type": "commonjs"`, but both depend on `@satsuma/core` and
`@satsuma/viz-model` (and, for `viz-harness`, `@satsuma/viz-backend` too),
all of which are ESM-only. Until di-xup1, both tsconfigs used the classic
`moduleResolution: "node"` (a.k.a. `node10`) with `baseUrl`-driven `paths`
overrides pointing directly at each dependency's `.d.ts` file — a workaround
that predates `node16`/`nodenext` resolution entirely. TypeScript 6.0
deprecated that combination and 7.0 removes it outright, which is what
di-xup1 (migrate off deprecated `moduleResolution`/`baseUrl`) set out to fix.

The obvious target was `"node16"`, matching every ESM package in the
workspace. It does not work here. `node16` mode is frozen to the module
semantics Node 16 shipped with, under which a CommonJS module can never
`require()` an ECMAScript module — there is no synchronous path, so
TypeScript rejects the attempt at compile time (`TS1479`, and `TS1541` for
type-only imports lacking a `resolution-mode` attribute). Both packages have
plain value imports of this shape (e.g. `viz-backend/src/coverage.ts`
importing `computeMappingCoverage` from `@satsuma/core`), so switching to
`node16` alone fails to compile.

`satsuma-lsp` has the identical shape — `"type": "commonjs"`, importing
`@satsuma/core` and `@satsuma/viz-backend` as values — and already resolves
it by using `moduleResolution`/`module: "nodenext"` instead of `"node16"`.
`nodenext` is not frozen: it tracks Node's current module-interop behaviour,
which since Node 22.12 includes stable synchronous `require()` of ESM
modules (`require(esm)`). CI runs Node 22, so this is safe in practice, not
just in principle.

The alternative — converting `viz-backend` and `viz-harness` to
`"type": "module"` — was not pursued. `viz-harness` bundles a Node server
with `esbuild --platform=node` and injects an `import.meta.url` shim
specifically to keep the *output* CommonJS-compatible; flipping the source
package to ESM would be a materially larger change than this ticket's scope
(deprecated-config removal) called for.

## Decision

A package whose `package.json` declares `"type": "commonjs"` but has
value imports from one or more `"type": "module"` workspace siblings must
use `module`/`moduleResolution: "nodenext"` in its `tsconfig.json`, not
`"node16"`. Packages that are themselves ESM (`"type": "module"`) continue
to use `"node16"`, since they have no CJS/ESM boundary to cross.

This is now the standing rule in three packages: `satsuma-lsp` (pre-existing),
and `satsuma-viz-backend` / `satsuma-viz-harness` (di-xup1). No `paths`
overrides, `baseUrl`, or `ignoreDeprecations` suppression are needed once
`nodenext` is in place — normal `exports`-map resolution against each
dependency's `package.json` is sufficient.

## Consequences

**Positive:**

- Removes the last two `ignoreDeprecations: "6.0"` suppressions in the
  workspace for `moduleResolution "node"`/`baseUrl`, clearing a TypeScript
  7.0 hard blocker ahead of time.
- Deletes the hand-maintained `paths` overrides in both tsconfigs that
  pointed directly at sibling `.d.ts` files — resolution now goes through
  each package's `exports` map like every other workspace consumer.
- Establishes one explicit rule instead of three independent, undocumented
  choices (`satsuma-lsp`'s was made without comment) — the next CJS package
  that needs to import an ESM sibling has a named precedent to follow instead
  of rediscovering the `TS1479`/`TS1541` errors from scratch.

**Negative:**

- `nodenext` is a moving target: as Node's module-interop behaviour evolves,
  `nodenext`'s type-checking behaviour can shift between TypeScript releases
  in ways `node16` (frozen) will not. Bumping TypeScript in these three
  packages carries slightly more risk of a compile-time behaviour change than
  in the `node16` packages.
- The rule is easy to "correct" back to `node16` by a future contributor (or
  agent) matching the majority of the workspace without realising the
  CJS/ESM boundary is what forces the exception — this ADR exists primarily
  to head that off.

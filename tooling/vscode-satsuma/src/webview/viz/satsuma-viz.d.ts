/**
 * Type stub for `@satsuma/viz`, wired in via `paths` in ../../tsconfig.json.
 *
 * viz.ts imports the package purely for its side effect — evaluating the bundle
 * registers the `<satsuma-viz>` custom element — and then talks to the element
 * through the DOM, never through the package's exported types. So there is
 * nothing to gain from resolving its real types, and something to lose:
 *
 * `@satsuma/viz` sets `"types": "src/satsuma-viz.ts"`, i.e. its *sources*. Once
 * the tooling packages became npm workspaces (ADR-049) that package became
 * resolvable from here, and TypeScript began type-checking its Lit components
 * under this package's compiler options. Those components use `@property`
 * decorators, which need the `experimentalDecorators` and
 * `useDefineForClassFields: false` settings that satsuma-viz's own tsconfig sets
 * and this one deliberately does not — so the check failed with TS1240/TS1270 on
 * files this package does not own (feature 42, R2).
 *
 * Redirecting the specifier here keeps each package's components checked by its
 * own compiler settings, and keeps this package's type-check from re-checking a
 * sibling's sources on every run. Remove the stub and the `paths` entry once
 * satsuma-viz emits real declaration files.
 */

/** Registers the `<satsuma-viz>` custom element as an import side effect. */
declare const _satsumaVizSideEffectOnly: void;
export = _satsumaVizSideEffectOnly;

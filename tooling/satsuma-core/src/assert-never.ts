/**
 * assert-never.ts — Exhaustiveness guard for discriminated domain unions.
 *
 * Consumers use this at intentionally exhaustive switches so adding a variant
 * becomes a compile-time error and an invalid boundary value still fails loud.
 */

/** Throw for a value that a complete TypeScript narrowing should make impossible. */
export function assertNever(value: never, context = "Unexpected value"): never {
  throw new TypeError(`${context}: ${String(value)}`);
}

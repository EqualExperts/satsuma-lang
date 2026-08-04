/**
 * setup.ts — shared test setup for WASM parser initialization.
 *
 * Preloaded by the `test` npm script (`--import ./test/setup.ts`) before any
 * `.test.ts` file runs. Mirrors the same one-line pattern `satsuma-viz`'s test
 * suite uses: this package has no build step of its own, so it points
 * `initParser` straight at `tree-sitter-satsuma`'s already-built grammar
 * rather than copying it into a local `dist/`.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initParser } from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

await initParser(wasmPath);

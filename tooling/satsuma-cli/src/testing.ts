/**
 * testing.ts — the CLI's cross-package testing surface.
 *
 * Everything else the CLI exports is reached through its `bin` entry point;
 * this is the one deliberate exception. Cross-consumer integration tests (see
 * `tooling/integration-tests/`) need to build the CLI's own answer in-process
 * — loading a workspace the way a command does, and assembling field edges
 * with the CLI's actual endpoint policy — rather than re-deriving it or
 * shelling out and re-parsing `--json` output. This module re-exports exactly
 * those pieces and nothing else: it is not a general-purpose library surface,
 * and callers outside `tooling/integration-tests/` should not depend on it.
 *
 * Owns: naming the small set of internals a cross-package test needs. Does
 * not own any of the logic itself — every export here is a straight re-export
 * from the module that actually implements it.
 */

export { loadWorkspace } from "./load-workspace.js";
export type { LoadedWorkspace, LoadWorkspaceOptions } from "./load-workspace.js";

export { createFieldEdgeSource } from "./field-edge-source.js";

export { distinctArrowRecords } from "./index-builder.js";

export { arrowEndpoint } from "./field-endpoints.js";

export { coverageForWorkspace } from "./coverage-workspace.js";

export { resolveAllNLRefs } from "./nl-ref-extract.js";

export type { ArrowRecord, ExtractedWorkspace } from "./types.js";

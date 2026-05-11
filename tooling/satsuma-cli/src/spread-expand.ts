/**
 * spread-expand.ts — CLI bridge between ExtractedWorkspace and satsuma-core spreads
 *
 * Spread expansion logic lives in satsuma-core/src/spread-expand.ts. Per
 * ADR-005, core uses EntityRefResolver and SpreadEntityLookup callbacks so
 * it never has to know about ExtractedWorkspace. This module's job is to build
 * those callbacks from an ExtractedWorkspace and expose expand* functions with
 * the index-shaped signatures CLI callers expect.
 *
 * Owns: ExtractedWorkspace → callback adaptation.
 * Does not own: the spread expansion algorithm itself (that is in core).
 */

import {
  collectFieldPaths as _collectFieldPaths,
  expandSpreads as _expandSpreads,
  expandEntityFields as _expandEntityFields,
  expandNestedSpreads as _expandNestedSpreads,
} from "@satsuma/core";
import type {
  SpreadEntity,
  SpreadDiagnostic,
  ExpandedField,
} from "@satsuma/core";
import { resolveScopedEntityRef } from "./index-builder.js";
import type { FieldDecl, ExtractedWorkspace } from "./types.js";

// Re-export the pure function directly.
export { collectFieldPaths } from "@satsuma/core";
export type { SpreadDiagnostic, ExpandedField };

// ── ExtractedWorkspace → callback adapters ────────────────────────────────────────

function makeIndexRefResolver(currentNs: string | null, entityMap: Map<string, unknown>) {
  return (ref: string, _ns: string | null) => resolveScopedEntityRef(ref, currentNs, entityMap);
}

/**
 * Expand fragment spreads for a set of schema keys, adding fragment fields
 * to the fieldPaths set. Wraps satsuma-core's callback-based expandSpreads.
 */
export function expandSpreads(
  schemaKeys: string[],
  currentNs: string | null,
  index: ExtractedWorkspace,
  fieldPaths: Set<string>,
  diagnostics: SpreadDiagnostic[] = [],
): boolean {
  const resolveRef = makeIndexRefResolver(currentNs, index.fragments);
  const lookupFragment = (key: string) => index.fragments.get(key);
  const lookupSchema = (key: string) => index.schemas.get(key);
  return _expandSpreads(schemaKeys, currentNs, resolveRef, lookupFragment, fieldPaths, diagnostics, lookupSchema);
}

/**
 * Expand fragment spreads for a single entity, returning expanded field objects.
 * Wraps satsuma-core's callback-based expandEntityFields.
 */
export function expandEntityFields(
  entity: SpreadEntity | null | undefined,
  currentNs: string | null,
  index: ExtractedWorkspace,
): ExpandedField[] {
  const resolveRef = makeIndexRefResolver(currentNs, index.fragments);
  const lookupFragment = (key: string) => index.fragments.get(key);
  return _expandEntityFields(entity, currentNs, resolveRef, lookupFragment);
}

/**
 * Recursively expand fragment spreads within nested record fields (in place).
 * Wraps satsuma-core's callback-based expandNestedSpreads.
 */
export function expandNestedSpreads(
  fields: FieldDecl[],
  currentNs: string | null,
  index: ExtractedWorkspace,
): void {
  const resolveRef = makeIndexRefResolver(currentNs, index.fragments);
  const lookupFragment = (key: string) => index.fragments.get(key);
  _expandNestedSpreads(fields, currentNs, resolveRef, lookupFragment);
}

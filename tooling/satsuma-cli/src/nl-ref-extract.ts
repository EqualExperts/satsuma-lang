/**
 * nl-ref-extract.ts — CLI bridge between ExtractedWorkspace and satsuma-core NL refs
 *
 * All NL ref logic lives in satsuma-core/src/nl-ref.ts. Per ADR-006, core
 * accepts a DefinitionLookup callback so it can stay independent of any
 * particular index representation. This module's job is to construct that
 * lookup from the CLI's ExtractedWorkspace and re-export the resolver functions
 * with the index-shaped signatures CLI commands expect.
 *
 * It also owns countNlDerivedEdgesByMapping, which is index-specific
 * accounting that has no place in core.
 *
 * Owns: ExtractedWorkspace → DefinitionLookup adaptation; nl-derived edge counts.
 * Does not own: ref classification, resolution, or NL data extraction
 * (those are pure functions in @satsuma/core).
 */

import {
  extractAtRefs,
  computeNLRefPosition,
  classifyRef,
  resolveRef as _resolveRef,
  extractNLRefData,
  resolveAllNLRefs as _resolveAllNLRefs,
  isSchemaInMappingSources as _isSchemaInMappingSources,
} from "@satsuma/core";
import type {
  AtRef,
  RefClassification,
  Resolution,
  ResolvedNLRef,
  DefinitionLookup,
} from "@satsuma/core";
import type { MappingRecord, NLRefData, ExtractedWorkspace } from "./types.js";
import { expandEntityFields } from "./spread-expand.js";
import { canonicalKey, distinctArrowRecords, qualifyField } from "./index-builder.js";

// Re-export pure functions and types directly.
export { extractAtRefs, computeNLRefPosition, classifyRef, extractNLRefData };
export type { AtRef, RefClassification, Resolution, ResolvedNLRef };

// ── ExtractedWorkspace → DefinitionLookup bridge ──────────────────────────────────

function makeLookup(index: ExtractedWorkspace): DefinitionLookup {
  return {
    hasSchema: (key) => index.schemas.has(key),
    getSchema: (key) => index.schemas.get(key) ?? null,
    hasFragment: (key) => (index.fragments?.has(key) ?? false),
    getFragment: (key) => index.fragments?.get(key) ?? null,
    hasTransform: (key) => (index.transforms?.has(key) ?? false),
    getMapping: (key) => index.mappings.get(key) ?? null,
    iterateSchemas: () => index.schemas.entries(),
    expandSpreads: (entity, ns) => expandEntityFields(entity, ns, index),
  };
}

interface MappingContext {
  sources: string[];
  targets: string[];
  namespace: string | null;
}

/**
 * Resolve a single @ref against the workspace index.
 */
export function resolveRef(ref: string, mappingContext: MappingContext, index: ExtractedWorkspace): Resolution {
  return _resolveRef(ref, mappingContext, makeLookup(index));
}

/**
 * Process pre-extracted NL ref data into fully resolved reference records.
 */
export function resolveAllNLRefs(index: ExtractedWorkspace): ResolvedNLRef[] {
  const nlRefData: NLRefData[] = index.nlRefData ?? [];
  return _resolveAllNLRefs(nlRefData, makeLookup(index));
}

/**
 * Check if a schema reference from an NL block is declared in the mapping's
 * source or target list.
 */
export function isSchemaInMappingSources(schemaRef: string, mapping: MappingRecord | undefined): boolean {
  return _isSchemaInMappingSources(schemaRef, mapping);
}

/**
 * Count nl-derived edges per mapping key, applying the same deduplication
 * rules as the graph builder.
 *
 * A resolved NL @ref produces an nl-derived edge from the referenced field
 * to the arrow's target field. Two dedup rules suppress redundant edges:
 *  1. Self-references: skip if source and target resolve to the same field.
 *  2. Declared coverage: skip if a declared (non-nl-derived) arrow already
 *     connects the same source→target in the same mapping — the nl ref is
 *     merely annotating an explicit source, not adding new lineage.
 *
 * This function is the canonical count used by both `summary --json` and any
 * other consumer that needs a consistent nl-derived arrow tally.
 */
export function countNlDerivedEdgesByMapping(index: ExtractedWorkspace): Map<string, number> {
  // ── Step 1: build the set of declared source→target pairs per mapping ──────
  // Pre-qualify all declared arrow source/target fields so they can be compared
  // against canonical nl ref names without re-running the full graph builder.
  const declaredCoverage = new Set<string>();

  // fieldArrows stores each record under multiple keys — distinctArrowRecords
  // deduplicates by reference (a positional key would collapse distinct
  // same-line arrows; see its doc-comment).
  for (const record of distinctArrowRecords(index.fieldArrows)) {
    // Only declared (non-synthetic) arrows can cover an nl-derived edge.
    if (record.classification === "nl-derived") continue;

    const mappingKey = record.namespace
      ? `${record.namespace}::${record.mapping}`
      : (record.mapping ?? "");
    const mapping = index.mappings.get(mappingKey);
    const sourceSchemas = mapping?.sources ?? [];
    const targetSchemas = mapping?.targets ?? [];

    const toField = record.target
      ? canonicalKey(qualifyField(record.target, targetSchemas))
      : null;
    if (!toField) continue;

    for (const src of record.sources) {
      const fromField = canonicalKey(qualifyField(src, sourceSchemas));
      declaredCoverage.add(`${fromField}|${toField}|${mappingKey}`);
    }
  }

  // ── Step 2: count nl-derived edges, skipping redundant ones ─────────────────
  const nlRefs = resolveAllNLRefs(index);
  const counts = new Map<string, number>();
  const nlSeen = new Set<string>();

  for (const nlRef of nlRefs) {
    if (!nlRef.resolved || !nlRef.resolvedTo || nlRef.resolvedTo.kind !== "field") continue;
    if (!nlRef.targetField) continue;

    const mappingKey = nlRef.mapping;
    const mapping = index.mappings.get(mappingKey);
    if (!mapping) continue;

    const sourceField = nlRef.resolvedTo.name; // already canonical, e.g. "::schema.field"
    const targetField = canonicalKey(qualifyField(nlRef.targetField, mapping.targets));

    // Rule 1: skip self-references.
    if (sourceField === targetField) continue;

    // Dedup: count each unique source→target→mapping pair once.
    const dedupKey = `${sourceField}|${targetField}|${mappingKey}`;
    if (nlSeen.has(dedupKey)) continue;
    nlSeen.add(dedupKey);

    // Rule 2: skip if a declared arrow already covers this source→target.
    if (declaredCoverage.has(dedupKey)) continue;

    counts.set(mappingKey, (counts.get(mappingKey) ?? 0) + 1);
  }

  return counts;
}

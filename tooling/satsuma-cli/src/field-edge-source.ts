/**
 * field-edge-source.ts — CLI index adapter for core field-edge assembly.
 *
 * Converts ExtractedWorkspace's multi-key arrow index and resolved NL-ref data
 * into core's narrow FieldEdgeSource contract. It owns CLI-specific object-
 * identity deduplication and endpoint policy; it does not assemble any edges.
 */

import type { FieldEdgeSource } from "@satsuma/core";
import { arrowEndpoint } from "./field-endpoints.js";
import { distinctArrowRecords } from "./index-builder.js";
import { resolveAllNLRefs } from "./nl-ref-extract.js";
import type { ArrowRecord, ExtractedWorkspace } from "./types.js";

interface FieldEdgeSourceOptions {
  /** Keep only mappings accepted by this caller-owned filter. */
  includeMapping?: (mappingKey: string) => boolean;
}

/** Return the index key for the mapping that owns an extracted arrow. */
function arrowMappingKey(arrow: ArrowRecord): string {
  return arrow.namespace ? `${arrow.namespace}::${arrow.mapping}` : (arrow.mapping ?? "");
}

/**
 * Adapt one CLI workspace index to core's field-edge input contract.
 *
 * The optional mapping predicate is how graph keeps namespace filtering on the
 * consumer side. Field-lineage omits it and therefore traverses the full index.
 */
export function createFieldEdgeSource(
  index: ExtractedWorkspace,
  options: FieldEdgeSourceOptions = {},
): FieldEdgeSource {
  const includeMapping = options.includeMapping ?? (() => true);
  const arrows = [...distinctArrowRecords(index.fieldArrows)].filter((arrow) =>
    includeMapping(arrowMappingKey(arrow)),
  );
  const nlRefs = resolveAllNLRefs(index).filter((ref) => includeMapping(ref.mapping));

  return {
    arrows,
    mappingSides: (mappingKey) => {
      const mapping = index.mappings.get(mappingKey);
      return mapping ? { sources: mapping.sources, targets: mapping.targets } : null;
    },
    nlRefs,
    resolveEndpoint: arrowEndpoint,
  };
}

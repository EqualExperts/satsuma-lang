/**
 * field-coverage.ts — Shared mapping-detail coverage helpers for satsuma-viz.
 *
 * The web component should consume the same nested-field coverage semantics as
 * the LSP coverage path utilities instead of comparing leaf names ad hoc.
 */

import { buildCoveredFieldSet, schemaLocalFieldPath } from "@satsuma/core/coverage-paths";
import type {
  ArrowEntry,
  EachBlock,
  FieldEntry,
  FlattenBlock,
  MappingBlock,
  NestedArrowBlock,
  SchemaCard,
  VizModel,
} from "./model.js";

/**
 * The subset of SchemaCard that field-path resolution needs. Metric cards
 * (via the metric-adapter's widened field entries) satisfy it too, so layout
 * code can resolve arrow refs against metric nodes (sl-l7u0).
 */
export interface FieldPathCard {
  /** Fully qualified name, e.g. "crm::customers". Equal to id when no namespace. */
  qualifiedId: string;
  fields: FieldEntry[];
}

/**
 * Return true when the schema declares the exact local dotted field path.
 */
export function schemaHasFieldPath(schema: FieldPathCard, fieldPath: string): boolean {
  const parts = fieldPath.split(".");
  let fields = schema.fields;
  for (const part of parts) {
    const field = fields.find((candidate) => candidate.name === part);
    if (!field) return false;
    fields = field.children;
  }
  return true;
}

/**
 * Resolve an arrow field reference to the schema-local dotted field path for a
 * specific schema card, or null when it belongs to another schema.
 *
 * The prefix rules — including matching a namespaced schema by both its
 * qualified id and its authored bare name (sl-iqud) — live in core's
 * {@link schemaLocalFieldPath}, shared with `satsuma coverage` and the VS Code
 * gutter so the three cannot drift. This wrapper adds the one rule specific to
 * rendering a card: a path this schema does not declare is not shown against
 * it, since the viz resolves every arrow against every card on screen.
 *
 * Examples:
 * - `customer_profiles.region` + schema `customer_profiles` -> `region`
 * - `customers.id` + schema `crm::customers` -> `id`
 * - `customer.email` + schema `order_events` -> `customer.email`
 * - `other_schema.id` + schema `order_events` -> null
 */
export function resolveSchemaLocalFieldPath(
  fieldRef: string,
  schema: FieldPathCard,
  sourceRefs: string[],
): string | null {
  const otherRefs = sourceRefs.filter((ref) => ref !== schema.qualifiedId);
  const declaresTopLevel = (name: string): boolean =>
    schema.fields.some((field) => field.name === name);

  const local = schemaLocalFieldPath(fieldRef, [schema.qualifiedId], otherRefs, declaresTopLevel);
  if (local === null) return null;

  // An explicit `thisSchema.` prefix is proof enough that the ref is meant for
  // this card. Only an unprefixed ref — which could belong to any card on
  // screen — has to be confirmed against the declared fields.
  if (local !== fieldRef) return local;

  return schemaHasFieldPath(schema, local) ? local : null;
}

/**
 * Walk every arrow in a mapping, including those nested arbitrarily deep inside
 * `each`, `flatten` and `nested_arrow` blocks in any combination.
 *
 * All three container kinds carry the same nesting collections, so one
 * recursion handles them rather than each block type getting its own
 * traversal. Walking only `nestedEach` missed every arrow under a `flatten`
 * inside an `each` — the shape of `examples/nested-iteration/pipeline.stm:100`
 * (sl-vu22) — and omitting `nestedArrows` dropped every arrow inside a braced
 * `src -> tgt { .a -> .b }` group from all counting surfaces (svdfe-s6we).
 *
 * **Which headers count as arrows** (mirrors core's `extractArrowRecords`, so
 * viz counts agree with the CLI's for the same file): an each/flatten header
 * opens an iteration scope and is NOT an arrow, but a `nested_arrow` header
 * genuinely maps record to record (`addr -> address`) and IS one — it is
 * visited as a synthesized {@link ArrowEntry} before the block's body.
 */
export function forEachMappingArrow(
  mapping: MappingBlock,
  visit: (arrow: ArrowEntry) => void,
): void {
  // The model stores a nested_arrow's own record→record mapping as header
  // fields on the block; reconstitute it as the arrow core counts it as.
  const headerArrowOf = (block: NestedArrowBlock): ArrowEntry => ({
    sourceFields: [block.sourceField],
    targetField: block.targetField,
    transform: null,
    metadata: [],
    comments: [],
    location: block.location,
  });

  const visitBlocks = (blocks: Array<EachBlock | FlattenBlock | NestedArrowBlock>): void => {
    for (const block of blocks) {
      for (const arrow of block.arrows) visit(arrow);
      for (const nested of block.nestedArrows) visit(headerArrowOf(nested));
      visitBlocks([...block.nestedEach, ...block.nestedFlatten, ...block.nestedArrows]);
    }
  };

  for (const arrow of mapping.arrows) visit(arrow);
  for (const nested of mapping.nestedArrows) visit(headerArrowOf(nested));
  visitBlocks([...mapping.eachBlocks, ...mapping.flattenBlocks, ...mapping.nestedArrows]);
}

/**
 * Total arrow count of a mapping, including arrows nested arbitrarily deep in
 * `each`, `flatten` and `nested_arrow` blocks in any combination, plus each
 * `nested_arrow` header itself (see {@link forEachMappingArrow} for the header
 * rule). Every "N arrows" surface must use this rather than summing the
 * top-level collections, which silently undercounts nested iteration (sl-fm0q).
 */
export function countMappingArrows(mapping: MappingBlock): number {
  let count = 0;
  forEachMappingArrow(mapping, () => count++);
  return count;
}

/**
 * Build schema-local covered-field sets for one mapping detail view.
 */
export function buildMappingCoveredFields(
  mapping: MappingBlock,
  sourceSchemas: SchemaCard[],
  targetSchema: SchemaCard | null,
): { sourceMapped: Map<string, Set<string>>; targetMapped: Set<string> } {
  const sourceFieldRefs = new Map<string, string[]>();
  for (const schema of sourceSchemas) sourceFieldRefs.set(schema.qualifiedId, []);

  const targetFieldRefs: string[] = [];

  forEachMappingArrow(mapping, (arrow) => {
    if (targetSchema) {
      const targetPath = resolveSchemaLocalFieldPath(arrow.targetField, targetSchema, [mapping.targetRef]);
      if (targetPath) targetFieldRefs.push(targetPath);
    }

    for (const sourceField of arrow.sourceFields) {
      for (const schema of sourceSchemas) {
        const localPath = resolveSchemaLocalFieldPath(sourceField, schema, mapping.sourceRefs);
        if (localPath) sourceFieldRefs.get(schema.qualifiedId)!.push(localPath);
      }
    }
  });

  const sourceMapped = new Map<string, Set<string>>();
  for (const [schemaId, refs] of sourceFieldRefs) {
    sourceMapped.set(schemaId, buildCoveredFieldSet(refs));
  }

  return {
    sourceMapped,
    targetMapped: buildCoveredFieldSet(targetFieldRefs),
  };
}

/**
 * Build the overview-level mapped-field index across the whole VizModel.
 */
export function buildMappedFieldsIndex(model: VizModel): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const allSchemas = new Map(
    model.namespaces.flatMap((ns) => ns.schemas.map((schema) => [schema.qualifiedId, schema] as const)),
  );

  for (const ns of model.namespaces) {
    for (const mapping of ns.mappings) {
      const sourceSchemas = mapping.sourceRefs
        .map((schemaId) => allSchemas.get(schemaId))
        .filter((schema): schema is SchemaCard => schema != null);
      const targetSchema = allSchemas.get(mapping.targetRef) ?? null;
      const { sourceMapped, targetMapped } = buildMappingCoveredFields(mapping, sourceSchemas, targetSchema);

      for (const [schemaId, covered] of sourceMapped) {
        if (!index.has(schemaId)) index.set(schemaId, new Set());
        for (const path of covered) index.get(schemaId)!.add(path);
      }

      if (targetSchema) {
        if (!index.has(targetSchema.qualifiedId)) index.set(targetSchema.qualifiedId, new Set());
        for (const path of targetMapped) index.get(targetSchema.qualifiedId)!.add(path);
      }
    }
  }

  return index;
}

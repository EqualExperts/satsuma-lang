/**
 * field-coverage.ts — Shared mapping-detail coverage helpers for satsuma-viz.
 *
 * The web component should consume the same nested-field coverage semantics as
 * the LSP coverage path utilities instead of comparing leaf names ad hoc.
 */

import { buildCoveredFieldSet, schemaLocalFieldPath } from "@satsuma/core/coverage-paths";
import { qualifyChildArrowPath } from "@satsuma/core/extract";
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
 * One arrow as the walk hands it to a visitor: the model's entry, plus the
 * paths it references resolved against the containers it sits inside.
 *
 * The two are separate because the model and the resolvers want different
 * things from the same arrow. The model deliberately stores paths **as
 * authored** — `.line1 -> .line1` renders in the mapping-detail table under the
 * `each parcels -> packed` heading that gives it its meaning, and a row showing
 * the expanded `parcels.line1` there would be noise the author did not write.
 * Anything matching an arrow against a *declared field*, on the other hand,
 * needs the absolute path, because that is the only form a schema declares.
 */
export interface MappingArrowVisit {
  /**
   * The arrow exactly as the model holds it — authored paths, and the same
   * object identity the renderer uses for hover and highlight comparisons.
   */
  arrow: ArrowEntry;
  /** `arrow.sourceFields`, each made absolute against the enclosing containers. */
  sourceFields: string[];
  /** `arrow.targetField`, made absolute against the enclosing containers. */
  targetField: string;
}

/**
 * Walk every arrow in a mapping, including those nested arbitrarily deep inside
 * `each`, `flatten` and `nested_arrow` blocks in any combination, resolving each
 * one's paths against the containers it is authored inside.
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
 *
 * **Path qualification** is core's rule ({@link qualifyChildArrowPath}), applied
 * with the container's own already-qualified paths as the prefix so it
 * accumulates through arbitrary nesting — the same recursion core's
 * `collectArrowRecords` performs over the CST. Every resolution-dependent
 * surface reaches its arrows through this walk, so applying the rule once here
 * is what keeps them all agreeing with the CLI (3cdd-yavi).
 */
export function forEachMappingArrow(
  mapping: MappingBlock,
  visit: (entry: MappingArrowVisit) => void,
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

  /** Visit one arrow, qualified against the container scope it was found in. */
  const visitArrow = (arrow: ArrowEntry, scope: ContainerScope): void => {
    visit({
      arrow,
      sourceFields: arrow.sourceFields.map((f) => qualifyChildArrowPath(f, scope.source)),
      targetField: qualifyChildArrowPath(arrow.targetField, scope.target),
    });
  };

  const visitBlocks = (
    blocks: Array<EachBlock | FlattenBlock | NestedArrowBlock>,
    outer: ContainerScope,
  ): void => {
    for (const block of blocks) {
      // The block's own header is relative to the block enclosing it, and its
      // qualified form is the prefix everything inside it resolves against.
      const scope = scopeWithin(outer, block);
      for (const arrow of block.arrows) visitArrow(arrow, scope);
      for (const nested of block.nestedArrows) {
        visitArrow(headerArrowOf(nested), scope);
      }
      visitBlocks([...block.nestedEach, ...block.nestedFlatten, ...block.nestedArrows], scope);
    }
  };

  for (const arrow of mapping.arrows) visitArrow(arrow, MAPPING_BODY_SCOPE);
  for (const nested of mapping.nestedArrows) {
    visitArrow(headerArrowOf(nested), MAPPING_BODY_SCOPE);
  }
  visitBlocks(
    [...mapping.eachBlocks, ...mapping.flattenBlocks, ...mapping.nestedArrows],
    MAPPING_BODY_SCOPE,
  );
}

/**
 * The absolute source and target paths that child arrows inside a container
 * resolve against. Null on a side means "no container" — at mapping-body level,
 * or when a malformed block declares no path on that side.
 */
export interface ContainerScope {
  /** Absolute source path of the enclosing container chain. */
  source: string | null;
  /** Absolute target path of the enclosing container chain. */
  target: string | null;
}

/** Mapping-body level: arrows there are already absolute. */
export const MAPPING_BODY_SCOPE: ContainerScope = { source: null, target: null };

/**
 * The scope inside `block`, given the scope the block itself sits in.
 *
 * A block's header is authored relative to its own container (`each .parcels ->
 * .packed` inside another `each`), so the header is qualified first and the
 * result becomes the prefix for everything the block contains — which is how
 * one rule covers nesting of any depth. An empty path on either side (a
 * malformed block) leaves that side unprefixed rather than producing a path
 * with a dangling dot.
 */
export function scopeWithin(
  outer: ContainerScope,
  block: EachBlock | FlattenBlock | NestedArrowBlock,
): ContainerScope {
  return {
    source: qualifyChildArrowPath(block.sourceField, outer.source) || null,
    target: qualifyChildArrowPath(block.targetField, outer.target) || null,
  };
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

  // Resolution reads the *qualified* paths: `.line1` under `each parcels ->
  // packed` declares no field on its own, and matching it as authored resolved
  // to nothing, so every relative-path arrow contributed no coverage (3cdd-yavi).
  forEachMappingArrow(mapping, ({ sourceFields, targetField }) => {
    if (targetSchema) {
      const targetPath = resolveSchemaLocalFieldPath(targetField, targetSchema, [
        mapping.targetRef,
      ]);
      if (targetPath) targetFieldRefs.push(targetPath);
    }

    for (const sourceField of sourceFields) {
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
    model.namespaces.flatMap((ns) =>
      ns.schemas.map((schema) => [schema.qualifiedId, schema] as const),
    ),
  );

  for (const ns of model.namespaces) {
    for (const mapping of ns.mappings) {
      const sourceSchemas = mapping.sourceRefs
        .map((schemaId) => allSchemas.get(schemaId))
        .filter((schema): schema is SchemaCard => schema != null);
      const targetSchema = allSchemas.get(mapping.targetRef) ?? null;
      const { sourceMapped, targetMapped } = buildMappingCoveredFields(
        mapping,
        sourceSchemas,
        targetSchema,
      );

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

/**
 * field-coverage.ts — Reading field coverage, and resolving arrow paths, in satsuma-viz.
 *
 * Two jobs that used to be one. **Resolving** an arrow's paths against the
 * containers and schemas it refers to is this module's own work, and every
 * hover, highlight and layout surface goes through {@link forEachMappingArrow}
 * and {@link resolveSchemaLocalFieldPath} so they cannot disagree about what an
 * arrow points at. **Coverage** is not: it arrives precomputed by `@satsuma/core`
 * in `MappingBlock.coverage`, and the functions here only select and combine
 * those entries.
 *
 * That split is the fix for sl-46wr and sl-csrs. This module used to derive its
 * own covered-path set by walking the model's arrows — a third derivation
 * alongside the CLI's and the LSP's — and it counted declared arrows only. Two
 * coverage rules are invisible in an arrow's endpoints: a leaf named by a
 * resolved NL `@ref` is covered (ADR-036), and an arrow onto a record covers
 * that record's subtree when it enumerates no children (ADR-037). Neither could
 * be seen from here, so the schema card disagreed with `satsuma coverage` on
 * twelve of the shipped examples, and every rule added to coverage had to be
 * written twice or the card drifted again. Nothing in this module decides what
 * is covered any more.
 */

import { schemaLocalFieldPath } from "@satsuma/core/coverage-paths";
import { unionFieldCoverage } from "@satsuma/core/coverage-rollup";
import { uncoveredFieldCoverage } from "@satsuma/core/coverage";
import { qualifyChildArrowPath } from "@satsuma/core/extract";
import type { CoverageField, FieldCoverageEntry } from "@satsuma/core/coverage";
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

// ── Reading core's coverage out of the model ────────────────────────────────

/**
 * The coverage entries for one schema card in one mapping and role, as core
 * computed them.
 *
 * Falls back to "every field uncovered" when the mapping carries no coverage —
 * a model assembled without a workspace index, or a payload cached by a host
 * predating `MappingBlock.coverage`. The fallback is core's
 * {@link uncoveredFieldCoverage} rather than an empty list because the card
 * still needs a denominator, and a card that counts its own fields is how the
 * ratio started including containers (sl-hcan).
 *
 * `role` matters: a schema may sit on both sides of one mapping, and the detail
 * view renders it as two cards asking two different questions — what this
 * mapping *reads* from it, and what this mapping *writes* into it.
 */
export function mappingSchemaCoverage(
  mapping: MappingBlock,
  schema: SchemaCard,
  role: "source" | "target",
): FieldCoverageEntry[] {
  const found = mapping.coverage?.schemas.find(
    (s) => s.role === role && s.schemaId === schema.qualifiedId,
  );
  return found
    ? found.fields
    : uncoveredFieldCoverage(toCoverageFields(schema.fields), schema.location.uri);
}

/**
 * Coverage for every schema card in the model, unioned across every mapping and
 * both roles — what the overview card reports.
 *
 * The overview asks "does anything in this workspace touch this field?", so a
 * schema read by one mapping and written by another is reported once, with both
 * contributions merged. Merging is core's {@link unionFieldCoverage}: a leaf is
 * covered when any mapping covers it, under the strongest tier any of them
 * claims, and containers are then re-derived from the unioned leaves — which is
 * not the same as OR-ing the containers, since two mappings that each cover half
 * of a record cover all of it between them.
 *
 * Every declared schema gets an entry, seeded with its own all-uncovered field
 * list, so a schema no mapping references reports `0/N` rather than dropping out
 * of the index and leaving its card with nothing to count.
 */
export function buildCoverageIndex(model: VizModel): Map<string, FieldCoverageEntry[]> {
  const contributions = new Map<string, FieldCoverageEntry[][]>();

  // Seed first: the card's own field tree defines the denominator and the row
  // order, and every mapping's entries merge into it.
  for (const ns of model.namespaces) {
    for (const schema of ns.schemas) {
      contributions.set(schema.qualifiedId, [
        uncoveredFieldCoverage(toCoverageFields(schema.fields), schema.location.uri),
      ]);
    }
  }

  for (const ns of model.namespaces) {
    for (const mapping of ns.mappings) {
      for (const covered of mapping.coverage?.schemas ?? []) {
        contributions.get(covered.schemaId)?.push(covered.fields);
      }
    }
  }

  const index = new Map<string, FieldCoverageEntry[]>();
  for (const [schemaId, lists] of contributions) {
    index.set(schemaId, unionFieldCoverage(lists));
  }
  return index;
}

/** Project the model's field entries onto core's minimal coverage field shape. */
function toCoverageFields(fields: FieldEntry[]): CoverageField[] {
  return fields.map((f) => ({
    name: f.name,
    line: f.location.line,
    children: toCoverageFields(f.children),
  }));
}

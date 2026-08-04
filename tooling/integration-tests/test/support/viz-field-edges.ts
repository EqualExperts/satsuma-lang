/**
 * viz-field-edges.ts — adapts a VizModel's independently-extracted arrows into
 * core's `FieldEdgeSource`, so the *same* core edge builder
 * (`buildFieldEdges`) that assembles the CLI's field edges can assemble the
 * viz/LSP side too. Any disagreement between the two resulting edge lists is
 * therefore a genuine extraction-pipeline bug (viz-backend's CST walk versus
 * the CLI's), not a re-derived resolution policy — `resolveEndpoint` below is
 * the CLI's own `arrowEndpoint`, not a second guess at `r0-7w76`.
 *
 * The container-scope accumulation here (`ContainerScope`, `scopeWithin`) is a
 * small, deliberate re-port of `satsuma-viz/src/field-coverage.ts`'s
 * `forEachMappingArrow` — the algorithm that keeps the viz layout and its
 * coverage card agreeing about what an arrow's *resolved* path is. It is not
 * reachable from here without depending on `@satsuma/viz` (a Lit component
 * with no unbundled build output — see this feature's ADR), so it is
 * reimplemented from the one shared primitive that *is* portable,
 * `qualifyChildArrowPath`. The two copies existing at all is exactly the risk
 * this sweep exists to catch; this file is deliberately the smaller,
 * read-everything-at-a-glance one to compare the real one against.
 *
 * Owns: walking a `VizModel`'s mapping structure into `FieldEdgeSource` shape.
 * Does not own: any edge-building or comparison logic, which stays in core and
 * in the test that calls this.
 */

import { qualifyChildArrowPath } from "@satsuma/core/extract";
import { arrowEndpoint } from "satsuma-cli/testing";
import type { FieldArrowLike, FieldEdgeSource, FieldMappingSides } from "@satsuma/core";
import type {
  ArrowEntry,
  EachBlock,
  FlattenBlock,
  MappingBlock,
  NamespaceGroup,
  NestedArrowBlock,
  VizModel,
} from "@satsuma/viz-backend/viz-model";

/** The absolute source/target paths child arrows inside a container resolve against. */
interface ContainerScope {
  source: string | null;
  target: string | null;
}

/** Mapping-body level: arrows there are already absolute. */
const MAPPING_BODY_SCOPE: ContainerScope = { source: null, target: null };

/** The scope inside `block`, given the scope the block itself sits in. */
function scopeWithin(
  outer: ContainerScope,
  block: EachBlock | FlattenBlock | NestedArrowBlock,
): ContainerScope {
  return {
    source: qualifyChildArrowPath(block.sourceField, outer.source) || null,
    target: qualifyChildArrowPath(block.targetField, outer.target) || null,
  };
}

/** One qualified arrow, ready to become a `FieldArrowLike`. */
interface QualifiedArrow {
  sourceFields: string[];
  targetField: string;
  hasTransform: boolean;
  line: number;
}

/** Qualify one arrow's authored paths against the container scope it was found in. */
function qualify(arrow: ArrowEntry, scope: ContainerScope): QualifiedArrow {
  return {
    sourceFields: arrow.sourceFields.map((path) => qualifyChildArrowPath(path, scope.source)),
    targetField: qualifyChildArrowPath(arrow.targetField, scope.target),
    hasTransform: arrow.transform !== null,
    line: arrow.location.line,
  };
}

/**
 * Every qualified arrow in a mapping, including arrows nested arbitrarily deep
 * in `each`/`flatten`/`nested_arrow` blocks, plus each `nested_arrow` block's
 * own header — reconstituted as the arrow core counts it as, since the model
 * stores it as header fields rather than as an `ArrowEntry`. An `each`/
 * `flatten` header is never synthesized as an arrow: neither
 * `forEachMappingArrow` nor the layout treats a list/record container's own
 * binding as a field-to-field edge, and this walk agrees by construction — the
 * comparison in `field-edge-parity.test.ts` excludes the CLI's matching
 * `each`/`flatten` header edges for the same reason.
 */
function qualifiedArrowsOf(mapping: MappingBlock): QualifiedArrow[] {
  const arrows: QualifiedArrow[] = [];

  const headerOf = (block: NestedArrowBlock): ArrowEntry => ({
    sourceFields: [block.sourceField],
    targetField: block.targetField,
    transform: null,
    metadata: [],
    comments: [],
    location: block.location,
  });

  const visitBlocks = (
    blocks: Array<EachBlock | FlattenBlock | NestedArrowBlock>,
    outer: ContainerScope,
  ): void => {
    for (const block of blocks) {
      const scope = scopeWithin(outer, block);
      for (const arrow of block.arrows) arrows.push(qualify(arrow, scope));
      for (const nested of block.nestedArrows) arrows.push(qualify(headerOf(nested), scope));
      visitBlocks([...block.nestedEach, ...block.nestedFlatten, ...block.nestedArrows], scope);
    }
  };

  for (const arrow of mapping.arrows) arrows.push(qualify(arrow, MAPPING_BODY_SCOPE));
  for (const nested of mapping.nestedArrows) {
    arrows.push(qualify(headerOf(nested), MAPPING_BODY_SCOPE));
  }
  visitBlocks(
    [...mapping.eachBlocks, ...mapping.flattenBlocks, ...mapping.nestedArrows],
    MAPPING_BODY_SCOPE,
  );

  return arrows;
}

/** The namespace-qualified mapping index key `field-edge-source.ts`'s `arrowMappingKey` would produce. */
function mappingKey(namespace: string | null, id: string): string {
  return namespace ? `${namespace}::${id}` : id;
}

/**
 * Adapt one `VizModel` to core's `FieldEdgeSource`.
 *
 * `nlRefs` is always empty: a `VizModel` carries no resolved NL `@ref`s (the
 * LSP and the webview never resolve them), which is a documented, permitted
 * asymmetry — the same one `satsuma-viz`'s `generated-edge-completeness.test.js`
 * (sl-hi0z) already names for the layout. The comparison in
 * `field-edge-parity.test.ts` excludes the CLI's matching `nl-derived` edges.
 */
export function vizFieldEdgeSource(model: VizModel): FieldEdgeSource {
  const arrows: FieldArrowLike[] = [];
  const sides = new Map<string, FieldMappingSides>();

  const visitNamespace = (ns: NamespaceGroup): void => {
    for (const mapping of ns.mappings) {
      const key = mappingKey(ns.name, mapping.id);
      sides.set(key, { sources: mapping.sourceRefs, targets: [mapping.targetRef] });
      for (const arrow of qualifiedArrowsOf(mapping)) {
        arrows.push({
          mapping: mapping.id,
          namespace: ns.name,
          sources: arrow.sourceFields,
          target: arrow.targetField || null,
          classification: arrow.hasTransform ? "nl" : "none",
          steps: [],
          derived: false,
          file: model.uri,
          line: arrow.line,
        });
      }
    }
  };

  for (const ns of model.namespaces) visitNamespace(ns);

  return {
    arrows,
    mappingSides: (key) => sides.get(key) ?? null,
    nlRefs: [],
    resolveEndpoint: arrowEndpoint,
  };
}

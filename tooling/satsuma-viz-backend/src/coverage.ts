/**
 * coverage.ts — field coverage for an assembled VizModel, computed by core.
 *
 * The viz used to work out for itself which fields a mapping covers, by walking
 * the arrows in the VizModel. That derivation looked equivalent to core's and
 * was not: it counted declared arrows and nothing else, so it missed the
 * resolved NL `@ref` tier (ADR-036) and whole-structure conferral (ADR-037), and
 * disagreed with `satsuma coverage` on twelve of the shipped examples
 * (sl-46wr, sl-csrs). Every rule added to coverage since had to be implemented
 * twice or the card drifted. This module removes the second implementation:
 * coverage is computed here, once, by `@satsuma/core`, and travels to the client
 * inside the payload as `MappingBlock.coverage`.
 *
 * Owns: adapting an assembled model plus a workspace index to the two callbacks
 * core needs — a `CoverageSchemaResolver` and a `DefinitionLookup` for `@ref`
 * resolution — and attaching the results to the model.
 * Does not own: coverage semantics, counting, or rendering. If a figure looks
 * wrong, the bug is in core unless the schema being reported is the wrong one.
 *
 * **Schemas resolve to the model's own cards, not to the workspace index.** The
 * card is what the client renders, so counting any other field tree would put a
 * ratio next to rows it does not describe — and the model's tree is already the
 * index's, with fragment spreads materialised (sl-5nsv). Resolving against the
 * cards also means metric endpoints are covered for free: a metric is a schema
 * card as far as the detail view is concerned, and the index classifies it under
 * a different kind, which is why the LSP's index-based resolver reports nothing
 * for a mapping that writes into one.
 */

import type { Tree } from "./parser-utils";
import type { DefinitionEntry, FieldInfo, WorkspaceIndex } from "./workspace-index";
import { resolveDefinition } from "./workspace-index";
import {
  canonicalizeEntityRef,
  computeMappingCoverage,
  createCanonicalEntityRef,
  declaresRecordBody,
  extractMappings,
  extractNLRefData,
  resolveAllNLRefs,
} from "@satsuma/core";
import type {
  CanonicalEntityRef,
  CoverageField,
  CoverageSchemaDefinition,
  CoverageSchemaResolver,
  DefinitionLookup,
  ResolvedNLRef,
} from "@satsuma/core";
import type { FieldEntry, MetricCard, NamespaceGroup, SchemaCard } from "@satsuma/viz-model";

/**
 * Compute per-mapping field coverage for every mapping in `namespaces` and
 * attach it to each `MappingBlock.coverage`, in place.
 *
 * Must run **after** fragment spreads have been resolved into the cards: the
 * card's field tree is the tree coverage is judged against, and judging the
 * pre-expansion tree would report `address record { ...address_fields }` as one
 * uncovered leaf where the CLI reports the three the fragment materialises.
 *
 * A mapping core cannot resolve to any schema is left without coverage rather
 * than given an empty result — absent means "not computed", which a consumer
 * must not render as 0% (see `MappingBlock.coverage`).
 *
 * @param uri         URI of the file being modelled, used to file NL refs.
 * @param tree        Its parse tree — the authority on what the arrows say.
 * @param namespaces  The assembled namespace groups, mutated in place.
 * @param wsIndex     Import-scoped index, used only to resolve `@refs`.
 */
export function attachMappingCoverage(
  uri: string,
  tree: Tree,
  namespaces: NamespaceGroup[],
  wsIndex: WorkspaceIndex,
): void {
  const cards = indexCardsByQualifiedId(namespaces);
  const nlRefs = resolveNLRefs(uri, tree, wsIndex);

  for (const ns of namespaces) {
    // The resolver is per namespace, not per model: a reference is resolved
    // relative to where the mapping is declared, so `stg_gl_entries` written
    // inside `namespace staging` means `staging::stg_gl_entries`.
    const resolveSchema = makeCardResolver(cards, ns.name);
    for (const mapping of ns.mappings) {
      // Identified by its start row, which names the block outright. A label is
      // not an identity: two namespaces may declare `mapping load`, and matching
      // on the label alone judged the second one's schemas against the first
      // one's arrows — a plausible figure that was simply wrong. An anonymous
      // mapping has no label at all (the model calls it "unknown"), so a
      // label-based lookup found nothing and dropped its coverage entirely.
      const result = computeMappingCoverage(
        tree,
        { namespace: ns.name, row: mapping.location.line },
        resolveSchema,
        nlRefs,
      );
      if (result.schemas.length > 0) mapping.coverage = result;
    }
  }
}

// ── Schema resolution, from the model's cards ───────────────────────────────

/** Every schema and metric card in the model, keyed by its qualified id. */
function indexCardsByQualifiedId(
  namespaces: NamespaceGroup[],
): Map<string, CoverageSchemaDefinition> {
  const cards = new Map<string, CoverageSchemaDefinition>();
  for (const ns of namespaces) {
    for (const schema of ns.schemas) cards.set(schema.qualifiedId, schemaCardDef(schema));
    for (const metric of ns.metrics) cards.set(metric.qualifiedId, metricCardDef(metric));
  }
  return cards;
}

/**
 * Resolve the schema references written in a mapping's `source {}` / `target {}`
 * blocks to the field trees the client will render.
 *
 * References arrive **as authored** — core reads them off the CST, because only
 * the authored form can be matched against the schema prefix on an arrow path.
 * A bare `stg_gl_entries` written inside `namespace staging` therefore has to be
 * resolved against `mappingNamespace` first, exactly as `resolveMappingRef`
 * resolves the model's own `sourceRefs`. Resolving it namespace-blind instead
 * left every namespaced mapping's own-namespace target reporting 0%. The card
 * index is canonicalized for that step, and the fields come from the same card.
 *
 * The canonical `schemaId` reported back is the card's `qualifiedId`, so results
 * for one schema line up when a consumer rolls them up across mappings that name
 * it differently.
 */
function makeCardResolver(
  cards: Map<string, CoverageSchemaDefinition>,
  mappingNamespace: string | null,
): CoverageSchemaResolver {
  return (writtenRef): CoverageSchemaDefinition | null => {
    const canonicalRef = canonicalizeEntityRef(writtenRef, mappingNamespace, cards);
    if (!canonicalRef) return null;
    const cardKey = canonicalRef.startsWith("::") ? canonicalRef.slice(2) : canonicalRef;
    return cards.get(cardKey) ?? null;
  };
}

/** A schema card as core's coverage input: its qualified id, uri and field tree. */
function schemaCardDef(schema: SchemaCard): CoverageSchemaDefinition {
  return {
    schemaId: schema.qualifiedId,
    canonicalRef: canonicalCardRef(schema.qualifiedId),
    uri: schema.location.uri,
    fields: schema.fields.map(toCoverageField),
  };
}

/**
 * A metric card as core's coverage input.
 *
 * Metric measures are flat — a metric declares no records — so the projection
 * has no recursion to do. Metrics participate because a pipeline mapping writes
 * into one and a report mapping reads from one, and the detail view renders both
 * as schema cards; excluding them would leave those cards with no figures.
 */
function metricCardDef(metric: MetricCard): CoverageSchemaDefinition {
  return {
    schemaId: metric.qualifiedId,
    canonicalRef: canonicalCardRef(metric.qualifiedId),
    uri: metric.location.uri,
    fields: metric.fields.map((f) => ({ name: f.name, line: f.location.line })),
  };
}

/** Convert the model's qualified-id storage spelling into core's canonical form. */
function canonicalCardRef(qualifiedId: string): CanonicalEntityRef {
  return createCanonicalEntityRef(qualifiedId.includes("::") ? qualifiedId : `::${qualifiedId}`);
}

/**
 * Project a model `FieldEntry` onto core's minimal coverage field shape.
 *
 * `container` is read off the declared type, which is the only place an empty
 * `record {}` still announces itself: the model gives every field a `children`
 * array, so an empty record and a scalar are identical in that list and the
 * record was counted as data (`ccc-3vaw`). The model's type text spells the list
 * form out (`list_of record`), which `declaresRecordBody` accepts.
 */
function toCoverageField(field: FieldEntry): CoverageField {
  return {
    name: field.name,
    line: field.location.line,
    ...(declaresRecordBody(field.type) ? { container: true } : {}),
    children: field.children.map(toCoverageField),
  };
}

// ── Resolved NL @refs (ADR-036) ─────────────────────────────────────────────

/**
 * Resolve this document's NL `@refs` so core can credit the ones that name
 * declared fields.
 *
 * Scoped to this document deliberately: core consults only the refs belonging to
 * the mapping it is reporting on, and every such mapping is in this tree.
 * Schema lookups still span the workspace, via the index, because a source
 * schema is routinely declared in an imported file.
 *
 * Kept identical in shape to the LSP's adapter on purpose — the gutter and the
 * card must credit the same refs, and ADR-036 exists because coverage that
 * ignores a resolved ref reports a field as unmapped that `arrows`, `graph`,
 * `lineage` and `lint` all treat as a real hop.
 */
function resolveNLRefs(uri: string, tree: Tree, wsIndex: WorkspaceIndex): ResolvedNLRef[] {
  const items = extractNLRefData(tree.rootNode).map((item) => ({ ...item, file: uri }));
  if (items.length === 0) return [];
  return resolveAllNLRefs(items, makeDefinitionLookup(tree, wsIndex));
}

/**
 * Adapt a workspace index to core's `DefinitionLookup` (ADR-006's callback
 * pattern).
 *
 * Schemas and fragments come from the index, so an `@ref` to an imported schema
 * resolves. Mapping source/target lists are read from `tree` instead: the index
 * does not record them in that shape, and the only mappings whose context
 * matters are the ones declared here.
 *
 * Exported because the LSP's coverage adapter needs exactly this lookup over
 * exactly this index type, and two copies would let the gutter and the card
 * resolve the same prose differently.
 */
export function makeDefinitionLookup(tree: Tree, wsIndex: WorkspaceIndex): DefinitionLookup {
  const mappings = new Map<string, { sources: string[]; targets: string[] }>();
  for (const m of extractMappings(tree.rootNode)) {
    // Anonymous mappings have no label, so no ref can be filed under them.
    if (!m.name) continue;
    const key = m.namespace ? `${m.namespace}::${m.name}` : m.name;
    mappings.set(key, { sources: m.sources, targets: m.targets });
  }

  const entryOfKind = (key: string, kind: DefinitionEntryKind): DefinitionEntry | null =>
    resolveDefinition(wsIndex, key, null).find((d) => d.kind === kind) ?? null;

  // `hasSpreads: false` because the index stores each schema's fields already
  // flattened; there is no unresolved spread left for core to expand.
  const schemaLike = (key: string) => {
    const def = entryOfKind(key, "schema");
    return def ? { fields: def.fields, hasSpreads: false, namespace: def.namespace } : null;
  };

  return {
    hasSchema: (key) => schemaLike(key) !== null,
    getSchema: (key) => schemaLike(key),
    hasFragment: (key) => entryOfKind(key, "fragment") !== null,
    getFragment: (key) => {
      const def = entryOfKind(key, "fragment");
      return def ? { fields: def.fields, hasSpreads: false } : null;
    },
    hasTransform: (key) => entryOfKind(key, "transform") !== null,
    getMapping: (key) => mappings.get(key) ?? null,
    iterateSchemas: () => {
      const out: Array<[string, { fields: FieldInfo[]; hasSpreads: boolean }]> = [];
      for (const [key, entries] of wsIndex.definitions) {
        const def = entries.find((d) => d.kind === "schema");
        if (def) out.push([key, { fields: def.fields, hasSpreads: false }]);
      }
      return out;
    },
  } as DefinitionLookup;
}

/** The `kind` values a `DefinitionEntry` can carry that this module looks up. */
type DefinitionEntryKind = "schema" | "fragment" | "transform";

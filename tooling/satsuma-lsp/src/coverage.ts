/**
 * coverage.ts — LSP adapter for @satsuma/core mapping coverage.
 *
 * Coverage semantics (which declared fields a mapping covers) live in
 * `@satsuma/core/coverage`, shared with the CLI's `satsuma coverage` command
 * and the viz coverage overlay. This module's only job is to adapt the LSP's
 * `WorkspaceIndex` to the two callbacks core needs — a `CoverageSchemaResolver`
 * and a `DefinitionLookup` for NL `@ref` resolution — and to keep the
 * `(uri, tree, mappingName, wsIndex)` signature that server.ts's
 * `satsuma/mappingCoverage` request handler already calls.
 *
 * It owns nothing else: no path rules, no field walking, no counting. If coverage
 * output looks wrong, the bug is in core unless the schema being reported is the
 * wrong one — that resolution step is what lives here.
 *
 * The gutter must agree with `satsuma coverage` field for field, so it feeds core
 * the same two inputs the CLI does. Resolved `@refs` are one of them (ADR-036):
 * omitting them would show a field as unmapped in the editor that the CLI reports
 * as covered, which is the cross-consumer disagreement this whole area exists to
 * remove.
 */

import type { Tree } from "./parser-utils";
import type { DefinitionEntry, FieldInfo, WorkspaceIndex } from "./workspace-index";
import { resolveDefinition } from "./workspace-index";
import {
  computeMappingCoverage as computeCoverage,
  expandDeclaredFields,
  extractMappings,
  extractNLRefData,
  resolveAllNLRefs,
} from "@satsuma/core";
import type {
  CoverageField,
  CoverageSchemaDefinition,
  DefinitionLookup,
  FieldDecl,
  ResolvedNLRef,
  SpreadEntity,
} from "@satsuma/core";

// Re-export shared types from core so existing LSP code that imports from
// this module continues to work without import path changes.
export type {
  FieldCoverageEntry,
  SchemaCoverageResult,
  MappingCoverageResult,
} from "@satsuma/core";

import type { MappingCoverageResult } from "@satsuma/core";

/**
 * Compute per-field coverage for a named mapping in the document at `uri`.
 *
 * `uri` is not used to locate the mapping (the caller already supplies its
 * parse tree) — it is retained because the request handler passes it and
 * because a future scoped resolver may need the requesting document.
 */
export function computeMappingCoverage(
  uri: string,
  tree: Tree,
  mappingName: string,
  wsIndex: WorkspaceIndex,
): MappingCoverageResult {
  return computeCoverage(
    tree,
    mappingName,
    (schemaId) => resolveSchema(wsIndex, schemaId),
    resolveNLRefs(uri, tree, wsIndex),
  );
}

/**
 * Resolve the NL `@refs` in this document so core can credit the ones that name
 * declared fields (ADR-036).
 *
 * Scoped to this document deliberately. Core only consults refs belonging to the
 * mapping being reported, and that mapping is in this tree — so resolving the
 * whole workspace's prose on every gutter request would be work thrown away.
 * Schema lookups still span the workspace, via the index, because a source schema
 * is routinely declared in an imported file.
 */
function resolveNLRefs(uri: string, tree: Tree, wsIndex: WorkspaceIndex): ResolvedNLRef[] {
  const items = extractNLRefData(tree.rootNode).map((item) => ({ ...item, file: uri }));
  if (items.length === 0) return [];
  return resolveAllNLRefs(items, makeDefinitionLookup(tree, wsIndex));
}

/**
 * Adapt the LSP index to core's `DefinitionLookup` (ADR-006's callback pattern).
 *
 * Schemas and fragments come from the workspace index, so an `@ref` to an
 * imported schema resolves. Mapping source/target lists are read from this tree
 * instead: the index does not record them in that shape, and the only mapping
 * whose context matters is the one declared here.
 */
function makeDefinitionLookup(tree: Tree, wsIndex: WorkspaceIndex): DefinitionLookup {
  const mappings = new Map<string, { sources: string[]; targets: string[] }>();
  for (const m of extractMappings(tree.rootNode)) {
    // Anonymous mappings have no label, so no ref can be filed under them.
    if (!m.name) continue;
    const key = m.namespace ? `${m.namespace}::${m.name}` : m.name;
    mappings.set(key, { sources: m.sources, targets: m.targets });
  }

  const entryOfKind = (key: string, kind: DefinitionEntryKind) =>
    resolveDefinition(wsIndex, key, null).find((d) => d.kind === kind) ?? null;

  // `hasSpreads: false` because the LSP index stores each schema's fields
  // already flattened; there is no unresolved spread left for core to expand.
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

/**
 * Resolve a schema reference to core's coverage input shape.
 *
 * Only `kind === "schema"` definitions participate: a mapping's source/target
 * blocks may name something the index also knows as another kind, and coverage
 * is defined over declared schema fields.
 *
 * Fragment spreads are expanded first. The index records them unresolved — a
 * spread may name a fragment in a file that was not indexed yet when the schema
 * was — so this is the first point at which the whole workspace is available to
 * resolve them against. Skipping it reported `address record { ...address_fields
 * }` to the gutter as a single childless leaf, while `satsuma coverage` reported
 * the three leaves the fragment materialises (sl-5nsv).
 */
function resolveSchema(wsIndex: WorkspaceIndex, schemaId: string): CoverageSchemaDefinition | null {
  const defs = resolveDefinition(wsIndex, schemaId, null);
  const def = defs.find((d) => d.kind === "schema");
  if (!def) return null;
  return { uri: def.uri, fields: expandedFields(wsIndex, def).map(toCoverageField) };
}

/**
 * A definition's declared fields with every fragment spread inlined, nested
 * and block-level alike, applying core's rule so the gutter's field tree is the
 * one `satsuma coverage` reports on.
 */
function expandedFields(wsIndex: WorkspaceIndex, def: DefinitionEntry): FieldDecl[] {
  const spreadEntity = toSpreadEntity(def);
  const lookupFragment = (key: string): SpreadEntity | null => {
    const entry = resolveDefinition(wsIndex, key, null).find(
      (d) => d.kind === "fragment" || d.kind === "schema",
    );
    return entry ? toSpreadEntity(entry) : null;
  };
  const resolveRef = (ref: string, currentNs: string | null): string | null => {
    for (const candidate of currentNs && !ref.includes("::")
      ? [`${currentNs}::${ref}`, ref]
      : [ref])
      if (lookupFragment(candidate)) return candidate;
    return null;
  };
  return expandDeclaredFields(spreadEntity, def.namespace, resolveRef, lookupFragment);
}

/** Project a `DefinitionEntry` onto core's spread-expansion input shape. */
function toSpreadEntity(def: DefinitionEntry): SpreadEntity {
  return {
    fields: def.fields.map(toFieldDecl),
    hasSpreads: (def.spreads?.length ?? 0) > 0,
    spreads: def.spreads ?? [],
  };
}

/**
 * Project an LSP `FieldInfo` onto core's `FieldDecl`, carrying the field's own
 * unresolved spreads so nested expansion can see them.
 */
function toFieldDecl(field: FieldInfo): FieldDecl {
  return {
    name: field.name,
    type: field.type ?? "",
    startRow: field.range.start.line,
    children: field.children.map(toFieldDecl),
    hasSpreads: (field.spreads?.length ?? 0) > 0,
    spreads: field.spreads ?? [],
  };
}

/** Project a core `FieldDecl` onto core's minimal coverage field shape. */
function toCoverageField(field: FieldDecl): CoverageField {
  return {
    name: field.name,
    ...(field.startRow !== undefined ? { line: field.startRow } : {}),
    children: (field.children ?? []).map(toCoverageField),
  };
}

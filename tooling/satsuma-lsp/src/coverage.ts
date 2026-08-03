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
 * It owns nothing else: no path rules, no field walking, no counting, and no
 * longer the `DefinitionLookup` either — that is `@satsuma/viz-backend`'s, shared
 * with the viz's own coverage adapter so the gutter and the schema card cannot
 * resolve the same prose differently. If coverage output looks wrong, the bug is
 * in core unless the schema being reported is the wrong one — that resolution
 * step is what lives here.
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
import { makeDefinitionLookup } from "@satsuma/viz-backend/coverage";
import {
  computeMappingCoverage as computeCoverage,
  expandDeclaredFields,
  extractNLRefData,
  resolveAllNLRefs,
} from "@satsuma/core";
import type {
  CoverageField,
  CoverageSchemaDefinition,
  FieldDecl,
  MappingTarget,
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
 *
 * **Pass `mappingRow` whenever the caller has it** — it identifies the block
 * outright, and every caller reaching this through `satsuma/actionContext` does,
 * because that request read the row off the very node the cursor sits in. Without
 * it a label has to be matched, and a label is not unique: two namespaces may each
 * declare `mapping load`, so core matches the first-declared block and the gutter
 * reports one mapping's arrows under the other's name. That is not hypothetical —
 * it is what left the editor disagreeing with `satsuma coverage` after the CLI and
 * the viz were fixed.
 *
 * `mappingName` is still accepted alone, for a client predating the field, and is
 * split on a qualifying `ns::` when it carries one.
 */
export function computeMappingCoverage(
  uri: string,
  tree: Tree,
  mappingName: string,
  wsIndex: WorkspaceIndex,
  mappingRow?: number,
): MappingCoverageResult {
  return computeCoverage(
    tree,
    mappingTargetOf(mappingName, mappingRow),
    (schemaId, mappingNamespace) => resolveSchema(wsIndex, schemaId, mappingNamespace),
    resolveNLRefs(uri, tree, wsIndex),
  );
}

/**
 * Turn what the request supplied into the most precise target available.
 *
 * A row wins outright. Failing that, `crm::load` names one mapping; a bare `load`
 * cannot, so it is passed through as a label and matched as before. The `::` split
 * takes the *last* occurrence so a namespace containing one still resolves.
 */
function mappingTargetOf(mappingName: string, mappingRow?: number): MappingTarget {
  if (mappingRow !== undefined) return { row: mappingRow };
  const separator = mappingName.lastIndexOf("::");
  if (separator < 0) return mappingName;
  return {
    namespace: mappingName.slice(0, separator),
    name: mappingName.slice(separator + 2),
  };
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
 * Resolve a schema reference to core's coverage input shape.
 *
 * **Resolved relative to `mappingNamespace`.** A mapping inside `namespace crm`
 * normally writes `orders`, not `crm::orders`, and this passed `null` as the
 * scope — so `resolveDefinition` looked only at file scope, found nothing, and
 * core skipped the schema. Every namespaced mapping with unqualified references
 * therefore reported *no* coverage in the editor while `satsuma coverage`
 * reported it correctly: the gutter painted nothing and the status bar had no
 * figure. The namespace now comes from core, which located the mapping and so
 * already knows it.
 *
 * The canonical `schemaId` is reported back so results line up when they are
 * rolled up across mappings that name the same schema differently — a mapping in
 * `crm` writing `orders` and one outside writing `crm::orders` are the same
 * schema.
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
function resolveSchema(
  wsIndex: WorkspaceIndex,
  schemaId: string,
  mappingNamespace: string | null,
): CoverageSchemaDefinition | null {
  const defs = resolveDefinition(wsIndex, schemaId, mappingNamespace);
  const def = defs.find((d) => d.kind === "schema");
  if (!def) return null;
  const canonicalId =
    def.namespace && !schemaId.includes("::") ? `${def.namespace}::${schemaId}` : schemaId;
  return {
    schemaId: canonicalId,
    uri: def.uri,
    fields: expandedFields(wsIndex, def).map(toCoverageField),
  };
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

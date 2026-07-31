/**
 * coverage.ts — LSP adapter for @satsuma/core mapping coverage.
 *
 * Coverage semantics (which declared fields a mapping's arrows touch) live in
 * `@satsuma/core/coverage`, shared with the CLI's `satsuma coverage` command
 * and the viz coverage overlay. This module's only job is to adapt the LSP's
 * `WorkspaceIndex` to core's `CoverageSchemaResolver` and to keep the
 * `(uri, tree, mappingName, wsIndex)` signature that server.ts's
 * `satsuma/mappingCoverage` request handler already calls.
 *
 * It owns nothing else: no path rules, no field walking. If coverage output
 * looks wrong, the bug is in core unless the schema being reported is the
 * wrong one — that resolution step is what lives here.
 */

import type { Tree } from "./parser-utils";
import type { FieldInfo, WorkspaceIndex } from "./workspace-index";
import { resolveDefinition } from "./workspace-index";
import { computeMappingCoverage as computeCoverage } from "@satsuma/core";
import type { CoverageField, CoverageSchemaDefinition } from "@satsuma/core";

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
  _uri: string,
  tree: Tree,
  mappingName: string,
  wsIndex: WorkspaceIndex,
): MappingCoverageResult {
  return computeCoverage(tree, mappingName, (schemaId) => resolveSchema(wsIndex, schemaId));
}

/**
 * Resolve a schema reference to core's coverage input shape.
 *
 * Only `kind === "schema"` definitions participate: a mapping's source/target
 * blocks may name something the index also knows as another kind, and coverage
 * is defined over declared schema fields.
 */
function resolveSchema(
  wsIndex: WorkspaceIndex,
  schemaId: string,
): CoverageSchemaDefinition | null {
  const defs = resolveDefinition(wsIndex, schemaId, null);
  const def = defs.find((d) => d.kind === "schema");
  if (!def) return null;
  return { uri: def.uri, fields: def.fields.map(toCoverageField) };
}

/** Project an LSP `FieldInfo` onto core's minimal field shape. */
function toCoverageField(field: FieldInfo): CoverageField {
  return {
    name: field.name,
    line: field.range.start.line,
    children: field.children.map(toCoverageField),
  };
}

/**
 * coverage-workspace.ts — CLI bridge between ExtractedWorkspace and core coverage.
 *
 * Coverage semantics live in `@satsuma/core` (coverage.ts for the per-mapping
 * walk, coverage-rollup.ts for the aggregation). Core deliberately knows nothing
 * about the CLI's index, so something has to adapt one to the other: resolve the
 * schema references written in a mapping's `source {}` / `target {}` blocks
 * against `ExtractedWorkspace`, expand their fragment spreads, and attach
 * declaration positions. That is this module's whole job.
 *
 * Owns: ExtractedWorkspace → CoverageSchemaResolver adaptation, and the walk
 * over a workspace's mappings.
 * Does not own: coverage semantics, aggregation, or rendering.
 *
 * Two consumers share it — the `coverage` command and `fields --unmapped-by` —
 * which is the point: before sl-oqsj those two answered the same question from
 * independently maintained code.
 */

import { computeMappingCoverage } from "@satsuma/core";
import type {
  CoverageSchemaDefinition,
  CoverageSchemaResolver,
  MappingCoverageInput,
  MappingCoverageResult,
  ResolvedNLRef,
} from "@satsuma/core";
import { resolveScopedEntityRef } from "./index-builder.js";
import { expandEntityFields, expandNestedSpreads } from "./spread-expand.js";
import { toCoverageFields } from "./field-positions.js";
import type { ExtractedWorkspace, ParsedFile, SchemaRecord } from "./types.js";

/** One mapping's coverage, plus where the mapping is declared. */
export interface MappingCoverage extends MappingCoverageInput {
  /** Absolute path of the file declaring the mapping, for output and jump links. */
  file: string;
  /** Namespace the mapping is declared in, or null at file scope. */
  namespace: string | null;
}

/** Coverage for a whole workspace, with the mappings it could not report on. */
export interface WorkspaceCoverage {
  /** One entry per named mapping, in index order. */
  mappings: MappingCoverage[];
  /**
   * Anonymous mappings skipped by this pass.
   *
   * Coverage is looked up by mapping label, and an anonymous `mapping { … }`
   * block has none. Rather than drop them silently, the count is reported so
   * output can say what was not covered — a coverage report that quietly
   * ignores part of the workspace is worse than one that admits the gap.
   */
  skippedAnonymous: number;
}

/**
 * Build a resolver that turns the schema references written inside a mapping
 * into field trees, resolved from the CLI's workspace index.
 *
 * Reference resolution is namespace-aware: inside `namespace crm { … }` a
 * mapping may write `orders` for what the index keys as `crm::orders`. The
 * resolved key is reported back to core as the canonical `schemaId`, so results
 * for the same schema still line up when they are rolled up across mappings
 * that refer to it differently.
 *
 * Fragment spreads are expanded — nested record-level spreads first, then
 * schema-level ones — because a spread field is a declared field of the
 * consuming schema and its coverage is exactly what a reviewer is asking about.
 */
export function makeSchemaResolver(
  index: ExtractedWorkspace,
  mappingNamespace: string | null,
): CoverageSchemaResolver {
  return (writtenRef: string): CoverageSchemaDefinition | null => {
    const key = resolveScopedEntityRef(writtenRef, mappingNamespace, index.schemas);
    const schema = key ? index.schemas.get(key) : undefined;
    if (!key || !schema) return null;
    return {
      schemaId: key,
      uri: schema.file,
      fields: toCoverageFields(expandedFields(schema, index), {
        file: schema.file,
        row: schema.row,
      }),
    };
  };
}

/**
 * A schema's fields with fragment spreads inlined.
 *
 * Copies the field list before expanding: `expandNestedSpreads` mutates in
 * place, and the index's records are shared with every other command in the
 * process.
 */
function expandedFields(schema: SchemaRecord, index: ExtractedWorkspace) {
  const fields = deepCopyFields(schema.fields);
  expandNestedSpreads(fields, schema.namespace ?? null, index);
  return [...fields, ...expandEntityFields(schema, schema.namespace ?? null, index)];
}

/** Recursive copy so in-place spread expansion cannot touch the shared index. */
function deepCopyFields<T extends { children?: T[] }>(fields: T[]): T[] {
  return fields.map((f) =>
    f.children ? { ...f, children: deepCopyFields(f.children) } : { ...f },
  );
}

/**
 * Compute coverage for one named mapping.
 *
 * Returns null when the mapping's declaring file is not among `files` (it was
 * not loaded) or when the mapping label cannot be found in that file's tree.
 * Either case means there is nothing to report, which is distinct from a
 * mapping that covers nothing.
 *
 * `nlRefs` is the whole workspace's resolved `@refs`; core selects the ones
 * belonging to this mapping. It is a required parameter rather than an optional
 * one deliberately — omitting it silently drops the NL tier (ADR-036), which
 * under-reports every mapping whose sources appear only in prose, and a caller
 * that forgot would see a plausible-looking number rather than an error.
 */
export function coverageForMapping(
  mappingKey: string,
  index: ExtractedWorkspace,
  files: ParsedFile[],
  nlRefs: readonly ResolvedNLRef[],
): MappingCoverage | null {
  const mapping = index.mappings.get(mappingKey);
  if (!mapping?.name) return null;

  const parsed = files.find((f) => f.filePath === mapping.file);
  if (!parsed) return null;

  const namespace = mapping.namespace ?? null;
  const result: MappingCoverageResult = computeMappingCoverage(
    parsed.tree,
    mapping.name,
    makeSchemaResolver(index, namespace),
    nlRefs,
  );
  if (result.schemas.length === 0) return null;

  return { mappingId: mappingKey, file: mapping.file, namespace, result };
}

/**
 * Compute coverage for every named mapping reachable from the entry file.
 *
 * The workspace is whatever `loadWorkspace` resolved — the entry file plus its
 * transitive imports — so coverage answers "this workspace", not "this file".
 *
 * `nlRefs` is resolved once by the caller and reused for every mapping: ref
 * resolution is workspace-wide, and re-resolving per mapping would repeat the
 * whole index walk for each one.
 */
export function coverageForWorkspace(
  index: ExtractedWorkspace,
  files: ParsedFile[],
  nlRefs: readonly ResolvedNLRef[],
): WorkspaceCoverage {
  const mappings: MappingCoverage[] = [];
  let skippedAnonymous = 0;

  for (const [key, mapping] of index.mappings) {
    if (!mapping.name) {
      skippedAnonymous += 1;
      continue;
    }
    const coverage = coverageForMapping(key, index, files, nlRefs);
    if (coverage) mappings.push(coverage);
  }

  return { mappings, skippedAnonymous };
}

/**
 * The field paths of `schemaKey` that this mapping covers, in any role.
 *
 * A schema can appear on both sides of one mapping. "Does this mapping touch the
 * field?" is then the union of the two sides — the question `fields --unmapped-by`
 * has always answered — so roles are merged here rather than reported separately.
 *
 * Paths are schema-root-relative and dotted, matching `FieldCoverageEntry.path`.
 */
export function coveredFieldPaths(coverage: MappingCoverage, schemaKey: string): Set<string> {
  const covered = new Set<string>();
  for (const schema of coverage.result.schemas) {
    if (schema.schemaId !== schemaKey) continue;
    for (const field of schema.fields) {
      if (field.mapped) covered.add(field.path);
    }
  }
  return covered;
}

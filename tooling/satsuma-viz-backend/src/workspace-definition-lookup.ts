/**
 * workspace-definition-lookup.ts — adapt WorkspaceIndex to core NL resolution.
 *
 * Both VizModel assembly and field-chain construction resolve natural-language
 * `@ref`s. This module owns their one DefinitionLookup adapter so schema field
 * projection and mapping lookup semantics stay identical across both builders.
 * It also owns the one place a caller can ask "does this schema really declare
 * this field, spreads included?" over a raw `WorkspaceIndex` — field-chain's
 * focus-field existence check ({@link resolveSchemaFields}) needs the same
 * fragment-spread expansion `resolveAndStripSpreads` runs for a full VizModel,
 * without building one.
 */

import {
  expandDeclaredFields,
  fieldDeclFromRenderedType,
  makeEntityRefResolver,
} from "@satsuma/core";
import type {
  DefinitionLookup,
  FieldDecl,
  MappingSourcesTargets,
  SpreadEntity,
} from "@satsuma/core";
import type { DefinitionEntry, FieldInfo, WorkspaceIndex } from "./workspace-index";

/** Convert an indexed field tree to core's semantic field-declaration shape. */
export function fieldInfoToDecl(field: FieldInfo): FieldDecl {
  return fieldDeclFromRenderedType({
    name: field.name,
    type: field.type ?? "",
    startRow: field.range.start.line,
    children: field.children.map(fieldInfoToDecl),
    ...(field.spreads ? { spreads: field.spreads } : {}),
  });
}

/** Optional mapping-side lookup used while resolving refs inside a mapping. */
export type MappingSidesLookup = (mappingKey: string) => MappingSourcesTargets | null;

/**
 * Create core's narrow lookup over a workspace index.
 *
 * `mappingSides` is omitted while VizModel resolves one transform with an
 * explicit context. Field-chain construction supplies it because
 * `resolveAllNLRefs` obtains each ref's context by mapping key.
 */
export function createWorkspaceDefinitionLookup(
  workspace: WorkspaceIndex,
  mappingSides: MappingSidesLookup = () => null,
): DefinitionLookup {
  return {
    hasSchema: (key) =>
      workspace.definitions.get(key)?.some((definition) => definition.kind === "schema") ?? false,
    getSchema: (key) => {
      const definition = workspace.definitions
        .get(key)
        ?.find((candidate) => candidate.kind === "schema");
      if (!definition) return null;
      return { fields: definition.fields.map(fieldInfoToDecl), hasSpreads: false };
    },
    hasFragment: (key) =>
      workspace.definitions.get(key)?.some((definition) => definition.kind === "fragment") ?? false,
    getFragment: (key) => {
      const definition = workspace.definitions
        .get(key)
        ?.find((candidate) => candidate.kind === "fragment");
      if (!definition) return null;
      return { fields: definition.fields.map(fieldInfoToDecl), hasSpreads: false };
    },
    hasTransform: (key) =>
      workspace.definitions.get(key)?.some((definition) => definition.kind === "transform") ??
      false,
    getMapping: mappingSides,
    iterateSchemas: function* () {
      for (const [key, definitions] of workspace.definitions) {
        const schema = definitions.find((definition) => definition.kind === "schema");
        if (schema) yield [key, { fields: schema.fields.map(fieldInfoToDecl), hasSpreads: false }];
      }
    },
  };
}

/** Convert an indexed schema or fragment definition to core's spread-expansion input shape. */
function definitionToSpreadEntity(definition: DefinitionEntry): SpreadEntity {
  return {
    fields: definition.fields.map(fieldInfoToDecl),
    hasSpreads: (definition.spreads?.length ?? 0) > 0,
    spreads: definition.spreads ?? [],
  };
}

/**
 * The fully spread-expanded field tree `workspace` declares for `schemaKey`,
 * or null when `schemaKey` names no schema.
 *
 * Only fragments spread fields into a schema, so the entity map built here
 * covers fragment definitions alone — the same asymmetry `expandDeclaredFields`
 * itself relies on (its `lookupFragment` callback is never asked to resolve a
 * schema). Resolution is cross-file and cross-namespace because `workspace`
 * already is: a caller that wants the fields visible from one entry point's
 * import closure should pass the closure's scoped index, not the whole
 * workspace, exactly as `buildFieldChainFromWorkspace` does for everything
 * else it resolves.
 */
export function resolveSchemaFields(
  workspace: WorkspaceIndex,
  schemaKey: string,
): FieldDecl[] | null {
  const schema = workspace.definitions.get(schemaKey)?.find((d) => d.kind === "schema");
  if (!schema) return null;

  const fragments = new Map<string, SpreadEntity>();
  for (const [key, definitions] of workspace.definitions) {
    const fragment = definitions.find((d) => d.kind === "fragment");
    if (fragment) fragments.set(key, definitionToSpreadEntity(fragment));
  }

  const resolveRef = makeEntityRefResolver(fragments);
  const lookupFragment = (key: string) => fragments.get(key) ?? null;
  return expandDeclaredFields(
    definitionToSpreadEntity(schema),
    schema.namespace,
    resolveRef,
    lookupFragment,
  );
}

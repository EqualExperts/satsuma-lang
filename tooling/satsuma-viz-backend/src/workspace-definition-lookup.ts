/**
 * workspace-definition-lookup.ts — adapt WorkspaceIndex to core NL resolution.
 *
 * Both VizModel assembly and field-chain construction resolve natural-language
 * `@ref`s. This module owns their one DefinitionLookup adapter so schema field
 * projection and mapping lookup semantics stay identical across both builders.
 */

import { fieldDeclFromRenderedType } from "@satsuma/core";
import type { DefinitionLookup, FieldDecl, MappingSourcesTargets } from "@satsuma/core";
import type { FieldInfo, WorkspaceIndex } from "./workspace-index";

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

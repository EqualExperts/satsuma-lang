/**
 * arrow-field.ts — find the declared field an arrow path names.
 *
 * Go-to-definition, find-references (with the declaration) and hover all ask
 * the same question of an arrow's `src_path` / `tgt_path`: which field, in
 * which file, does this path mean? This module answers it once.
 *
 * It owns two steps:
 *  - reducing a container-resolved path (core's `resolveArrowPathInPlace`) to
 *    a path local to one of the mapping's schemas, by core's
 *    `schemaLocalSegments` rule;
 *  - walking that path through the schema's declared field tree, following
 *    fragment spreads into the fragment that declares the field.
 *
 * Find-references asks the reverse question — which arrow paths name this
 * field? — and answers it by putting every recorded arrow segment of that
 * name through the same lookup ({@link findArrowSegmentsNaming}). Definition
 * and references therefore cannot disagree about what a path means: there is
 * one rule, applied once all files are indexed (bsw-89wr).
 *
 * It does not resolve the path against its containers (core's arrow-path.ts
 * does) and it does not decide which schemas a mapping side names (the caller
 * reads them from the mapping's source/target block).
 */

import {
  createAuthoredEntityRef,
  createCanonicalEntityRef,
  schemaLocalSegments,
} from "@satsuma/core";
import type { Range } from "vscode-languageserver";
import { resolveDefinition } from "./workspace-index";
import type {
  ArrowFieldEntry,
  DefinitionEntry,
  FieldInfo,
  WorkspaceIndex,
} from "./workspace-index";

/** Separates a namespace from a name in a qualified reference (`ns::name`). */
const NAMESPACE_SEPARATOR = "::";

/** The declared field an arrow path resolves to. */
export interface ArrowFieldTarget {
  /** URI of the file that declares the field — a fragment's, when spread in. */
  uri: string;
  /** The declared field. */
  field: FieldInfo;
  /** The mapping-side schema the path belongs to, as the mapping names it. */
  schema: string;
  /**
   * That schema's definition key, `ns::name` or a bare global name — the same
   * for every spelling of the schema, so callers can key on it.
   */
  schemaKey: string;
  /** The field's path within that schema, one entry per nesting level. */
  localPath: string[];
}

/**
 * Find the declared field `resolvedSegments` names among a mapping side's
 * schemas.
 *
 * @param index            The workspace (or import-scoped) index.
 * @param sideSchemas      The schemas the mapping names on the path's side.
 * @param resolvedSegments The path made absolute against its containers; it
 *                         may lead with a schema name in a multi-schema side.
 * @param namespace        The namespace the mapping is authored in, or null.
 * @returns The first schema, in mapping order, that declares the path exactly
 *          — or null when none does. Never matches by leaf name alone: a
 *          nested `id` is not the top-level `id` (bsw-89wr).
 */
export function resolveArrowField(
  index: WorkspaceIndex,
  sideSchemas: readonly string[],
  resolvedSegments: readonly string[],
  namespace: string | null,
): ArrowFieldTarget | null {
  for (const schema of sideSchemas) {
    const others = sideSchemas.filter((s) => s !== schema).map(createAuthoredEntityRef);
    for (const def of resolveDefinition(index, schema, namespace)) {
      const localPath = schemaLocalSegments(
        resolvedSegments,
        createAuthoredEntityRef(schema),
        createCanonicalEntityRef(canonicalDefinitionKey(schema, def)),
        others,
        (name) => def.fields.some((f) => f.name === name),
      );
      if (!localPath) continue;
      const hit = findDeclaredField(index, def, localPath);
      if (hit) return { ...hit, schema, schemaKey: definitionKey(schema, def), localPath };
    }
  }
  return null;
}

/**
 * Every arrow-path segment, across the index, that names the field declared
 * at `declaration` in the file `uri`.
 *
 * Each recorded segment ending in `fieldName` is resolved by
 * {@link resolveArrowField} — the rule go-to-definition uses — and kept when
 * it lands on that declaration. So a bare `customers` inside `namespace crm`
 * and `crm::customers` outside it reach the same field, `src.id` follows the
 * shadow rule when `src` declares a field `src`, and a nested `.id` is never
 * the top-level `id`.
 *
 * @param uri         Canonical URI of the file declaring the field.
 * @param declaration Range of the field's name in its declaration.
 */
export function findArrowSegmentsNaming(
  index: WorkspaceIndex,
  fieldName: string,
  uri: string,
  declaration: Range,
): ArrowFieldEntry[] {
  return (index.arrowFields.get(fieldName) ?? []).filter((segment) => {
    const hit = resolveArrowField(
      index,
      segment.sideSchemas,
      segment.resolvedSegments,
      segment.namespace,
    );
    return hit !== null && hit.uri === uri && samePosition(hit.field.range, declaration);
  });
}

/** True when two ranges start at the same place: one declared name each. */
function samePosition(a: Range, b: Range): boolean {
  return a.start.line === b.start.line && a.start.character === b.start.character;
}

/** The `[namespace]::name` identity of a definition the mapping named `schema`. */
function canonicalDefinitionKey(schema: string, def: DefinitionEntry): string {
  return `${def.namespace ?? ""}${NAMESPACE_SEPARATOR}${bareName(schema)}`;
}

/** The index's definition key for `def`: `ns::name`, or the bare name when global. */
function definitionKey(schema: string, def: DefinitionEntry): string {
  const bare = bareName(schema);
  return def.namespace ? `${def.namespace}${NAMESPACE_SEPARATOR}${bare}` : bare;
}

/** `name` without any `ns::` qualifier. */
function bareName(schema: string): string {
  const separator = schema.lastIndexOf(NAMESPACE_SEPARATOR);
  return separator < 0 ? schema : schema.slice(separator + NAMESPACE_SEPARATOR.length);
}

/** A field found by {@link findDeclaredField}, with the file declaring it. */
interface DeclaredField {
  uri: string;
  field: FieldInfo;
}

/**
 * Walk `path` through `owner`'s field tree. A segment no declared field
 * matches is looked for in the fragments spread at that level, so a field a
 * fragment contributes resolves to its declaration in the fragment.
 */
function findDeclaredField(
  index: WorkspaceIndex,
  owner: DefinitionEntry,
  path: readonly string[],
): DeclaredField | null {
  return walkFields(index, owner.uri, owner.fields, owner.spreads ?? [], owner.namespace, path, []);
}

/**
 * One level of {@link findDeclaredField}. `visiting` holds the fragments
 * already entered on this branch, so a fragment that spreads itself stops
 * rather than recursing forever.
 */
function walkFields(
  index: WorkspaceIndex,
  uri: string,
  fields: readonly FieldInfo[],
  spreads: readonly string[],
  namespace: string | null,
  path: readonly string[],
  visiting: readonly DefinitionEntry[],
): DeclaredField | null {
  const [head, ...rest] = path;
  if (head === undefined) return null;

  const field = fields.find((f) => f.name === head);
  if (field) {
    if (rest.length === 0) return { uri, field };
    return walkFields(index, uri, field.children, field.spreads ?? [], namespace, rest, visiting);
  }

  for (const spread of spreads) {
    for (const fragment of resolveDefinition(index, spread, namespace)) {
      if (fragment.kind !== "fragment" || visiting.includes(fragment)) continue;
      const hit = walkFields(
        index,
        fragment.uri,
        fragment.fields,
        fragment.spreads ?? [],
        fragment.namespace,
        path,
        [...visiting, fragment],
      );
      if (hit) return hit;
    }
  }
  return null;
}

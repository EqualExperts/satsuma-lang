/**
 * spread-expand.ts — Fragment spread expansion for Satsuma workspaces
 *
 * Resolves fragment spreads in schemas and fragments, inlining the fragment
 * fields into the caller's field set. Handles transitive spreads, cycle
 * detection, and diamond-shaped spread graphs.
 *
 * The `EntityFieldLookup` callback decouples this module from the concrete
 * `WorkspaceIndex` type, allowing both the CLI and LSP to share this logic
 * while providing their own index implementations (ADR-005).
 */

import type { FieldDecl } from "./types.js";

// ── Public callback interface ─────────────────────────────────────────────────

/**
 * Resolve a potentially-unqualified entity name (schema or fragment) to its
 * canonical key in the index. Returns null if the name cannot be resolved.
 *
 * Implementations should:
 * 1. Return the key as-is if it already contains "::" and exists in the index.
 * 2. Try `${currentNs}::${name}` if a current namespace is provided.
 * 3. Try the unqualified name directly as a fallback.
 */
export type EntityRefResolver = (ref: string, currentNs: string | null) => string | null;

/**
 * Look up a spread entity (schema or fragment) by its resolved canonical key.
 * Returns null/undefined if not found.
 */
export type SpreadEntityLookup = (key: string) => SpreadEntity | null | undefined;

export interface SpreadEntity {
  fields: FieldDecl[];
  hasSpreads: boolean;
  spreads?: string[];
  /** Source file path for diagnostic messages */
  file?: string;
  /** Start row for diagnostic messages */
  row?: number;
}

export interface ExpandedField extends FieldDecl {
  fromFragment?: string;
}

export interface SpreadDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: string;
  rule: string;
  message: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Recursively collect all valid dotted field paths from a field tree.
 */
export function collectFieldPaths(fields: FieldDecl[], prefix: string, paths: Set<string>): void {
  for (const f of fields) {
    const fullPath = prefix + f.name;
    paths.add(fullPath);
    if (f.children && f.children.length > 0) {
      collectFieldPaths(f.children, fullPath + ".", paths);
    }
  }
}

/**
 * Expand fragment spreads for a set of schema keys, inlining fragment fields
 * into `fieldPaths`. Returns true if any spread targeted an unresolvable
 * fragment (the caller decides whether to surface this as a diagnostic).
 *
 * Why this is its own pass (rather than happening at parse time):
 *  - Spreads cross file boundaries, so we cannot resolve them until the
 *    workspace index is built and every fragment is registered.
 *  - Spreads can be transitive (fragment A spreads fragment B which spreads
 *    fragment C) and can form diamond shapes (two fragments spread the same
 *    third fragment). Both are resolved here via the recursive
 *    `expandEntitySpreads` walker, with cycle protection through `visited`.
 *  - Schemas can also contain *nested* record-level spreads (a record-typed
 *    field whose body uses `...Frag`). Those are walked separately by
 *    `expandNestedFieldPaths` so the fully-qualified dotted paths
 *    (`address.street`, etc.) end up in `fieldPaths`.
 *
 * `lookupSchema` is optional because some callers (e.g. fragment-only
 * expansions) operate over a fragment-only index; when omitted we simply
 * skip the schema lookup and only handle the records the caller passed in.
 */
export function expandSpreads(
  schemaKeys: string[],
  currentNs: string | null,
  resolveRef: EntityRefResolver,
  lookupFragment: SpreadEntityLookup,
  fieldPaths: Set<string>,
  diagnostics: SpreadDiagnostic[] = [],
  lookupSchema?: SpreadEntityLookup,
): boolean {
  let hasUnresolved = false;
  const visited = new Set<string>();

  for (const key of schemaKeys) {
    const schema = lookupSchema ? lookupSchema(key) : null;
    if (!schema?.hasSpreads) continue;
    if (
      !expandEntitySpreads(
        schema,
        currentNs,
        resolveRef,
        lookupFragment,
        fieldPaths,
        visited,
        diagnostics,
        [],
      )
    ) {
      hasUnresolved = true;
    }
    // Also expand nested record-level spreads into fieldPaths
    expandNestedFieldPaths(schema.fields, "", currentNs, resolveRef, lookupFragment, fieldPaths);
  }
  return hasUnresolved;
}

/**
 * Walk the field tree and expand nested record-level spreads into the
 * fieldPaths set with proper prefixing.
 */
function expandNestedFieldPaths(
  fields: FieldDecl[],
  prefix: string,
  currentNs: string | null,
  resolveRef: EntityRefResolver,
  lookupFragment: SpreadEntityLookup,
  fieldPaths: Set<string>,
): void {
  for (const field of fields) {
    if (field.children && field.hasSpreads && field.spreads) {
      const fieldPrefix = prefix + field.name + ".";
      for (const spreadName of field.spreads) {
        const resolvedKey = resolveRef(spreadName, currentNs);
        if (!resolvedKey) continue;
        const fragment = lookupFragment(resolvedKey);
        if (!fragment) continue;
        collectFieldPaths(fragment.fields, fieldPrefix, fieldPaths);
      }
    }
    if (field.children) {
      expandNestedFieldPaths(
        field.children,
        prefix + field.name + ".",
        currentNs,
        resolveRef,
        lookupFragment,
        fieldPaths,
      );
    }
  }
}

/**
 * Expand fragment spreads for a single entity (schema or fragment), returning
 * *only the fields the spreads contribute* — the caller already has the ones
 * the body wrote out, and concatenates the two.
 *
 * **Rule: a spread contributes only names the body has not already declared.**
 * An explicit declaration shadows a same-named field reached through a spread,
 * and the first spread to contribute a name shadows any later one. A shadowed
 * field is not returned at all, so `[...entity.fields, ...expandEntityFields()]`
 * holds each name exactly once.
 *
 * This is what makes the concatenation safe (sl-qead). Emitting the shadowed
 * copy too put the same field in a schema twice: `sat_contact_details` declares
 * `load_ts` and spreads `...standard_metadata`, which declares it again, and
 * coverage counted eleven leaves in a ten-leaf schema — the duplicate landing in
 * both numerator and denominator, so the percentage moved with how many times a
 * name happened to be written. ADR-035 makes the qualified path a coverage
 * entry's identity, so two entries sharing one path is a contract violation on
 * its own terms.
 *
 * Shadowing is whole-field: a record shadowed by an explicit record keeps the
 * explicit body, and the fragment's version of its children is not merged in.
 * See "Fragment spreads" in the v2 spec.
 */
export function expandEntityFields(
  entity: SpreadEntity | null | undefined,
  currentNs: string | null,
  resolveRef: EntityRefResolver,
  lookupFragment: SpreadEntityLookup,
): ExpandedField[] {
  const expandedFields: ExpandedField[] = [];
  if (!entity?.hasSpreads) return expandedFields;

  const visited = new Set<string>();
  // Seeded with what the body declares, so those names win over any spread.
  const declared = new Set((entity.fields ?? []).map((f) => f.name));
  collectExpandedFields(
    entity,
    currentNs,
    resolveRef,
    lookupFragment,
    expandedFields,
    visited,
    [],
    declared,
  );
  return expandedFields;
}

/**
 * Recursively collect expanded field objects from fragment spreads.
 *
 * `declared` carries the names already spoken for — the entity's own fields
 * plus everything collected so far — and grows as fields are taken, which is
 * how nearer declarations shadow further ones through transitive spreads.
 */
function collectExpandedFields(
  entity: SpreadEntity,
  currentNs: string | null,
  resolveRef: EntityRefResolver,
  lookupFragment: SpreadEntityLookup,
  fields: ExpandedField[],
  visited: Set<string>,
  chain: string[],
  declared: Set<string>,
): void {
  const spreads = entity.spreads ?? [];
  if (spreads.length === 0) return;

  const ancestors = new Set(chain);
  for (const spreadName of spreads) {
    const resolvedKey = resolveRef(spreadName, currentNs);
    if (!resolvedKey) continue;
    if (ancestors.has(resolvedKey)) continue; // cycle
    if (visited.has(resolvedKey)) continue; // diamond
    visited.add(resolvedKey);

    const fragment = lookupFragment(resolvedKey);
    if (!fragment) continue;

    for (const f of fragment.fields) {
      if (declared.has(f.name)) continue; // shadowed by the body or an earlier spread
      declared.add(f.name);
      fields.push({ ...f, fromFragment: resolvedKey });
    }

    if (fragment.hasSpreads) {
      collectExpandedFields(
        fragment,
        currentNs,
        resolveRef,
        lookupFragment,
        fields,
        visited,
        [...chain, resolvedKey],
        declared,
      );
    }
  }
}

/**
 * Recursively expand fragment spreads within nested record fields.
 * Modifies field children in place, inserting fragment fields into the
 * correct nesting level rather than hoisting to the schema level.
 */
export function expandNestedSpreads(
  fields: FieldDecl[],
  currentNs: string | null,
  resolveRef: EntityRefResolver,
  lookupFragment: SpreadEntityLookup,
): void {
  for (const field of fields) {
    if (field.children) {
      // First recurse into deeper levels
      expandNestedSpreads(field.children, currentNs, resolveRef, lookupFragment);
      // Then expand spreads at this level
      if (field.hasSpreads && field.spreads) {
        const expanded = expandEntityFields(
          { fields: field.children, hasSpreads: true, spreads: field.spreads },
          currentNs,
          resolveRef,
          lookupFragment,
        );
        field.children = [...field.children, ...expanded];
        delete field.hasSpreads;
        delete field.spreads;
      }
    }
  }
}

/**
 * Every field a schema declares once its fragment spreads are inlined —
 * the complete answer to "what fields does this schema have?".
 *
 * Spreads are an authoring shorthand: `...address_fields` inside a record body
 * declares that record's fields as surely as writing them out. Any consumer
 * reporting on declared fields — coverage, the editor gutter, the viz card —
 * must therefore see through them, and must see through *both* forms:
 *
 *  - **nested**, inside a record body (`address record { ...address_fields }`),
 *    which contributes `address.street`;
 *  - **schema-level**, in the schema body itself, which contributes top-level
 *    fields appended after the ones written out.
 *
 * Doing one and not the other is the failure this function exists to prevent
 * (sl-5nsv): the CLI expanded both and reported `customer` at 2/5, the LSP
 * expanded neither and reported the same schema at 1/3 with `address` as a
 * childless leaf, and the viz expanded only the schema-level form. Three
 * numbers, one file. Consumers now call this rather than sequencing the two
 * passes themselves.
 *
 * Each name appears once at each level: a field the body declares shadows a
 * same-named field from a spread, so the returned tree yields no duplicate
 * dotted paths. `expandEntityFields` owns that rule and explains why.
 *
 * The input is never mutated — `expandNestedSpreads` works in place, and index
 * records are shared with every other command in the process, so the field tree
 * is deep-copied first.
 */
export function expandDeclaredFields(
  entity: SpreadEntity | null | undefined,
  currentNs: string | null,
  resolveRef: EntityRefResolver,
  lookupFragment: SpreadEntityLookup,
): FieldDecl[] {
  if (!entity) return [];
  const fields = deepCopyFields(entity.fields);
  expandNestedSpreads(fields, currentNs, resolveRef, lookupFragment);
  return [...fields, ...expandEntityFields(entity, currentNs, resolveRef, lookupFragment)];
}

/** Recursive copy, so in-place nested expansion cannot touch a shared index. */
function deepCopyFields<T extends { children?: T[] }>(fields: T[]): T[] {
  return fields.map((f) =>
    f.children ? { ...f, children: deepCopyFields(f.children) } : { ...f },
  );
}

/**
 * Namespace-aware entity reference resolver. This is the standard
 * implementation suitable for use with any `Map<string, unknown>` entity index.
 *
 * Resolution order:
 * 1. Fully-qualified ref (contains "::") — check directly in map.
 * 2. Namespace-qualified: `${currentNs}::${ref}` — check if map has it.
 * 3. Unqualified fallback: check map for the bare ref.
 */
export function makeEntityRefResolver(entityMap: Map<string, unknown>): EntityRefResolver {
  return (ref: string, currentNs: string | null): string | null => {
    if (ref.includes("::")) {
      return entityMap.has(ref) ? ref : null;
    }
    if (currentNs) {
      const nsKey = `${currentNs}::${ref}`;
      if (entityMap.has(nsKey)) return nsKey;
    }
    if (entityMap.has(ref)) return ref;
    return null;
  };
}

// ── Internal helper ───────────────────────────────────────────────────────────

/**
 * Recursively expand spreads for a schema or fragment, adding fragment fields
 * to the fieldPaths set. Detects cycles and emits diagnostics for them.
 */
function expandEntitySpreads(
  entity: SpreadEntity,
  currentNs: string | null,
  resolveRef: EntityRefResolver,
  lookupFragment: SpreadEntityLookup,
  fieldPaths: Set<string>,
  expanded: Set<string>,
  diagnostics: SpreadDiagnostic[],
  chain: string[],
): boolean {
  const spreads = entity.spreads ?? [];
  if (spreads.length === 0 && entity.hasSpreads) return false;
  const ancestors = new Set(chain);
  let allResolved = true;
  for (const spreadName of spreads) {
    const resolvedKey = resolveRef(spreadName, currentNs);
    if (!resolvedKey) {
      allResolved = false;
      continue;
    }
    if (ancestors.has(resolvedKey)) {
      const cycleStart = chain.indexOf(resolvedKey);
      const cyclePath = [...chain.slice(cycleStart), resolvedKey];
      diagnostics.push({
        file: entity.file ?? "unknown",
        line: entity.row != null ? entity.row + 1 : 1,
        column: 1,
        severity: "error",
        rule: "circular-spread",
        message: `Circular fragment spread detected: ${cyclePath.join(" → ")}`,
      });
      continue;
    }
    if (expanded.has(resolvedKey)) continue;
    expanded.add(resolvedKey);
    const fragment = lookupFragment(resolvedKey);
    if (!fragment) {
      allResolved = false;
      continue;
    }
    collectFieldPaths(fragment.fields, "", fieldPaths);
    if (fragment.hasSpreads) {
      if (
        !expandEntitySpreads(
          fragment,
          currentNs,
          resolveRef,
          lookupFragment,
          fieldPaths,
          expanded,
          diagnostics,
          [...chain, resolvedKey],
        )
      ) {
        allResolved = false;
      }
    }
  }
  return allResolved;
}

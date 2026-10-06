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

export type ExpandedField = FieldDecl & {
  /** Canonical fragment key that contributed this expanded field. */
  fromFragment?: string;
};

/** One `...Frag` written inside a record body, as `collectNestedSpreads` finds it. */
export interface NestedSpread {
  /** Dotted path of the record whose body holds the spread, e.g. `address` or `order.lines`. */
  recordPath: string;
  /** The fragment reference as authored, unresolved. */
  spread: string;
  /** 0-based row of the record's declaration, when the field carries one; for diagnostics. */
  row?: number;
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
 *    field whose body uses `...Frag`). Those resolve exactly like top-level
 *    ones, under the record's dotted prefix (`address.street`), and count
 *    towards the returned flag the same way (bsw-xivc).
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
    if (!schema) continue;
    const walk: SpreadWalk = { currentNs, resolveRef, lookupFragment, fieldPaths, diagnostics };
    if (!expandEntitySpreads(schema, "", walk, visited, [])) hasUnresolved = true;
  }
  return hasUnresolved;
}

/**
 * Every spread written inside a record body anywhere in `fields`, with the
 * record's dotted path — the nested counterpart of an entity's `spreads` list.
 * Extraction stores a nested spread on its record field rather than on the
 * owning schema, so any check over "the spreads this schema uses" must walk
 * the tree to see them (bsw-xivc). Fields contributed by a spread are not
 * included; those belong to the fragment and are checked there.
 */
export function collectNestedSpreads(fields: FieldDecl[], prefix = ""): NestedSpread[] {
  const found: NestedSpread[] = [];
  for (const field of fields) {
    if (!field.children) continue;
    const recordPath = prefix + field.name;
    for (const spread of field.spreads ?? []) {
      found.push({ recordPath, spread, row: field.startRow });
    }
    found.push(...collectNestedSpreads(field.children, recordPath + "."));
  }
  return found;
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
  const declared = new Set(entity.fields.map((f) => f.name));
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
 * What stays fixed across one `expandSpreads` walk: how to resolve and fetch
 * fragments, and where paths and diagnostics go. Bundled so the recursive
 * walkers below take only what varies — the entity, its prefix, the scope.
 */
interface SpreadWalk {
  currentNs: string | null;
  resolveRef: EntityRefResolver;
  lookupFragment: SpreadEntityLookup;
  /** Receives every dotted path a spread contributes, prefixed by its record. */
  fieldPaths: Set<string>;
  /** Receives circular-spread errors. */
  diagnostics: SpreadDiagnostic[];
}

/**
 * Expand an entity's spreads — top-level and nested — into `walk.fieldPaths`,
 * each under `prefix`. Returns false if any spread, at any depth, names a
 * fragment that cannot be found: the entity's field list is then incomplete.
 *
 * `expanded` is the diamond guard for one field scope (a fragment spread twice
 * into the same record contributes once); a nested record opens a fresh scope,
 * because the same fragment under a different prefix contributes different
 * paths. `chain` is the path of fragments being expanded, and stops a fragment
 * that reaches itself — at the top level or from inside a record — with a
 * circular-spread error rather than an endless walk.
 */
function expandEntitySpreads(
  entity: SpreadEntity,
  prefix: string,
  walk: SpreadWalk,
  expanded: Set<string>,
  chain: string[],
): boolean {
  let allResolved = expandRecordSpreads(entity, prefix, walk, chain);
  const ancestors = new Set(chain);
  for (const spreadName of entity.spreads ?? []) {
    const resolvedKey = walk.resolveRef(spreadName, walk.currentNs);
    if (!resolvedKey) {
      allResolved = false;
      continue;
    }
    if (ancestors.has(resolvedKey)) {
      const cycleStart = chain.indexOf(resolvedKey);
      const cyclePath = [...chain.slice(cycleStart), resolvedKey];
      walk.diagnostics.push({
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
    const fragment = walk.lookupFragment(resolvedKey);
    if (!fragment) {
      allResolved = false;
      continue;
    }
    collectFieldPaths(fragment.fields, prefix, walk.fieldPaths);
    // Walked whether or not `hasSpreads` is set: adapters differ on whether a
    // nested spread sets it (extraction does; the LSP and viz adapters set it
    // from top-level spreads only), and an entity with no spreads costs nothing.
    if (!expandEntitySpreads(fragment, prefix, walk, expanded, [...chain, resolvedKey])) {
      allResolved = false;
    }
  }
  return allResolved;
}

/**
 * Walk a field tree and expand the spreads written inside its record bodies,
 * each under that record's dotted path. A record's body is treated as an
 * entity of its own — its children plus its spread list — so nested spreads
 * resolve, recurse and fail exactly as top-level ones do. A record has no
 * declaration site of its own in `SpreadEntity` terms, so diagnostics raised
 * inside it point at the entity that owns it. Returns false if any nested
 * spread is unresolved.
 */
function expandRecordSpreads(
  owner: SpreadEntity,
  prefix: string,
  walk: SpreadWalk,
  chain: string[],
): boolean {
  let allResolved = true;
  for (const field of owner.fields) {
    if (!field.children) continue;
    const record: SpreadEntity = {
      fields: field.children,
      hasSpreads: (field.spreads ?? []).length > 0,
      spreads: field.spreads ?? [],
      file: owner.file,
      row: owner.row,
    };
    if (!expandEntitySpreads(record, prefix + field.name + ".", walk, new Set(), chain)) {
      allResolved = false;
    }
  }
  return allResolved;
}

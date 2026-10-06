/**
 * reference-stages.ts — Nominal stages for field paths and entity references.
 *
 * Owns the runtime-erased vocabulary that separates authored text from values
 * which have passed container qualification, schema localization, or workspace
 * canonicalization. It also owns the canonical endpoint spelling in both
 * directions — composing an endpoint from a schema and a path, and taking it
 * back apart — so no consumer has to re-derive an owning schema from a string.
 *
 * It does not resolve schemas or decide coverage: callers supply workspace
 * identity, `canonical-ref.ts` decides which schema an authored arrow token
 * belongs to, and the coverage modules consume the resulting stage types.
 */

import type { ArrowPathAnchor } from "./arrow-path.js";

// This symbol is deliberately module-private. Consumers can obtain branded
// values only from the validating constructors and semantic transitions below.
declare const referenceStage: unique symbol;

// ── Canonical spelling ───────────────────────────────────────────────────────
// The two separators that make up canonical identity. Named because this module
// both composes and decomposes that spelling, and a stray literal in either
// direction is a silent identity bug rather than a compile error.

/** Divides a namespace from an entity name. Empty namespace means global scope. */
export const NAMESPACE_SEPARATOR = "::";

/** Divides path segments inside one schema. */
export const PATH_SEPARATOR = ".";

/** A string whose semantic normalization stage is tracked by TypeScript. */
type ReferenceAt<Stage extends string> = string & { readonly [referenceStage]: Stage };

/** Field expression exactly as authored on an arrow. */
export type AuthoredFieldRef = ReferenceAt<"authored-field-ref">;

/** Field expression made absolute against all enclosing mapping containers. */
export type ContainerQualifiedFieldRef = ReferenceAt<"container-qualified-field-ref">;

/** Dotted path relative to one declared schema root. */
export type SchemaLocalPath = ReferenceAt<"schema-local-path">;

/** Entity reference exactly as authored in a source, target, or spread. */
export type AuthoredEntityRef = ReferenceAt<"authored-entity-ref">;

/** Unique workspace entity id, including `::` for the global namespace. */
export type CanonicalEntityRef = ReferenceAt<"canonical-entity-ref">;

/**
 * Unique workspace identity of one arrow endpoint: a {@link CanonicalEntityRef}
 * for the owning schema, optionally followed by a path into that schema's
 * fields (`crm::customers.address.city`).
 *
 * This is the last stage in the field family and the spelling `graph`,
 * `lineage` and `field-lineage` emit. It differs from
 * {@link ContainerQualifiedFieldRef} in naming its owning schema, and from
 * {@link SchemaLocalPath} in not being relative to anything.
 */
export type CanonicalFieldEndpoint = ReferenceAt<"canonical-field-endpoint">;

/**
 * Validate and brand one external string at a semantic boundary.
 *
 * Extraction removes backticks before values reach core models. Consequently,
 * punctuation, dots, namespace separators, and whitespace may all be literal
 * identifier content and cannot be rejected here. The one representation that
 * no valid Satsuma name or path can produce is the empty string.
 *
 * This is the module's sole unsafe assertion. Brands have no runtime
 * representation, so after validation TypeScript must be told that the plain
 * string carries the stage tracked by the return type.
 */
function validatedReference<Reference extends string>(value: string, stageName: string): Reference {
  if (value.length === 0) {
    throw new TypeError(`${stageName} must not be empty`);
  }
  return value as Reference;
}

/** Validate a field expression entering the typed domain from authored data. */
export function createAuthoredFieldRef(value: string): AuthoredFieldRef {
  return validatedReference<AuthoredFieldRef>(value, "Authored field reference");
}

/** Validate an already container-qualified field expression at a boundary. */
export function createContainerQualifiedFieldRef(value: string): ContainerQualifiedFieldRef {
  return validatedReference<ContainerQualifiedFieldRef>(
    value,
    "Container-qualified field reference",
  );
}

/** Validate a dotted path known to be relative to one schema. */
export function createSchemaLocalPath(value: string): SchemaLocalPath {
  return validatedReference<SchemaLocalPath>(value, "Schema-local path");
}

/** Validate an entity name entering the typed domain from authored data. */
export function createAuthoredEntityRef(value: string): AuthoredEntityRef {
  return validatedReference<AuthoredEntityRef>(value, "Authored entity reference");
}

/**
 * Validate a unique workspace entity id.
 *
 * Canonical ids always include the namespace separator. A global entity uses
 * an empty namespace (`::customers`); a namespaced one uses its declared
 * namespace (`crm::customers`).
 */
export function createCanonicalEntityRef(value: string): CanonicalEntityRef {
  if (canonicalNameOf(value).length === 0) {
    throw new TypeError("Canonical entity reference must have [namespace]::name form");
  }
  return validatedReference<CanonicalEntityRef>(value, "Canonical entity reference");
}

/**
 * The entity-name portion of a canonical spelling, or the empty string when the
 * value has no namespace separator at all.
 *
 * Shared by the entity and endpoint constructors so both agree on what makes a
 * canonical value well-formed. For an endpoint the result still carries the
 * field path; callers that need the name alone stop at the first
 * {@link PATH_SEPARATOR}.
 */
function canonicalNameOf(value: string): string {
  const separator = value.indexOf(NAMESPACE_SEPARATOR);
  if (separator < 0) return "";
  return value.slice(separator + NAMESPACE_SEPARATOR.length);
}

// ── Field endpoints ──────────────────────────────────────────────────────────

/**
 * Validate a canonical field endpoint arriving from a serialized boundary.
 *
 * Endpoints travel as plain strings in JSON, VizModel and LSP payloads, so a
 * consumer that needs the typed form re-enters the domain here rather than
 * asserting. The shape rule is the entity rule plus one relaxation: a path may
 * follow the schema name, and may also be absent — an endpoint is allowed to
 * name a schema root.
 */
export function createCanonicalFieldEndpoint(value: string): CanonicalFieldEndpoint {
  const name = canonicalNameOf(value);
  if (name.length === 0 || name.startsWith(PATH_SEPARATOR)) {
    throw new TypeError("Canonical field endpoint must have [namespace]::schema[.path] form");
  }
  return validatedReference<CanonicalFieldEndpoint>(value, "Canonical field endpoint");
}

/**
 * Compose the endpoint identity of one field within one schema.
 *
 * Passing `null` for the path yields the schema root, which is a legal endpoint
 * spelling; whether any *authored* form should resolve to it is a separate and
 * still-open question (`r0-7w76`).
 */
export function fieldEndpointOf(
  schema: CanonicalEntityRef,
  path: SchemaLocalPath | null,
): CanonicalFieldEndpoint {
  const spelling = path === null ? schema : `${schema}${PATH_SEPARATOR}${path}`;
  return createCanonicalFieldEndpoint(spelling);
}

/**
 * The schema that owns an endpoint.
 *
 * This is the named accessor that replaces splitting an endpoint string on its
 * first dot at each consumer (`sl-jyee`). Decomposition lives beside
 * {@link fieldEndpointOf} so one module owns the spelling in both directions.
 */
export function fieldEndpointSchema(endpoint: CanonicalFieldEndpoint): CanonicalEntityRef {
  const pathStart = endpointPathStart(endpoint);
  return createCanonicalEntityRef(pathStart < 0 ? endpoint : endpoint.slice(0, pathStart));
}

/** The endpoint's path within its owning schema, or null when it names the root. */
export function fieldEndpointPath(endpoint: CanonicalFieldEndpoint): SchemaLocalPath | null {
  const pathStart = endpointPathStart(endpoint);
  if (pathStart < 0) return null;
  return createSchemaLocalPath(endpoint.slice(pathStart + PATH_SEPARATOR.length));
}

/**
 * Offset of the separator between an endpoint's schema and its path, or -1.
 *
 * The search starts after the namespace separator so that a namespace can never
 * be mistaken for the start of a field path.
 */
function endpointPathStart(endpoint: CanonicalFieldEndpoint): number {
  const separator = endpoint.indexOf(NAMESPACE_SEPARATOR);
  return endpoint.indexOf(PATH_SEPARATOR, separator + NAMESPACE_SEPARATOR.length);
}

// ── Container-relative path resolution (ADR-053) ─────────────────────────────
//
// The three path-prefix semantics an authored arrow path can carry, in one
// place. Every consumer that qualifies a nested arrow calls this — extraction's
// `qualifyChildArrowPath`, NL-ref target qualification, and the branded
// transition below — so the rule cannot drift across the four consumers
// (extraction, coverage, lineage, viz) that rely on it.

/** Root escape prefix: resolve absolute from the schema root, container ignored. */
const ROOT_ESCAPE = "$.";
/** Parent escape prefix: one occurrence pops one segment off the container. */
const PARENT_ESCAPE = "^.";

/** Strip the authored leading-dot relativity marker (spec §4.4). */
function stripRelativityMarker(path: string): string {
  return path.replace(/^\./, "");
}

/**
 * An enclosing container's absolute path as its segments, one per nesting
 * level, each unquoted.
 *
 * A segment may itself contain a `.` — `` `line.items` `` is one field — so a
 * container must travel as segments, not as joined text: re-splitting
 * "line.items" would count it as two levels and make `^.` pop half a name
 * (bsw-2yzd). A plain string container is still accepted where no CST is to
 * hand, and is split on `.`, which is exact whenever no segment holds a dot.
 */
export type ContainerSegments = readonly string[];

/** Normalise either container form to segments; see {@link ContainerSegments}. */
function containerSegmentsOf(
  container: string | ContainerSegments | null,
): ContainerSegments | null {
  // An empty string is "no container", as it always was for the text form.
  if (!container) return null;
  return typeof container === "string" ? container.split(PATH_SEPARATOR) : container;
}

/**
 * Resolve a path's segments against the segments of its container — the
 * segment form of the ADR-053 rule, and the one extraction uses because it
 * reads both sides from the CST.
 *
 *  - `root` (`$.`): the container is ignored.
 *  - `parent` (`^.` × levels): that many trailing container segments are
 *    dropped; popping past the root leaves the schema root.
 *  - `plain` / `relative` (`field`, `.field`): the container is prefixed.
 *
 * No segment is split or joined, so a dotted segment on either side stays one
 * level and the result can serve as the next container down.
 *
 * @param anchor    The path's structural prefix (arrow-path.ts).
 * @param segments  The path's own segments, unquoted, without any prefix.
 * @param container The container's segments, or null at mapping-body level.
 * @returns The schema-root-relative segments.
 */
export function resolvePathSegmentsAgainstContainer(
  anchor: ArrowPathAnchor,
  segments: readonly string[],
  container: ContainerSegments | null,
): string[] {
  if (anchor.kind === "root" || !container) return [...segments];
  if (anchor.kind === "parent") {
    const kept = container.slice(0, Math.max(0, container.length - anchor.levels));
    return [...kept, ...segments];
  }
  return [...container, ...segments];
}

/**
 * Resolve an authored arrow path string against the container it was written
 * inside: the text form of {@link resolvePathSegmentsAgainstContainer}.
 *
 * Applies the three path-prefix semantics from ADR-053:
 *
 *  - `$.field`  — root escape: enclosing containers are ignored; the path is
 *    taken absolute from the schema root.
 *  - `^.field`  — parent escape: each `^.` pops one level off the container
 *    before the field is appended. `^.^.field` pops two; popping past the
 *    root resolves root-relative.
 *  - `.field` or `field` — the original prefixing rule: the container path is
 *    prefixed and the leading relativity dot is stripped.
 *
 * The escapes are additive: a path either carries one or it does not, and they
 * never interact with the relativity marker, so the existing dot semantics are
 * untouched. The authored text after the prefix is appended whole, never
 * split, so only the container's level boundaries matter — pass the container
 * as segments when one of them may contain a dot.
 *
 * @param path      Path as authored, with or without an escape / relativity
 *                  marker. An empty path stays empty.
 * @param container The enclosing container, as segments or as dotted text, or
 *                  null at mapping-body level, where the mapping root is the
 *                  frame.
 * @returns The path relative to the schema root, never carrying an escape or
 *          relativity marker.
 */
export function resolveAuthoredPathAgainstContainer(
  path: string,
  container: string | ContainerSegments | null,
): string {
  if (!path) return path;
  const { anchor, rest } = splitAuthoredPrefix(path);
  return resolvePathSegmentsAgainstContainer(anchor, [rest], containerSegmentsOf(container)).join(
    PATH_SEPARATOR,
  );
}

/** Separate an authored path's ADR-053 / §4.4 prefix from the text after it. */
function splitAuthoredPrefix(path: string): { anchor: ArrowPathAnchor; rest: string } {
  if (path.startsWith(ROOT_ESCAPE)) {
    return {
      anchor: { kind: "root" },
      rest: stripRelativityMarker(path.slice(ROOT_ESCAPE.length)),
    };
  }
  if (path.startsWith(PARENT_ESCAPE)) {
    let rest = path;
    let levels = 0;
    while (rest.startsWith(PARENT_ESCAPE)) {
      levels += 1;
      rest = rest.slice(PARENT_ESCAPE.length);
    }
    return { anchor: { kind: "parent", levels }, rest: stripRelativityMarker(rest) };
  }
  return { anchor: { kind: "plain" }, rest: stripRelativityMarker(path) };
}

/**
 * How to reach, with an escape prefix, a field an authored path names at an
 * enclosing level rather than under its container.
 */
export interface AncestorEscape {
  /** The schema-root path the authored text names at an enclosing level. */
  resolved: string;
  /** The shortest `^.` spelling, or null when only `$.` reaches it. */
  parentEscape: string | null;
  /** The `$.` spelling, absolute from the schema root. */
  rootEscape: string;
}

/**
 * Explain a container-relative path that resolved to nothing (sl-i9ve, #525).
 *
 * Inside `flatten Order.LineItems`, the author of `Order.OrderId` almost
 * always meant the order's field, but §4.4 resolves it under the container as
 * `Order.LineItems.Order.OrderId`. This tries the authored text one enclosing
 * level at a time, nearest first, and returns the escape-prefixed spellings
 * that would reach the first level where `exists` accepts it.
 *
 * @param path      Path as authored. One that already carries an escape prefix
 *                  gets no suggestion: its author has already chosen a level.
 * @param container The container the authored path was resolved against, as
 *                  segments (exact) or dotted text (split on `.`).
 * @param exists    Whether a schema-root path names a declared field.
 * @returns null when there is no container, the container is itself
 *          undeclared (that is the real fault, reported on the container's own
 *          arrow — moving the child would mislead), or no enclosing level
 *          declares the path.
 */
export function findAncestorEscape(
  path: string,
  container: string | ContainerSegments | null,
  exists: (rootPath: string) => boolean,
): AncestorEscape | null {
  const containerSegments = containerSegmentsOf(container);
  if (
    !path ||
    !containerSegments ||
    path.startsWith(ROOT_ESCAPE) ||
    path.startsWith(PARENT_ESCAPE)
  ) {
    return null;
  }
  if (!exists(containerSegments.join(PATH_SEPARATOR))) return null;
  const relative = stripRelativityMarker(path);
  for (let levels = 1; levels <= containerSegments.length; levels++) {
    const ancestor = containerSegments.slice(0, containerSegments.length - levels);
    const resolved = [...ancestor, relative].join(PATH_SEPARATOR);
    if (exists(resolved)) {
      return {
        resolved,
        parentEscape: shortestParentEscape(
          [...ancestor, ...relative.split(PATH_SEPARATOR)],
          containerSegments,
        ),
        rootEscape: `${ROOT_ESCAPE}${resolved}`,
      };
    }
  }
  return null;
}

/**
 * The `^.` spelling of a resolved path from inside `containerSegments`: pop up
 * to the deepest container level that is a prefix of it, then name the rest.
 * Null when they share no prefix, since `$.` then says the same thing plainly.
 *
 * `target` holds the ancestor's segments followed by the authored tail split
 * on `.`; the tail is text, so a dotted backtick name inside it simply fails to
 * match a container segment and the spelling falls back to more `^.`s.
 */
function shortestParentEscape(
  target: readonly string[],
  containerSegments: ContainerSegments,
): string | null {
  let shared = 0;
  while (
    shared < containerSegments.length &&
    shared < target.length - 1 &&
    containerSegments[shared] === target[shared]
  ) {
    shared += 1;
  }
  if (shared === 0) return null;
  return (
    PARENT_ESCAPE.repeat(containerSegments.length - shared) +
    target.slice(shared).join(PATH_SEPARATOR)
  );
}

/**
 * Advance an authored field expression through container qualification.
 *
 * Child paths are relative to the enclosing `each`, `flatten`, or nested-arrow
 * path, and may carry an ADR-053 escape prefix (`^.` / `$.`). Mapping-body
 * paths have no container and retain their string value; their distinct return
 * type records that qualification has still occurred.
 */
export function qualifyContainerFieldRef(
  ref: AuthoredFieldRef,
  container: ContainerQualifiedFieldRef | null,
): ContainerQualifiedFieldRef {
  return createContainerQualifiedFieldRef(resolveAuthoredPathAgainstContainer(ref, container));
}

/**
 * Resolve an authored entity name to the canonical id present in a workspace.
 *
 * Resolution order mirrors Satsuma's namespace binding rule: an explicitly
 * qualified name, then the current namespace, then the global namespace. Maps
 * store global entities under their bare key, but the returned identity keeps
 * the canonical leading `::` so it cannot collide with authored bare text.
 */
export function canonicalizeEntityRef(
  ref: AuthoredEntityRef,
  currentNamespace: string | null,
  entities: ReadonlyMap<string, unknown>,
): CanonicalEntityRef | null {
  if (ref.includes("::")) {
    const lookupKey = ref.startsWith("::") ? ref.slice(2) : ref;
    if (!entities.has(lookupKey)) return null;
    return createCanonicalEntityRef(ref.startsWith("::") ? ref : `${ref}`);
  }

  if (currentNamespace) {
    const namespacedKey = `${currentNamespace}::${ref}`;
    if (entities.has(namespacedKey)) return createCanonicalEntityRef(namespacedKey);
  }

  if (entities.has(ref)) return createCanonicalEntityRef(`::${ref}`);
  return null;
}

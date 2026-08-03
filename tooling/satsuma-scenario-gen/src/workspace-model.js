/**
 * workspace-model.js — a generated scenario grown from one mapping to a workspace.
 *
 * `model.js` describes a single file with one mapping: the right domain for
 * coverage, and too small for lineage. Lineage is about *chains*, and the
 * endpoint defects worth defending against live in namespaces, container blocks
 * and NL `@ref`s — none of which a single-mapping model can express (sl-dqyu).
 *
 * ## Two decisions that make the ground truth trivially correct
 *
 * **1. Endpoints name their schema explicitly.** An arrow endpoint is
 * `{ schema, path }`, never a bare string. Production code has to *infer* the
 * owning schema of an authored ref — that inference is `qualifyField`, and it is
 * exactly what `r0-7w76` shows can guess wrong. A generator that recorded only
 * the authored spelling would have to re-implement the same inference to state
 * its own ground truth, so the oracle would share the bug. Here the schema is
 * given and the *authored spelling is derived from it* by {@link renderWorkspace}.
 *
 * **2. Paths are always absolute; relativity is a rendering concern.** A child
 * arrow inside `each orders -> shipments` stores `orders.order_no`, and the
 * renderer emits `.order_no`. Container-relative resolution is therefore
 * exercised end to end (the shape `3cdd-yavi` broke) while the ground truth
 * never has to undo it.
 *
 * Owns: the workspace shapes and their constructors. Does not own: Satsuma text
 * (workspace-render.js), expected edges (ground-truth.js), or generation
 * (workspace-arbitraries.js).
 */

// ── Entity and endpoint references ─────────────────────────────────────────

/**
 * An entity reference as it is *authored*: `name` at file scope, `ns::name`
 * inside a namespace. This is the spelling that appears in a `source { }` list,
 * and the key production code must arrive at.
 *
 * @typedef {string} ScenarioEntityRef
 */

/**
 * One end of an arrow: the schema that declares the field, plus the field's
 * schema-local dotted path. Always absolute — see this module's header.
 *
 * @typedef {{ schema: ScenarioEntityRef, path: string }} ScenarioEndpoint
 */

/** Build an arrow endpoint. `path` is absolute within `schema`, never relative. */
export function endpoint(schema, path) {
  return { schema, path };
}

/** The authored reference for an entity: `ns::name`, or plain `name` at file scope. */
export function entityRef(namespace, name) {
  return namespace ? `${namespace}::${name}` : name;
}

/**
 * The canonical `[ns]::name` form the toolchain emits, from an authored ref.
 *
 * Mirrors the CLI's `canonicalKey`: a bare name gains the empty-namespace `::`
 * prefix so that "global scope" is stated rather than implied. Reimplemented
 * here in one line because this package may not depend on `@satsuma/core`.
 */
export function canonicalEntityRef(ref) {
  return ref.includes("::") ? ref : `::${ref}`;
}

/** The canonical `[ns]::schema.path` form of one endpoint. */
export function canonicalEndpoint({ schema, path }) {
  return `${canonicalEntityRef(schema)}.${path}`;
}

// ── Transforms ─────────────────────────────────────────────────────────────

/**
 * A natural-language transform body, optionally mentioning fields by `@ref`.
 *
 * `refs` become `@schema.path` mentions inside the rendered text, and each one
 * is an *implicit* source for the arrow's target — the `nl-derived` edge tier
 * both CLI graph builders emit, and the tier that once manufactured phantom
 * edges (`cbh-y5og`).
 *
 * @typedef {{ kind: "nl", text: string, refs: ScenarioEndpoint[] }} ScenarioTransform
 */

/** Build an NL transform body whose text mentions every ref in `refs`. */
export function nlTransform(text, refs = []) {
  return { kind: "nl", text, refs };
}

// ── Arrows ─────────────────────────────────────────────────────────────────

/**
 * One arrow declaration. The union is keyed by `kind`, matching core's
 * `ArrowDeclarationKind` for the shapes this generator emits:
 *
 * | kind | Satsuma | Notes |
 * |---|---|---|
 * | `map` | `a, b -> t { … }` | one edge per source |
 * | `computed` | `-> t { … }` | sourceless; the graph records `from: null` |
 * | `each` | `each src -> tgt { … }` | iterates a list; children are relative |
 * | `flatten` | `flatten src -> tgt { … }` | one output row per element |
 *
 * A `map` or `computed` body is a transform pipeline, not a nesting scope
 * (spec §4.4), so only the two iteration kinds carry `children`.
 *
 * @typedef {{
 *   kind: "map",
 *   sources: ScenarioEndpoint[],
 *   target: ScenarioEndpoint,
 *   transform?: ScenarioTransform,
 * }} ScenarioMapArrow
 */
/**
 * @typedef {{
 *   kind: "computed",
 *   target: ScenarioEndpoint,
 *   transform?: ScenarioTransform,
 * }} ScenarioComputedArrow
 */
/**
 * @typedef {{
 *   kind: "each" | "flatten",
 *   source: ScenarioEndpoint,
 *   target: ScenarioEndpoint,
 *   children: ScenarioWorkspaceArrow[],
 * }} ScenarioIterationArrow
 */
/**
 * @typedef {ScenarioMapArrow | ScenarioComputedArrow | ScenarioIterationArrow} ScenarioWorkspaceArrow
 */

/** `sources -> target`: the ordinary arrow, one graph edge per source. */
export function mapArrow(sources, target, transform) {
  return { kind: "map", sources, target, ...(transform ? { transform } : {}) };
}

/** `-> target`: a sourceless arrow, which the graph records as `from: null`. */
export function computedArrow(target, transform) {
  return { kind: "computed", target, ...(transform ? { transform } : {}) };
}

/**
 * `each source -> target { children }`.
 *
 * Every child endpoint must sit under this block's own paths and name the same
 * schemas: Satsuma has no notation for reaching an ancestor from inside a block
 * (spec §4.4), so a child naming anything else would not be a declared field.
 * {@link renderWorkspace} asserts it rather than emitting invalid Satsuma.
 */
export function eachBlock(source, target, children) {
  return { kind: "each", source, target, children };
}

/** `flatten source -> target { children }`; same child rules as {@link eachBlock}. */
export function flattenBlock(source, target, children) {
  return { kind: "flatten", source, target, children };
}

// ── Declarations, files and workspaces ─────────────────────────────────────

/**
 * A schema declaration, optionally in a namespace and optionally a metric.
 *
 * `metric` marks the schema with the `metric` vocabulary token; `metricSources`
 * become `source <name>` tokens, which are what produce `metric_source` schema
 * edges — a distinct edge role driven by metadata rather than by any mapping.
 *
 * @typedef {{
 *   name: string,
 *   namespace: string | null,
 *   fields: import("./model.js").ScenarioField[],
 *   spreads?: string[],
 *   metric?: boolean,
 *   metricSources?: ScenarioEntityRef[],
 * }} ScenarioSchemaDecl
 */

/**
 * A mapping declaration. `sources` and `targets` are authored entity refs, in
 * the order they appear in the `source { }` / `target { }` lists — order matters,
 * because `qualifyField` attaches an unqualified path to the *first* schema.
 *
 * @typedef {{
 *   name: string,
 *   namespace: string | null,
 *   sources: ScenarioEntityRef[],
 *   targets: ScenarioEntityRef[],
 *   arrows: ScenarioWorkspaceArrow[],
 * }} ScenarioMappingDecl
 */

/**
 * One `.stm` file. `path` is workspace-relative and is what the entry file's
 * generated `import` statements point at.
 *
 * Imports are deliberately *not* modelled: {@link renderWorkspace} derives each
 * file's `import` statements from the cross-file references its own declarations
 * make. Authoring them separately would let a generated workspace declare an
 * import graph that disagrees with its own usage, which is a generator bug the
 * properties would then report as a toolchain bug.
 *
 * @typedef {{
 *   path: string,
 *   fragments: import("./model.js").ScenarioEntity[],
 *   schemas: ScenarioSchemaDecl[],
 *   mappings: ScenarioMappingDecl[],
 * }} ScenarioFile
 */

/**
 * A whole workspace. `files[0]` is the entry file — the one a command is pointed
 * at, and the root of the import graph every other file must be reachable from.
 *
 * @typedef {{ files: ScenarioFile[] }} ScenarioWorkspace
 */

/** Build a schema declaration. */
export function schemaDecl({
  name,
  namespace = null,
  fields,
  spreads = [],
  metric = false,
  metricSources = [],
}) {
  return {
    name,
    namespace,
    fields,
    ...(spreads.length > 0 ? { spreads } : {}),
    ...(metric ? { metric: true } : {}),
    ...(metricSources.length > 0 ? { metricSources } : {}),
  };
}

/** Build a mapping declaration. */
export function mappingDecl({ name, namespace = null, sources, targets, arrows }) {
  return { name, namespace, sources, targets, arrows };
}

/** Build one file. */
export function scenarioFile({ path, fragments = [], schemas = [], mappings = [] }) {
  return { path, fragments, schemas, mappings };
}

/** Build a workspace whose first file is the entry file. */
export function scenarioWorkspace(files) {
  return { files };
}

// ── Traversal helpers shared by the renderer and the ground truth ──────────

/**
 * Every arrow in a mapping, iteration headers included, parents before children.
 *
 * An iteration header is itself an arrow record in core's extraction — it names a
 * source and a target — so anything counting or resolving arrows must see it,
 * not just the leaves it encloses.
 */
export function flattenArrows(arrows) {
  return arrows.flatMap((arrow) =>
    arrow.kind === "each" || arrow.kind === "flatten"
      ? [arrow, ...flattenArrows(arrow.children)]
      : [arrow],
  );
}

/** Every mapping in the workspace, paired with the file that declares it. */
export function workspaceMappings(workspace) {
  return workspace.files.flatMap((file) =>
    file.mappings.map((mapping) => ({ file: file.path, mapping })),
  );
}

/** Every schema in the workspace, paired with the file that declares it. */
export function workspaceSchemas(workspace) {
  return workspace.files.flatMap((file) =>
    file.schemas.map((schema) => ({ file: file.path, schema })),
  );
}

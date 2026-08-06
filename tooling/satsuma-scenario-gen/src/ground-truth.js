/**
 * ground-truth.js — what a scenario declares, computed from the scenario alone.
 *
 * **Nothing in this module imports, mirrors or restates production code.** Every
 * function here reads the scenario data structure and nothing else. That is what
 * makes it a usable oracle rather than a second implementation: a scenario
 * already *is* a graph, so the expected upstream set of a field is the set of its
 * ancestors under reachability over the arrows the scenario declared. There is no
 * Satsuma-specific rule to get wrong (Feature 41 PRD, "Why lineage needs no
 * independent oracle").
 *
 * This is why lineage is a better generated-input target than coverage was.
 * Coverage needed a hand-written oracle restating ADR-034–041, and the Feature 39
 * PRD rightly warns that two implementations can share one misunderstanding. Here
 * the oracle is a breadth-first search.
 *
 * ## What is deliberately outside the generated domain
 *
 * Two production rules in the `nl-derived` edge tier are *not* modelled, because
 * the generator never produces input that reaches them:
 *
 * - **self-reference**, where an `@ref` names the arrow's own target; and
 * - **duplicate suppression**, where an `@ref` names a field that is already a
 *   declared source of the same arrow in the same mapping.
 *
 * Modelling either would mean copying a production branch into the oracle — the
 * exact failure mode this module exists to avoid. The arbitraries instead avoid
 * generating those shapes, and the hand-written tests in the CLI's
 * `field-lineage` and `graph` suites keep covering them.
 *
 * Owns: declared paths, declared edges, and reachability over them. Does not own:
 * anything the *toolchain* is expected to do with them.
 */

import {
  canonicalEndpoint,
  canonicalEntityRef,
  flattenArrows,
  workspaceMappings,
  workspaceSchemas,
} from "./workspace-model.js";

// ── Declared field paths ───────────────────────────────────────────────────

/**
 * Every declared path of one field tree — containers as well as leaves.
 *
 * Containers are included because an arrow may legitimately name one (`each
 * orders -> shipments` names two containers), so the endpoint-existence property
 * must accept them. Coverage's *denominator* counts leaves only (ADR-034); that
 * is a different question from "is this a declared path".
 */
function declaredPaths(fields, prefix = "") {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    return field.kind === "record" ? [path, ...declaredPaths(field.fields, path)] : [path];
  });
}

/**
 * Resolve a schema's fields including the fragments it spreads.
 *
 * A body declaration shadows a spread field of the same name rather than
 * duplicating it (ADR-041), which here needs no special handling beyond
 * preferring the body's own name — the result is a *set* of paths.
 */
function fieldsWithSpreads(schema, fragmentsByName) {
  const spreadFields = (schema.spreads ?? []).flatMap(
    (name) => fragmentsByName.get(name)?.fields ?? [],
  );
  const ownNames = new Set(schema.fields.map((field) => field.name));
  return [...schema.fields, ...spreadFields.filter((field) => !ownNames.has(field.name))];
}

/** Index every fragment in the workspace by its authored name. */
function fragmentsOf(workspace) {
  return new Map(
    workspace.files.flatMap((file) => file.fragments.map((fragment) => [fragment.name, fragment])),
  );
}

/**
 * Every qualified path the workspace declares, as `[ns]::schema.path`, sorted.
 *
 * This is the set an emitted edge endpoint must belong to. An endpoint outside it
 * names a field nobody declared, which is `r0-7w76`'s failure: endpoint
 * resolution cannot see the declared field set, so a bare token that names both a
 * field and a schema root has two readings and core reports rather than picks —
 * leaving the choice to the caller (`arrowEndpoint`), which still reads it as a
 * field.
 */
export function scenarioDeclaredFieldPaths(workspace) {
  const fragments = fragmentsOf(workspace);
  const paths = workspaceSchemas(workspace).flatMap(({ schema }) => {
    const prefix = canonicalEntityRef(
      schema.namespace ? `${schema.namespace}::${schema.name}` : schema.name,
    );
    return declaredPaths(fieldsWithSpreads(schema, fragments)).map((path) => `${prefix}.${path}`);
  });
  return [...new Set(paths)].sort();
}

// ── Declared field edges ───────────────────────────────────────────────────

/**
 * One expected field-level edge.
 *
 * `from` is null for a computed arrow, which declares a target with no source —
 * the state the graph records as `from: null`.
 *
 * @typedef {{
 *   from: string | null,
 *   to: string,
 *   mapping: string,
 *   classification: "none" | "nl" | "nl-derived",
 *   kind: "map" | "computed" | "each" | "flatten",
 *   file: string,
 * }} ScenarioFieldEdge
 */

/** An arrow's classification: `nl` once it carries a natural-language body. */
function classificationOf(arrow) {
  return arrow.transform ? "nl" : "none";
}

/**
 * Every field edge one arrow declares, iteration headers included.
 *
 * A `map` arrow with several sources declares one edge per source, all to the
 * same target (spec §4.2). An iteration header declares an edge of its own,
 * because it names a source and a target just as any other arrow does.
 */
function edgesForArrow(arrow, mappingKey, file) {
  const base = { mapping: mappingKey, file, kind: arrow.kind };

  if (arrow.kind === "computed") {
    return [
      {
        ...base,
        from: null,
        to: canonicalEndpoint(arrow.target),
        classification: classificationOf(arrow),
      },
    ];
  }
  const sources = arrow.kind === "map" ? arrow.sources : [arrow.source];
  return sources.map((source) => ({
    ...base,
    from: canonicalEndpoint(source),
    to: canonicalEndpoint(arrow.target),
    classification: classificationOf(arrow),
  }));
}

/**
 * The `nl-derived` edges an arrow's `@ref` mentions declare.
 *
 * An `@ref` in a transform body states that the mentioned field is an implicit
 * source for the arrow's target. Only arrows *with a target* contribute: a note
 * with no arrow has nothing to be a source of.
 */
function nlDerivedEdgesForArrow(arrow, mappingKey, file) {
  return (arrow.transform?.refs ?? []).map((ref) => ({
    from: canonicalEndpoint(ref),
    to: canonicalEndpoint(arrow.target),
    mapping: mappingKey,
    classification: "nl-derived",
    kind: arrow.kind,
    file,
  }));
}

/**
 * Every field edge the workspace declares, with fully qualified endpoints.
 *
 * Returned in declaration order, which is what lets a caller assert that a
 * consumer emits each declared edge *exactly once*: duplicates in the expected
 * list are meaningful (two identical arrows in one mapping really are two edges).
 */
export function scenarioFieldEdges(workspace) {
  return workspaceMappings(workspace).flatMap(({ file, mapping }) => {
    const mappingKey = canonicalEntityRef(
      mapping.namespace ? `${mapping.namespace}::${mapping.name}` : mapping.name,
    );
    const arrows = flattenArrows(mapping.arrows);
    return [
      ...arrows.flatMap((arrow) => edgesForArrow(arrow, mappingKey, file)),
      ...arrows.flatMap((arrow) => nlDerivedEdgesForArrow(arrow, mappingKey, file)),
    ];
  });
}

// ── Declared schema edges ──────────────────────────────────────────────────

/**
 * One expected schema-level edge. `role` distinguishes the four ways a schema can
 * be attached to a mapping or metric, which is what the graph's `schema_edges`
 * carries.
 *
 * @typedef {{ from: string, to: string, role: "source" | "target" | "metric_source" }} ScenarioSchemaEdge
 */

/**
 * Every schema-level edge the workspace declares.
 *
 * `source` and `target` come from a mapping's declared lists — *not* from its
 * arrows, so a mapping that declares no arrow at all still contributes topology.
 * `metric_source` comes from a metric schema's `source` metadata token, which is
 * a different mechanism entirely and is why it is a distinct role.
 *
 * `nl_ref` schema edges are not modelled: the CLI emits them only for a schema
 * mentioned in NL text that is *not* already a declared source, and the
 * generator deliberately never produces that shape (see this module's header).
 */
export function scenarioSchemaEdges(workspace) {
  const edges = [];
  for (const { mapping } of workspaceMappings(workspace)) {
    const mappingKey = canonicalEntityRef(
      mapping.namespace ? `${mapping.namespace}::${mapping.name}` : mapping.name,
    );
    for (const source of mapping.sources) {
      edges.push({ from: canonicalEntityRef(source), to: mappingKey, role: "source" });
    }
    for (const target of mapping.targets) {
      edges.push({ from: mappingKey, to: canonicalEntityRef(target), role: "target" });
    }
  }
  for (const { schema } of workspaceSchemas(workspace)) {
    const metricKey = canonicalEntityRef(
      schema.namespace ? `${schema.namespace}::${schema.name}` : schema.name,
    );
    for (const source of schema.metricSources ?? []) {
      edges.push({ from: canonicalEntityRef(source), to: metricKey, role: "metric_source" });
    }
  }
  return edges;
}

// ── Reachability: the oracle for every traversal property ──────────────────

/**
 * Adjacency built from a scenario's field edges, in one direction.
 *
 * Edges with a null `from` are skipped in the upstream direction: a computed
 * arrow has no source field, so it contributes no upstream hop. It still
 * contributes downstream nothing either — there is no field to walk *from*.
 */
function adjacency(edges, direction) {
  const next = new Map();
  for (const edge of edges) {
    if (edge.from === null) continue;
    const [key, value] = direction === "downstream" ? [edge.from, edge.to] : [edge.to, edge.from];
    if (!next.has(key)) next.set(key, new Set());
    next.get(key).add(value);
  }
  return next;
}

/**
 * Every field within `maxDepth` hops of `start`, and the hop count that reached
 * it, excluding `start` itself.
 *
 * Breadth-first, so the depth recorded for each field is its *shortest* path —
 * which is the property `sl-y89y` violated. A plain visited-set traversal that
 * expands a node once at whatever depth it first arrived can truncate a subtree
 * when a shorter path arrives later with budget still remaining. Returning the
 * shortest distance is what lets a property state depth *exactness* rather than
 * mere monotonicity, which the buggy implementation also satisfied.
 *
 * `maxDepth` counts hops, matching `--depth`: depth 1 is immediate neighbours.
 * Cycles terminate because a field is enqueued at most once.
 *
 * Module-private: the two direction wrappers below are the API, and a caller that
 * chose its own `direction` string would be one typo from a silently empty answer.
 */
function scenarioReachableWithin(edges, start, maxDepth, direction) {
  const next = adjacency(edges, direction);
  const distance = new Map();
  let frontier = [start];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const following = [];
    for (const field of frontier) {
      for (const neighbour of next.get(field) ?? []) {
        if (neighbour === start || distance.has(neighbour)) continue;
        distance.set(neighbour, depth);
        following.push(neighbour);
      }
    }
    frontier = following;
  }
  return distance;
}

/**
 * The fields that feed into `start` within `maxDepth` hops — the expected
 * `upstream` set. A diamond therefore yields *both* branches, which is the
 * defect behind `sg-pufq`.
 */
export function scenarioAncestorsWithin(edges, start, maxDepth) {
  return scenarioReachableWithin(edges, start, maxDepth, "upstream");
}

/** The fields `start` flows into within `maxDepth` hops — the expected `downstream` set. */
export function scenarioDescendantsWithin(edges, start, maxDepth) {
  return scenarioReachableWithin(edges, start, maxDepth, "downstream");
}

/**
 * Project field edges onto the schemas that own their endpoints.
 *
 * Ties field-level lineage to `graph --schema-only`: two walks that must agree,
 * because one is definitionally the projection of the other. The owning schema is
 * read off the endpoint's structure — everything before the first `.` that
 * follows the `::` separator — rather than by splitting on the first `.`, which
 * would be wrong for a namespaced key.
 */
export function scenarioSchemaProjection(edges) {
  const owning = (endpoint) => {
    if (endpoint === null) return null;
    const separator = endpoint.indexOf("::");
    const dot = endpoint.indexOf(".", separator + 2);
    return dot === -1 ? endpoint : endpoint.slice(0, dot);
  };
  const projected = new Set();
  for (const edge of edges) {
    const from = owning(edge.from);
    const to = owning(edge.to);
    if (from !== null && from !== to) projected.add(`${from}->${to}`);
  }
  return [...projected].sort();
}

// ── Declared entities, and every place a workspace uses them ───────────────
//
// The section above answers "what flows where". This one answers "what is
// declared, and where is it named" — the ground truth behind find-references,
// go-to-definition and rename. It lives here for the same reason
// `scenarioFieldEdges` does: a generated workspace declares its entities and
// names every reference to them outright, so the answer follows from the
// scenario by construction and no consumer should re-derive it. The LSP was the
// first consumer (Feature 46 R3) and the CLI is not far behind, which is what
// `gpt-l9rp` moved this out of the LSP's test tree for.
//
// One rule *is* restated from `workspace-render.js`: which names a file's
// derived `import` statements list. A scenario does not author its imports — the
// renderer computes them from usage, so a generated workspace can never claim an
// import graph its declarations contradict — but an imported name is a reference
// site, and much of what the multi-file domain is for. The alternative is to
// read the emitted `import` lines back out of rendered text, which would make an
// oracle into a parser. Keeping the restatement in this package, beside the
// renderer it mirrors, is what stops the two drifting.

/**
 * Usage kinds, spelled exactly as the workspace index's `ReferenceEntry.context`
 * so that an expected site and an observed one compare as plain strings.
 */
export const USAGE_KIND = Object.freeze({
  /** An entity named in a mapping's `source { }` list. */
  source: "source",
  /** An entity named in a mapping's `target { }` list. */
  target: "target",
  /** A fragment spread into a schema or fragment body. */
  spread: "spread",
  /** A name listed in an `import { }` declaration. */
  import: "import",
  /** A schema named by a metric's `source` metadata token. */
  metricSource: "metric_source",
  /** The schema prefix of a qualified arrow path, e.g. the `s0` of `s0.field`. */
  arrow: "arrow",
});

/**
 * An entity a generated workspace declares.
 *
 * @typedef {{
 *   key: string,
 *   name: string,
 *   namespace: string | null,
 *   keyword: "schema" | "fragment" | "mapping",
 *   file: string,
 * }} ScenarioDeclaredEntity
 *
 * `key` is the workspace index's definition key — `name` at file scope,
 * `ns::name` inside a namespace — and therefore the key a reference query must
 * arrive at. `name` is the block label as authored, which is what appears at the
 * declaration site and inside a namespace is *not* the key. `keyword` is the
 * declaration keyword, which is how the declaration is located in rendered text.
 * `file` is the workspace-relative path of the declaring file.
 */

/**
 * Every entity a workspace declares, in declaration order.
 *
 * Mappings are included even though nothing may reference them: "no references"
 * is an assertion worth making, and it is the half of a reference property that
 * catches an invented reference rather than a missing one.
 *
 * @param {import("./workspace-model.js").ScenarioWorkspace} workspace
 * @returns {ScenarioDeclaredEntity[]}
 */
export function scenarioDeclaredEntities(workspace) {
  const entities = [];
  for (const file of workspace.files) {
    for (const fragment of file.fragments) {
      entities.push({
        key: fragment.name,
        name: fragment.name,
        namespace: null,
        keyword: "fragment",
        file: file.path,
      });
    }
    for (const schema of file.schemas) {
      entities.push({
        key: declarationKey(schema.name, schema.namespace),
        name: schema.name,
        namespace: schema.namespace,
        keyword: "schema",
        file: file.path,
      });
    }
    for (const mapping of file.mappings) {
      entities.push({
        key: declarationKey(mapping.name, mapping.namespace),
        name: mapping.name,
        namespace: mapping.namespace,
        keyword: "mapping",
        file: file.path,
      });
    }
  }
  return entities;
}

/**
 * Every usage site the workspace declares, grouped by the entity it references.
 *
 * Every declared entity gets an entry, empty when nothing references it. Sites
 * are a **multiset**, not a set: one file legitimately references the same entity
 * from two mappings, and collapsing that to one site would hide a reference the
 * toolchain dropped.
 *
 * Two things are deliberately *not* sites. A `namespace` block is not one: the
 * scenario model has no namespace declaration to name, and a qualified reference
 * is filed under the whole `ns::name` key. Nor is the schema an NL `@ref`
 * mentions: `@raw.field_1` is a reference to the *field* `raw.field_1`, which is
 * how the index files it. The `@ref` still matters here, because a mention of
 * another file's schema is one of the things that forces an `import`, which is a
 * site.
 *
 * Throws when the scenario references something it never declares — that is a
 * malformed scenario, not a toolchain failure, and failing loudly beats silently
 * dropping the site.
 *
 * @param {import("./workspace-model.js").ScenarioWorkspace} workspace
 * @returns {Map<string, Array<{ file: string, kind: string }>>}
 */
export function scenarioDeclaredUsageSites(workspace) {
  const entities = scenarioDeclaredEntities(workspace);
  const keys = new Set(entities.map((entity) => entity.key));
  const sites = new Map(entities.map((entity) => [entity.key, []]));

  /** Record one site, resolving the authored spelling to the entity it names. */
  const add = (ref, namespace, file, kind) => {
    const key = scenarioEntityKeyForRef(ref, namespace, keys);
    const forEntity = sites.get(key);
    if (!forEntity) {
      throw new Error(`scenario error: '${ref}' in ${file} names no declared entity`);
    }
    forEntity.push({ file, kind });
  };

  for (const file of workspace.files) {
    for (const schema of file.schemas) {
      for (const ref of schema.metricSources ?? []) {
        add(ref, schema.namespace, file.path, USAGE_KIND.metricSource);
      }
      for (const ref of schema.spreads ?? []) {
        add(ref, schema.namespace, file.path, USAGE_KIND.spread);
      }
    }
    for (const mapping of file.mappings) {
      for (const ref of mapping.sources) add(ref, mapping.namespace, file.path, USAGE_KIND.source);
      for (const ref of mapping.targets) add(ref, mapping.namespace, file.path, USAGE_KIND.target);
      for (const ref of qualifiedArrowSchemas(mapping)) {
        add(ref, mapping.namespace, file.path, USAGE_KIND.arrow);
      }
    }
    for (const ref of importedRefs(file, workspace)) {
      // Import declarations are top-level, so they are authored in no namespace.
      add(ref, null, file.path, USAGE_KIND.import);
    }
  }

  return sites;
}

/**
 * The entity an authored reference names, given the namespace it was written in.
 *
 * Satsuma's scoping rule (spec §5.3): a name written with `::` names that entity
 * outright; a bare name binds to the enclosing namespace's declaration when there
 * is one, and to the file-scope declaration otherwise. This is a *language* rule,
 * so stating it here re-derives nothing the toolchain decides — but it is also
 * the rule the workspace index's `resolveReferenceKey` implements, and getting it
 * right in one place and wrong in the other is `sl-p256`.
 *
 * Note this is a different question from {@link canonicalEntityRef}, which maps a
 * *canonical* ref onto the `[ns]::name` form the edge oracles compare with. That
 * one reads a bare ref as file-scope unconditionally, which is why
 * `bareNamespacedWorkspaceArbitrary` is not part of the shared default domain.
 *
 * @param {string} ref authored spelling, e.g. `"s0"` or `"ns_a::s0"`
 * @param {string | null} namespace the namespace block the reference sits in
 * @param {Set<string>} declaredKeys every entity key the workspace declares
 */
export function scenarioEntityKeyForRef(ref, namespace, declaredKeys) {
  if (ref.includes("::")) return ref;
  if (namespace && declaredKeys.has(`${namespace}::${ref}`)) return `${namespace}::${ref}`;
  return ref;
}

/** The index key for a declaration: `ns::name` inside a namespace, `name` outside. */
function declarationKey(name, namespace) {
  return namespace ? `${namespace}::${name}` : name;
}

/**
 * The schemas named by *qualified* arrow paths in a mapping.
 *
 * An arrow endpoint is `{ schema, path }` in the model, and the renderer decides
 * how it is spelled: bare when its side of the mapping has exactly that one
 * schema, `schema.path` when the side has several, and `.suffix` inside a
 * container block. Only the middle form writes the schema down, and the index
 * files the first segment of a path as a reference — which is what makes renaming
 * a schema rewrite `s0.field` correctly.
 *
 * A *namespaced* schema on a multi-schema side would be spelled `ns::schema.path`
 * and filed by the index under the bare `schema`. No generated domain produces
 * that shape today; if one ever does, this oracle will correctly report the site
 * as missing rather than quietly agreeing with whatever the index did.
 */
function qualifiedArrowSchemas(mapping) {
  const schemas = [];

  const visit = (arrows, insideContainer) => {
    for (const arrow of arrows) {
      // Inside a container block every path is relative (`.suffix`), so it names
      // no schema at all.
      if (!insideContainer) {
        for (const endpoint of sourceEndpointsOf(arrow)) {
          if (namesItsSchema(endpoint, mapping.sources)) schemas.push(endpoint.schema);
        }
        if (namesItsSchema(arrow.target, mapping.targets)) schemas.push(arrow.target.schema);
      }
      if (arrow.children) visit(arrow.children, true);
    }
  };

  visit(mapping.arrows, false);
  return schemas;
}

/** The source endpoints of any arrow kind: several for `map`, one for a container header, none for `computed`. */
function sourceEndpointsOf(arrow) {
  if (arrow.sources) return arrow.sources;
  return arrow.source ? [arrow.source] : [];
}

/** Mirrors the renderer's `authoredEndpoint`: a side with one matching schema writes the path bare. */
function namesItsSchema(endpoint, sideSchemas) {
  return !(sideSchemas.length === 1 && sideSchemas[0] === endpoint.schema);
}

/**
 * The names a file's derived `import` statements list.
 *
 * Restates `workspace-render.js`'s `renderImports`: everything the file
 * references but does not declare, that some other file declares, once per
 * entity, minus anything the scenario deliberately withholds. See this section's
 * header for why the rule is restated rather than read back out of rendered text.
 */
function importedRefs(file, workspace) {
  const own = declaredRefsOf(file);
  // `withheldImports` is the renderer's one deliberate hole in the derivation — a
  // defect mutator's way of reaching ADR-022's import-scope check. A valid
  // scenario leaves it empty, but honouring it here keeps a withheld import
  // reported as the missing *import statement* it is, rather than as a
  // find-references failure against a site the file never wrote.
  const withheld = new Set(file.withheldImports ?? []);
  const wanted = [...referencedRefsOf(file)].filter((ref) => !own.has(ref) && !withheld.has(ref));

  const imported = [];
  for (const other of workspace.files) {
    if (other.path === file.path) continue;
    const declared = declaredRefsOf(other);
    for (const ref of wanted) {
      if (declared.has(ref)) imported.push(ref);
    }
  }
  return imported;
}

/**
 * Every entity reference a file makes, as authored.
 *
 * Wider than the list of *sites*: an arrow path written bare still needs its
 * schema imported, and so does the schema an NL `@ref` mentions. This is the list
 * the import derivation is computed from, not the list of reference sites.
 */
function referencedRefsOf(file) {
  const refs = new Set();
  for (const schema of file.schemas) {
    for (const ref of schema.metricSources ?? []) refs.add(ref);
    for (const ref of schema.spreads ?? []) refs.add(ref);
  }
  for (const mapping of file.mappings) {
    for (const ref of [...mapping.sources, ...mapping.targets]) refs.add(ref);
    for (const arrow of flattenArrows(mapping.arrows)) {
      for (const endpoint of sourceEndpointsOf(arrow)) refs.add(endpoint.schema);
      refs.add(arrow.target.schema);
      for (const endpoint of arrow.transform?.refs ?? []) refs.add(endpoint.schema);
    }
  }
  return refs;
}

/**
 * Every entity a file declares, spelled the way a reference to it is written.
 *
 * Mappings are absent on purpose: the renderer's import derivation does not
 * consider them either, because nothing may reference a mapping.
 */
function declaredRefsOf(file) {
  return new Set([
    ...file.fragments.map((fragment) => fragment.name),
    ...file.schemas.map((schema) => declarationKey(schema.name, schema.namespace)),
  ]);
}

// ── Comparing two scenarios ────────────────────────────────────────────────

/**
 * The declarations that differ between two scenario workspaces.
 *
 * The oracle for a *change-detection* property: `satsuma diff` reports a
 * structural delta between two workspaces, and the question "which entities may
 * that delta legitimately mention" is answered by the scenarios themselves. A
 * consumer that derived it from the delta instead would be comparing `diff` with
 * itself.
 *
 * Declarations are keyed by kind and authored ref (`ns::name` inside a
 * namespace), which is the key `diff` reports under, and compared by deep value.
 * A declaration present on one side only counts as changed. **Two declarations
 * of the same kind and ref in one workspace collapse to the last of them** —
 * which is the right answer here rather than a limitation: a duplicate
 * declaration is merged by every extractor in the toolchain, so a workspace with
 * one and a workspace with two are structurally the same and `diff` is right to
 * say nothing.
 *
 * @param {import("./workspace-model.js").ScenarioWorkspace} before
 * @param {import("./workspace-model.js").ScenarioWorkspace} after
 * @returns {string[]} authored refs, sorted, without their kind prefix
 */
export function scenarioChangedDeclarations(before, after) {
  const changed = new Set();
  const [left, right] = [declarationValues(before), declarationValues(after)];

  for (const [key, value] of left) {
    if (right.get(key) !== value) changed.add(refOfDeclarationKey(key));
  }
  for (const [key, value] of right) {
    if (left.get(key) !== value) changed.add(refOfDeclarationKey(key));
  }
  return [...changed].sort();
}

/** Every declaration of a workspace as `kind:ref` → a deep-value string. */
function declarationValues(workspace) {
  const values = new Map();
  for (const file of workspace.files) {
    for (const fragment of file.fragments) {
      values.set(`fragment:${fragment.name}`, JSON.stringify(fragment));
    }
    for (const schema of file.schemas) {
      values.set(`schema:${declarationKey(schema.name, schema.namespace)}`, JSON.stringify(schema));
    }
    for (const mapping of file.mappings) {
      values.set(
        `mapping:${declarationKey(mapping.name, mapping.namespace)}`,
        JSON.stringify(mapping),
      );
    }
  }
  return values;
}

/** Strip the `kind:` prefix a declaration key carries — the ref `diff` reports. */
function refOfDeclarationKey(key) {
  return key.slice(key.indexOf(":") + 1);
}
